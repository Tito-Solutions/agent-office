// OAuth for a remote MCP server, as the MCP spec has it: find the server's authorization server
// (protected resource metadata, RFC 9728, then the authorization server's own, RFC 8414), register
// the office with it (dynamic client registration, RFC 7591), and sign in with PKCE. The office is
// the client, with its own /jira/callback page, so nobody needs a browser on the office's machine.
import { createHash, randomBytes } from 'node:crypto';

export type Fetch = typeof fetch;

/** What the office needs to know of an authorization server. */
export interface AuthServer {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
}

/** Where to sign in for a remote MCP server, and what to ask for. */
export interface Discovered {
  as: AuthServer;
  /** The resource indicator (RFC 8707) to send, when the server published its metadata. */
  resource?: string;
  /** Every scope the server lists: what Claude Code asks for too. */
  scope?: string;
}

/** The office, as registered with an authorization server. */
export interface OAuthClient {
  clientId: string;
  clientSecret?: string;
}

export interface Tokens {
  access: string;
  refresh?: string;
  /** When the access token runs out (ms since the epoch); undefined when the server didn't say. */
  expiresAt?: number;
}

const TIMEOUT_MS = 15_000;

/** https, or plain http on this machine (tests, a local proxy): never send a code or a token anywhere else. */
export function safeUrl(u: unknown): u is string {
  if (typeof u !== 'string') return false;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  } catch {
    return false;
  }
}

async function getJson(url: string, fetchFn: Fetch): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await fetchFn(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return undefined;
    const body = (await res.json()) as unknown;
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** `/.well-known/<name>` for `base`, path-suffixed first (RFC 8414 and 9728), then at its root. */
function wellKnown(base: string, name: string): string[] {
  const u = new URL(base);
  const p = u.pathname.replace(/\/$/, '');
  const urls = p ? [`${u.origin}/.well-known/${name}${p}`] : [];
  return [...urls, `${u.origin}/.well-known/${name}`];
}

/** Finds where to sign in for the MCP server at `mcpUrl`. */
export async function discover(mcpUrl: string, fetchFn: Fetch = fetch): Promise<Discovered> {
  let issuer = new URL(mcpUrl).origin;
  let resource: string | undefined;
  let scope: string | undefined;
  for (const url of wellKnown(mcpUrl, 'oauth-protected-resource')) {
    const prm = await getJson(url, fetchFn);
    const servers = prm?.authorization_servers;
    if (!prm || !Array.isArray(servers) || !safeUrl(servers[0])) continue;
    issuer = servers[0];
    resource = typeof prm.resource === 'string' ? prm.resource : mcpUrl;
    const scopes = Array.isArray(prm.scopes_supported) ? prm.scopes_supported.filter((s): s is string => typeof s === 'string') : [];
    scope = scopes.length ? scopes.join(' ') : undefined;
    break;
  }
  // RFC 8414's path-suffixed form, OpenID's, and the issuer's own path (which some servers use).
  const candidates = [...wellKnown(issuer, 'oauth-authorization-server'), ...wellKnown(issuer, 'openid-configuration'), `${issuer.replace(/\/$/, '')}/.well-known/oauth-authorization-server`];
  for (const url of [...new Set(candidates)]) {
    const meta = await getJson(url, fetchFn);
    if (!meta || !safeUrl(meta.authorization_endpoint) || !safeUrl(meta.token_endpoint)) continue;
    const as: AuthServer = { authorization_endpoint: meta.authorization_endpoint, token_endpoint: meta.token_endpoint };
    if (safeUrl(meta.registration_endpoint)) as.registration_endpoint = meta.registration_endpoint;
    return { as, resource, scope };
  }
  throw new Error(`Couldn't find where to sign in for ${mcpUrl}`);
}

/** Registers the office with the authorization server, for sign-ins that come back to `redirectUri`. */
export async function register(as: AuthServer, redirectUri: string, fetchFn: Fetch = fetch): Promise<OAuthClient> {
  if (!as.registration_endpoint) throw new Error("The sign-in server doesn't let the office register itself");
  const res = await fetchFn(as.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'Agent Office',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof body.client_id !== 'string') throw new Error(`Registering the office failed (${res.status}${typeof body.error_description === 'string' ? `: ${body.error_description}` : ''})`);
  return { clientId: body.client_id, ...(typeof body.client_secret === 'string' ? { clientSecret: body.client_secret } : {}) };
}

/** A PKCE pair (RFC 7636, S256). */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function authorizeUrl(d: Discovered, client: OAuthClient, o: { redirectUri: string; state: string; challenge: string }): string {
  const url = new URL(d.as.authorization_endpoint);
  const q = url.searchParams;
  q.set('response_type', 'code');
  q.set('client_id', client.clientId);
  q.set('redirect_uri', o.redirectUri);
  q.set('state', o.state);
  q.set('code_challenge', o.challenge);
  q.set('code_challenge_method', 'S256');
  if (d.scope) q.set('scope', d.scope);
  if (d.resource) q.set('resource', d.resource);
  return url.toString();
}

/** Why a token request failed; `revoked` when signing in again is the only way back. */
export class TokenError extends Error {
  constructor(
    message: string,
    readonly revoked: boolean,
  ) {
    super(message);
  }
}

/** A token request: a code for tokens, or a refresh token for new ones. */
export async function tokenRequest(endpoint: string, client: OAuthClient, params: Record<string, string>, fetchFn: Fetch = fetch, now = Date.now()): Promise<Tokens> {
  const body = new URLSearchParams({ ...params, client_id: client.clientId });
  if (client.clientSecret) body.set('client_secret', client.clientSecret);
  let res: Response;
  try {
    res = await fetchFn(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new TokenError(`Couldn't reach the sign-in server: ${(err as Error).message}`, false);
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== 'string') {
    const code = typeof json.error === 'string' ? json.error : `HTTP ${res.status}`;
    // A refresh token that's gone stale, been revoked, or a client the server forgot.
    const revoked = code === 'invalid_grant' || code === 'invalid_client' || code === 'unauthorized_client';
    throw new TokenError(`The sign-in server said no (${code}${typeof json.error_description === 'string' ? `: ${json.error_description}` : ''})`, revoked);
  }
  const expires = Number(json.expires_in);
  return {
    access: json.access_token,
    ...(typeof json.refresh_token === 'string' ? { refresh: json.refresh_token } : {}),
    ...(Number.isFinite(expires) && expires > 0 ? { expiresAt: now + expires * 1000 } : {}),
  };
}
