// Your Jira connection (see jira/links.ts): an account's own, or the office's on the shared password.
// Connecting happens over HTTP (/jira/connect, http/routes/jira.ts), since the browser goes to Atlassian and back.
import type { JiraClientMsg } from '../../../shared/protocol.js';
import type { HandlerMap } from './types.js';

export const jiraHandlers = {
  'jira.get'(ctx, c) {
    ctx.sendTo(c, { t: 'jira', state: ctx.jira.state(c.accountId ?? '') });
  },
  'jira.disconnect'(ctx, c) {
    ctx.jira.disconnect(c.accountId ?? '');
  },
} satisfies HandlerMap<JiraClientMsg>;
