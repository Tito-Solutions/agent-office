// /mcp/jira on the hook server: a worker's agent reaching Jira through the office (see relay.ts),
// with the connection of whoever hired it ('' for the office's own).
import type http from 'node:http';
import type { Ctx } from '../office/context.js';
import { relayMcp } from './relay.js';

const NOT_CONNECTED = "Jira isn't connected for whoever hired this worker: they can connect it in the office under ☰ → 🧩 Jira";

export function jiraRelay(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const auth = (workerId: string, token: string) => {
    const workers = ctx.workerFloor(workerId)?.workers;
    return workers?.authenticate(workerId, token) ? { owner: workers.ownerOf(workerId) ?? '' } : undefined;
  };
  return relayMcp(ctx.jira, auth, NOT_CONNECTED, req, res, url);
}
