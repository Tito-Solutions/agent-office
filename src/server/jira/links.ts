// Jira, connected once from the office (☰ → Jira) and used by every worker you hire.
//
// The office signs in to Atlassian's remote MCP server itself (see oauth.ts): the browser goes to
// Atlassian's consent page and comes back to the office's own /jira/callback, so it works on an
// office in the cloud as well as on your laptop. The tokens stay in the office (jira.json, 0600),
// which refreshes them as they run out. Workers never see them: their agent talks to a relay on the
// office's loopback hook server (see relay.ts), with their own hook token, and the relay calls
// Atlassian with the right access token.
//
// Each account connects its own Jira, so its workers act in Jira as that person; on the shared
// password (no accounts) there's one connection, the office's.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { JiraState } from '../../shared/protocol.js';
import type { RemoteMcp } from '../providers/types.js';
import { authorizeUrl, discover, pkce, register, TokenError, tokenRequest, type Fetch, type OAuthClient, type Tokens } from './oauth.js';

/** Atlassian's remote MCP server; AGENT_OFFICE_JIRA_MCP_URL points the office at another. */
export const JIRA_MCP_DEFAULT = 'https://mcp.atlassian.com/v1/mcp/authv2';
/** What workers call it: Claude Code's tools are mcp__jira__<tool>. */
export const JIRA_MCP_NAME = 'jira';
/** Where on the hook server workers reach it (see relay.ts). */
export const JIRA_RELAY_PATH = '/mcp/jira';

/** Whose connection: an account's id, or '' for the office's own (the shared password). */
export type Owner = string;

interface Link extends Tokens {
  server: string;
  tokenEndpoint: string;
  client: OAuthClient;
  resource?: string;
  /** When it was connected, and by whom. */
  since: number;
  by: string;
}

interface Saved {
  /** The office as registered with the sign-in server, by MCP server and callback URL. */
  clients: Record<string, OAuthClient>;
  links: Record<Owner, Link>;
}

/** A sign-in someone started, waiting for Atlassian to send them back with a code. */
interface Flow {
  owner: Owner;
  by: string;
  verifier: string;
  redirectUri: string;
  tokenEndpoint: string;
  client: OAuthClient;
  clientKey: string;
  resource?: string;
  at: number;
}

const FLOW_MS = 15 * 60_000;
const MAX_FLOWS = 50;
/** Refreshed this long before it runs out, so a call never goes out on a token about to expire. */
const EARLY_MS = 60_000;
/** A 401 right after a refresh is the server's doing, not an old token: don't refresh again. */
const REFRESHED_MS = 10_000;

export class JiraLinks {
  private file: string;
  private saved: Saved = { clients: {}, links: {} };
  private flows = new Map<string, Flow>();
  private errors = new Map<Owner, string>();
  private refreshing = new Map<Owner, Promise<string | undefined>>();
  private refreshedAt = new Map<Owner, number>();

