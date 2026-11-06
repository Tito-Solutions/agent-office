// Jira, connected once from the office: OAuth against a stand-in Atlassian (discovery, registration,
// PKCE, refresh), the relay workers reach it through, and the MCP server each agent is started with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JiraLinks, jiraServer, JIRA_MCP_DEFAULT } from '../src/server/jira/links.js';
import { discover, safeUrl } from '../src/server/jira/oauth.js';
import { relayMcp } from '../src/server/jira/relay.js';
import { claude } from '../src/server/providers/claude.js';
import { codex } from '../src/server/providers/codex.js';
import { opencode } from '../src/server/providers/opencode.js';
import { claudeRemoteMcp } from '../src/server/providers/remote-mcp.js';

/** A stand-in for Atlassian: its metadata where Atlassian keeps it, registration, tokens, and the MCP server. */
async function fakeAtlassian() {
  const seen: { path: string; method: string; auth?: string; session?: string; body: string }[] = [];
  let challenge = '';
  let valid = new Set<string>();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url!, base);
      seen.push({ path: url.pathname, method: req.method!, auth: req.headers.authorization, session: req.headers['mcp-session-id'] as string | undefined, body });
      const json = (status: number, b: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(JSON.stringify(b));
      };
      switch (url.pathname) {
        case '/.well-known/oauth-protected-resource/v1/mcp/authv2':
          return json(200, { resource: `${base}/v1/mcp/authv2`, authorization_servers: [`${base}/tenant`], scopes_supported: ['read:jira-work', 'offline_access'] });
        // Only at the issuer's own path, as one of the forms the office tries.
        case '/tenant/.well-known/oauth-authorization-server':
          return json(200, { authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register` });
        case '/register': {
          const b = JSON.parse(body);
          assert.equal(b.token_endpoint_auth_method, 'none');
          return json(201, { client_id: `cid-${b.redirect_uris[0]}` });
        }
        case '/token': {
          const q = new URLSearchParams(body);
          if (q.get('grant_type') === 'authorization_code') {
            if (q.get('code') !== 'good' || createHash('sha256').update(q.get('code_verifier')!).digest('base64url') !== challenge) return json(400, { error: 'invalid_grant' });
            valid = new Set(['a1']);
            return json(200, { access_token: 'a1', refresh_token: 'r1', expires_in: 3600, token_type: 'Bearer' });
          }
          if (q.get('refresh_token') === 'r1') {
            valid = new Set(['a2']);
            return json(200, { access_token: 'a2', refresh_token: 'r2', expires_in: 3600 });
          }
          return json(400, { error: 'invalid_grant' });
        }
        case '/v1/mcp/authv2': {
          if (!valid.has((req.headers.authorization ?? '').replace('Bearer ', ''))) return json(401, { error: 'invalid_token' }, { 'www-authenticate': 'Bearer' });
          if (req.method === 'GET') {
            res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 's1' });
            res.write('event: message\ndata: {"one":1}\n\n');
            return res.end('event: message\ndata: {"two":2}\n\n');
          }
          const msg = JSON.parse(body);
          return json(200, { jsonrpc: '2.0', id: msg.id, result: { ok: true } }, { 'mcp-session-id': 's1' });
        }
        default:
          return json(404, {});
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    mcp: `${base}/v1/mcp/authv2`,
    seen,
    setChallenge: (c: string) => (challenge = c),
    revoke: () => (valid = new Set()),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** Connects `owner` the way a browser would: /jira/connect's redirect, Atlassian's consent, the callback. */
async function connect(links: JiraLinks, atl: Awaited<ReturnType<typeof fakeAtlassian>>, owner = 'acct1') {
  const to = new URL(await links.begin(owner, 'Ada', 'https://office.example/jira/callback'));
  atl.setChallenge(to.searchParams.get('code_challenge')!);
  await links.finish(owner, to.searchParams.get('state')!, 'good');
  return to;
}

test('finds where to sign in from the MCP server, by the routes Atlassian publishes', async () => {
  const atl = await fakeAtlassian();
  try {
    const d = await discover(atl.mcp);
    assert.equal(d.as.token_endpoint, `${atl.base}/token`);
    assert.equal(d.resource, atl.mcp);
    assert.equal(d.scope, 'read:jira-work offline_access');
    // Nothing published at all: no guessing.
    await assert.rejects(discover(`${atl.base}/nothing-here`), /Couldn't find where to sign in/);
  } finally {
    await atl.close();
  }
});

test('codes and tokens only ever go to https (or this machine)', () => {
  assert.equal(safeUrl('https://auth.atlassian.com/authorize'), true);
  assert.equal(safeUrl('http://127.0.0.1:9/token'), true);
  assert.equal(safeUrl('http://evil.example/token'), false);
  assert.equal(safeUrl('javascript:alert(1)'), false);
  assert.equal(jiraServer({}), JIRA_MCP_DEFAULT);
  assert.equal(jiraServer({ AGENT_OFFICE_JIRA_MCP_URL: 'https://mcp.example/v1/mcp' }), 'https://mcp.example/v1/mcp');
});

test('connects with PKCE, keeps the tokens to itself, and refreshes them as they run out', async () => {
  const atl = await fakeAtlassian();
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-jira-'));
  let now = 1_000_000;
  const changed: string[] = [];
  try {
    const links = new JiraLinks(dir, atl.mcp, (o) => changed.push(o), fetch, () => now);
    assert.deepEqual(links.relays('acct1', 'w1', 'http://127.0.0.1:5'), []);
    const to = await connect(links, atl);
    assert.equal(to.origin + to.pathname, `${atl.base}/authorize`);
    assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(to.searchParams.get('resource'), atl.mcp);
    assert.equal(to.searchParams.get('scope'), 'read:jira-work offline_access');
    assert.equal(to.searchParams.get('redirect_uri'), 'https://office.example/jira/callback');
    assert.deepEqual(changed, ['acct1']);
    assert.deepEqual(links.state('acct1'), { status: 'connected', server: atl.mcp, since: now, by: 'Ada' });
    // Only that account's: someone else (or the office) hasn't connected.
    assert.equal(links.state('acct2').status, 'none');
    assert.deepEqual(links.relays('acct1', 'w 1', 'http://127.0.0.1:5'), [{ name: 'jira', url: 'http://127.0.0.1:5/mcp/jira?worker=w%201' }]);
    assert.equal(statSync(path.join(dir, 'jira.json')).mode & 0o777, 0o600);

    assert.equal(await links.token('acct1'), 'a1');
    // Close to running out: refreshed first, once, however many ask at the same time.
    now += 3600_000 - 30_000;
    const [x, y] = await Promise.all([links.token('acct1'), links.token('acct1')]);
    assert.deepEqual([x, y], ['a2', 'a2']);
    assert.equal(atl.seen.filter((s) => s.path === '/token').length, 2);
    // The refresh token rotated, and the office remembers it across a restart; the registration too.
    const saved = JSON.parse(readFileSync(path.join(dir, 'jira.json'), 'utf8'));
    assert.equal(saved.links.acct1.refresh, 'r2');
    const again = new JiraLinks(dir, atl.mcp, () => {}, fetch, () => now);
    assert.equal(again.state('acct1').status, 'connected');
    await connect(again, atl, 'acct2');
    assert.equal(atl.seen.filter((s) => s.path === '/register').length, 1);

    // A sign-in can't be finished by someone else, or twice.
    const other = new URL(await links.begin('acct3', 'Bo', 'https://office.example/jira/callback'));
    await assert.rejects(links.finish('acct1', other.searchParams.get('state')!, 'good'), /expired or was for someone else/);
    await assert.rejects(links.finish('acct3', 'made-up', 'good'), /expired or was for someone else/);

    // Atlassian revoked it: the refresh fails for good, the connection goes, and they're told why.
    now += 3600_000;
    assert.equal(await links.token('acct1'), undefined);
    assert.deepEqual(links.state('acct1'), { status: 'none', server: atl.mcp, error: 'Atlassian asked for Jira to be connected again' });

    // Another MCP server (AGENT_OFFICE_JIRA_MCP_URL changed): its connections don't carry over.
    assert.equal(new JiraLinks(dir, 'https://other.example/mcp', () => {}).state('acct2').status, 'none');
  } finally {
    await atl.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the relay checks the worker, swaps in the access token, retries once on a 401, and streams back', async () => {
  const atl = await fakeAtlassian();
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-jira-'));
  const links = new JiraLinks(dir, atl.mcp, () => {});
  const auth = (id: string, token: string) => (id === 'w1' && token === 'hook-tok' ? { owner: 'acct1' } : id === 'w2' && token === 'hook-2' ? { owner: '' } : undefined);
  const relay = http.createServer((req, res) => void relayMcp(links, auth, 'not connected: ☰ → Jira', req, res, new URL(req.url!, 'http://127.0.0.1')));
  await new Promise<void>((r) => relay.listen(0, '127.0.0.1', r));
  const at = `http://127.0.0.1:${(relay.address() as AddressInfo).port}/mcp/jira`;
  const call = (worker: string, token: string, init: RequestInit = {}) =>
    fetch(`${at}?worker=${worker}`, { method: 'POST', ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(init.headers as Record<string, string>) }, body: init.method === 'GET' ? undefined : JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' }) });
  try {
    await connect(links, atl);
    // Not a worker's own token: turned away without a sign-in challenge.
    const forged = await call('w1', 'guess');
    assert.equal(forged.status, 403);
    assert.equal(forged.headers.get('www-authenticate'), null);

    const ok = await call('w1', 'hook-tok', { headers: { 'mcp-session-id': 's0' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('mcp-session-id'), 's1');
    assert.deepEqual(await ok.json(), { jsonrpc: '2.0', id: 7, result: { ok: true } });
    const up = atl.seen.filter((s) => s.path === '/v1/mcp/authv2').at(-1)!;
    // Atlassian sees the person's access token and the session, never the worker's hook token.
    assert.equal(up.auth, 'Bearer a1');
    assert.equal(up.session, 's0');

    // The server's own stream comes back as it goes.
    const stream = await call('w1', 'hook-tok', { method: 'GET' });
    assert.equal(stream.headers.get('content-type'), 'text/event-stream');
    assert.match(await stream.text(), /"one":1[\s\S]*"two":2/);

    // Atlassian stopped taking the token before it ran out: refreshed, and the call goes through.
    atl.revoke();
    const retried = await call('w1', 'hook-tok');
    assert.equal(retried.status, 200);
    assert.equal(atl.seen.filter((s) => s.path === '/v1/mcp/authv2').at(-1)!.auth, 'Bearer a2');

    // Hired by someone who hasn't connected: a JSON-RPC error saying where to connect.
    const none = await call('w2', 'hook-2');
    assert.equal(none.status, 503);
    assert.deepEqual(await none.json(), { jsonrpc: '2.0', id: 7, error: { code: -32001, message: 'not connected: ☰ → Jira' } });
  } finally {
    await new Promise<void>((r) => relay.close(() => r()));
    await atl.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('each agent is started with the relayed servers, its token read from its environment', () => {
  const servers = [{ name: 'jira', url: 'http://127.0.0.1:5/mcp/jira?worker=w1' }];
  const remoteMcp = (id: string) => (id === 'w1' ? servers : []);
  const info = (id: string) => ({ id });

  // Claude Code: a second --mcp-config, inline, with ${AGENT_OFFICE_HOOK_TOKEN} for it to expand.
  const claudeArgs = (id: string) => claude.launch({ h: { info: info(id) } as never, args: [], setup: { settings: '/d/claude-hooks.json', mcp: '/d/agent-office-mcp.json', remoteMcp }, cwd: '/w' }).args;
  const withJira = claudeArgs('w1');
  assert.deepEqual(withJira.slice(0, 3), ['--mcp-config', '/d/agent-office-mcp.json', claudeRemoteMcp(servers)]);
  assert.equal(withJira[3], '--settings');
  assert.deepEqual(JSON.parse(withJira[2]), { mcpServers: { jira: { type: 'http', url: servers[0].url, headers: { Authorization: 'Bearer ${AGENT_OFFICE_HOOK_TOKEN}' } } } });
  assert.equal(withJira.join(' ').includes('hook-tok'), false);
  assert.deepEqual(claudeArgs('w2').slice(0, 3), ['--mcp-config', '/d/agent-office-mcp.json', '--settings']);

  // Codex: Streamable HTTP with the bearer token from the environment.
  const codexArgs = codex.launch({ h: { info: info('w1'), state: codex.createState!() } as never, args: [], setup: { hook: '/d/hook.cjs', remoteMcp }, cwd: '/w' }).args;
  assert.ok(codexArgs.join('\n').includes(`mcp_servers.jira.url="${servers[0].url}"\n-c\nmcp_servers.jira.bearer_token_env_var="AGENT_OFFICE_HOOK_TOKEN"`));

  // OpenCode: a remote server in its inline config, made once its token for this run is known.
  const plan = opencode.launch({ h: { info: info('w1'), state: {} } as never, args: [], setup: { plugin: '/d/plugin.js', mcpScript: '/bin/office-workers.js', remoteMcp }, cwd: '/w' });
  const env: Record<string, string> = { AGENT_OFFICE_HOOK_TOKEN: 'run-tok' };
  plan.finishEnv!(env);
  const mcp = JSON.parse(env.OPENCODE_CONFIG_CONTENT).mcp;
  assert.deepEqual(mcp.jira, { type: 'remote', url: servers[0].url, headers: { Authorization: 'Bearer run-tok' }, enabled: true });
  assert.ok(mcp['agent-office'], 'the office’s own MCP server is still there');
});
