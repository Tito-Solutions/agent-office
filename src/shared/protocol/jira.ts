// Jira, connected from the office (☰ → Jira): every worker you hire gets Jira's tools (see
// server/jira/links.ts).

/** Your Jira connection, as the office sees it: an account's own, or the office's on the shared password. */
export interface JiraState {
  /** connected: workers you hire get Jira. none: not yet, or it was dropped. */
  status: 'connected' | 'none';
  /** The remote MCP server the office signs in to and relays workers to. */
  server: string;
  /** When it was connected, and by whom. */
  since?: number;
  by?: string;
  /** What went wrong last: a sign-in that didn't finish, or Atlassian asking to be connected again. */
  error?: string;
}

export type JiraClientMsg =
  /** Your connection, now. */
  | { t: 'jira.get' }
  /** Forget it: workers hired after this don't get Jira. */
  | { t: 'jira.disconnect' };

export type JiraServerMsg =
  /** Your connection, when asked and whenever it changes. */
  { t: 'jira'; state: JiraState };