  constructor(
    dataDir: string,
    /** The remote MCP server workers reach through the office. */
    readonly server: string,
    /** Someone's connection changed: tell them. */
    private onChange: (owner: Owner) => void,
    private fetchFn: Fetch = fetch,
    private now: () => number = Date.now,
  ) {
    this.file = path.join(dataDir, 'jira.json');
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>;
      this.saved = { clients: s.clients ?? {}, links: s.links ?? {} };
    } catch {
      // not connected yet
    }
  }

  state(owner: Owner): JiraState {
    const link = this.link(owner);
    const error = this.errors.get(owner);
    return { status: link ? 'connected' : 'none', server: this.server, ...(link ? { since: link.since, by: link.by } : {}), ...(error ? { error } : {}) };
  }

  connected(owner: Owner): boolean {
    return !!this.link(owner);
  }

  /** The MCP servers the office relays for a worker of `owner`'s (none until they connect), on the hook server at `hookUrl`. */
  relays(owner: Owner, workerId: string, hookUrl: string): RemoteMcp[] {
    return this.connected(owner) ? [{ name: JIRA_MCP_NAME, url: `${hookUrl}${JIRA_RELAY_PATH}?worker=${encodeURIComponent(workerId)}` }] : [];
  }

  /** Starts connecting `owner`'s Jira: the Atlassian page to send their browser to, which comes back to `redirectUri`. */
  async begin(owner: Owner, by: string, redirectUri: string): Promise<string> {
    const d = await discover(this.server, this.fetchFn);
    const clientKey = `${this.server} ${redirectUri}`;
    let client = this.saved.clients[clientKey];
    if (!client) {
      client = await register(d.as, redirectUri, this.fetchFn);
      this.saved.clients[clientKey] = client;
      this.save();
    }
    const { verifier, challenge } = pkce();
    const state = randomBytes(24).toString('base64url');
    this.prune();
    this.flows.set(state, { owner, by, verifier, redirectUri, tokenEndpoint: d.as.token_endpoint, client, clientKey, resource: d.resource, at: this.now() });
    return authorizeUrl(d, client, { redirectUri, state, challenge });
  }

  /** Atlassian sent them back with a code: trade it for tokens, and their workers get Jira. */
  async finish(owner: Owner, state: string, code: string): Promise<void> {
    const flow = this.take(owner, state);
    let tokens: Tokens;
    try {
      tokens = await tokenRequest(
        flow.tokenEndpoint,
        flow.client,
        { grant_type: 'authorization_code', code, redirect_uri: flow.redirectUri, code_verifier: flow.verifier, ...(flow.resource ? { resource: flow.resource } : {}) },
        this.fetchFn,
        this.now(),
      );
    } catch (err) {
      // The server forgot the office: register afresh next time.
      if (err instanceof TokenError && err.revoked) delete this.saved.clients[flow.clientKey];
      this.save();
      this.failed(owner, (err as Error).message);
      throw err;
    }
    this.saved.links[owner] = { ...tokens, server: this.server, tokenEndpoint: flow.tokenEndpoint, client: flow.client, resource: flow.resource, since: this.now(), by: flow.by };
    this.errors.delete(owner);
    this.save();
    this.onChange(owner);
  }

  /** Atlassian sent them back without a code (they said no, or it went wrong). */
  fail(owner: Owner, state: string, why: string) {
    const flow = this.flows.get(state);
    if (flow?.owner === owner) this.flows.delete(state);
    this.failed(owner, why);
  }

  /**
   * An access token for `owner`'s Jira, refreshed when it's about to run out, or when `fresh` (the
   * server just turned the last one away). Undefined when there's no connection, or it's gone.
   */
  token(owner: Owner, fresh = false): Promise<string | undefined> {
    const link = this.link(owner);
    if (!link) return Promise.resolve(undefined);
    const stale = link.expiresAt !== undefined && link.expiresAt - EARLY_MS <= this.now();
    const justRefreshed = this.now() - (this.refreshedAt.get(owner) ?? 0) < REFRESHED_MS;
    if ((!stale && !fresh) || (fresh && !stale && justRefreshed)) return Promise.resolve(link.access);
    let p = this.refreshing.get(owner);
    if (!p) {
      p = this.refresh(owner, link).finally(() => this.refreshing.delete(owner));
      this.refreshing.set(owner, p);
    }
    return p;
  }

  disconnect(owner: Owner) {
    delete this.saved.links[owner];
    this.errors.delete(owner);
    this.save();
    this.onChange(owner);
  }

  private async refresh(owner: Owner, link: Link): Promise<string | undefined> {
    if (!link.refresh) {
      this.drop(owner, "Jira's sign-in ran out: connect it again");
      return undefined;
    }
    try {
      const t = await tokenRequest(link.tokenEndpoint, link.client, { grant_type: 'refresh_token', refresh_token: link.refresh, ...(link.resource ? { resource: link.resource } : {}) }, this.fetchFn, this.now());
      // Still the same connection (nobody disconnected it meanwhile): keep its refresh token unless it was rotated.
      if (this.saved.links[owner] !== link) return this.link(owner)?.access;
      this.saved.links[owner] = { ...link, access: t.access, refresh: t.refresh ?? link.refresh, expiresAt: t.expiresAt };
      this.refreshedAt.set(owner, this.now());
      this.save();
      return t.access;
    } catch (err) {
      if (err instanceof TokenError && err.revoked) {
        this.drop(owner, 'Atlassian asked for Jira to be connected again');
        return undefined;
      }
      // Couldn't reach it: try the token we have, and refresh again next call.
      return link.access;
    }
  }

  private drop(owner: Owner, why: string) {
    delete this.saved.links[owner];
    this.save();
    this.failed(owner, why);
  }

  private failed(owner: Owner, why: string) {
    this.errors.set(owner, why);
    this.onChange(owner);
  }

  private take(owner: Owner, state: string): Flow {
    const flow = this.flows.get(state);
    if (!flow || flow.owner !== owner || this.now() - flow.at > FLOW_MS) throw new Error('This sign-in has expired or was for someone else: connect Jira again from the office');
    this.flows.delete(state);
    return flow;
  }

  private link(owner: Owner): Link | undefined {
    const l = Object.hasOwn(this.saved.links, owner) ? this.saved.links[owner] : undefined;
    return l?.server === this.server ? l : undefined;
  }

  /** Sign-ins nobody finished go after a while, and there are never many waiting. */
  private prune() {
    const now = this.now();
    for (const [k, f] of this.flows) if (now - f.at > FLOW_MS) this.flows.delete(k);
    while (this.flows.size >= MAX_FLOWS) this.flows.delete(this.flows.keys().next().value!);
  }

  private save() {
    writeFileSync(this.file, JSON.stringify(this.saved, null, 2), { mode: 0o600 });
  }
}

/** The MCP server to relay to: AGENT_OFFICE_JIRA_MCP_URL when it's set (and https), else Atlassian's. */
export function jiraServer(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.AGENT_OFFICE_JIRA_MCP_URL?.trim();
  if (!url) return JIRA_MCP_DEFAULT;
  if (!/^https:\/\//.test(url)) console.error(`agent-office: AGENT_OFFICE_JIRA_MCP_URL must be https; using ${JIRA_MCP_DEFAULT}`);
  return /^https:\/\//.test(url) ? url : JIRA_MCP_DEFAULT;
}
