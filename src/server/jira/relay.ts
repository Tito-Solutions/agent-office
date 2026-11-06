// The relay between a worker's agent and a remote MCP server the office signed in to (see links.ts):
// /mcp/jira on the loopback hook server. The worker proves who it is with its own hook token, like
// its hooks do; the relay passes the MCP traffic on (Streamable HTTP: POSTs answered with JSON or an
// event stream, a GET for the server's own stream, a DELETE to end the session) with the access token
// of whoever hired it, refreshed and tried again once when the server turns it away.
import type http from 'node:http';
import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { readBytes, send } from '../http/util.js';
import type { Owner } from './links.js';

/** What the relay needs of the connection: where to call, and with what token. */
export interface McpUpstream {
  readonly server: string;
  token(owner: Owner, fresh?: boolean): Promise<string | undefined>;
}

/** Who's asking: the worker whose hook token this is, and the account that hired it ('' for the office). */
export type WorkerAuth = (workerId: string, token: string) => { owner: Owner } | undefined;

/** Request headers the server needs; everything else (the worker's token above all) stays here. */
const FORWARD = ['accept', 'content-type', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id'];
/** Response headers the agent needs. Never www-authenticate: the agent mustn't try signing in to the relay. */
const BACK = ['content-type', 'mcp-session-id', 'mcp-protocol-version', 'cache-control'];
const MAX_BODY = 8 * 1024 * 1024;

/** A JSON-RPC error the agent can show, for request `id` when there was one. */
function rpcError(res: http.ServerResponse, status: number, message: string, body?: Uint8Array) {
  let id: unknown = null;
  try {
    const msg = body && JSON.parse(Buffer.from(body).toString('utf8'));
    if (msg && typeof msg === 'object' && 'id' in msg) id = msg.id;
  } catch {
    // not JSON-RPC
  }
  send(res, status, { jsonrpc: '2.0', id, error: { code: -32001, message } });
}

export async function relayMcp(up: McpUpstream, auth: WorkerAuth, notConnected: string, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const workerId = url.searchParams.get('worker') ?? '';
  const who = auth(workerId, (req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
  // 403, not 401: a 401 would send the agent off looking for a sign-in page.
  if (!who) return send(res, 403, { error: 'Send your own AGENT_OFFICE_WORKER_ID as ?worker= and AGENT_OFFICE_HOOK_TOKEN as the bearer token' });
  const method = req.method ?? 'GET';
  if (!['GET', 'POST', 'DELETE'].includes(method)) return send(res, 405, { error: 'GET, POST or DELETE' });
  let body: Uint8Array<ArrayBuffer> | undefined;
  if (method === 'POST') {
    try {
      body = new Uint8Array(await readBytes(req, MAX_BODY));
    } catch {
      return send(res, 413, { error: 'Too large' });
    }
  }
  const headers: Record<string, string> = {};
  for (const h of FORWARD) {
    const v = req.headers[h];
    if (typeof v === 'string') headers[h] = v;
  }
  const abort = new AbortController();
  res.on('close', () => abort.abort());

  const call = async (fresh: boolean) => {
    const token = await up.token(who.owner, fresh);
    if (!token) return undefined;
    return fetch(up.server, { method, headers: { ...headers, authorization: `Bearer ${token}` }, body, signal: abort.signal });
  };
  let reply: Response | undefined;
  try {
    reply = await call(false);
    if (reply?.status === 401) {
      await reply.body?.cancel();
      reply = await call(true);
    }
  } catch (err) {
    if (abort.signal.aborted) return;
    return rpcError(res, 502, `Couldn't reach ${new URL(up.server).host}: ${(err as Error).message}`, body);
  }
  if (!reply) return rpcError(res, 503, notConnected, body);
  // Still turned away after a fresh token: the person has to connect again, which the office tells them.
  if (reply.status === 401) {
    await reply.body?.cancel();
    return rpcError(res, 503, notConnected, body);
  }
  const out: Record<string, string> = {};
  for (const h of BACK) {
    const v = reply.headers.get(h);
    if (v) out[h] = v;
  }
  res.writeHead(reply.status, out);
  if (!reply.body) return void res.end();
  const stream = Readable.fromWeb(reply.body as ReadableStream);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
