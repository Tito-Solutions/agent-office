import type { JiraState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Your Jira connection (an account's own, or the office's on the shared password); null until asked. */
    jira: JiraState | null;
  }
  interface Topics {
    jira: true;
  }
}

export const jira: Slice = {
  init(s) {
    s.jira = null;
  },
  on: {
    jira(s, m) {
      s.jira = m.state;
      return ['jira'];
    },
  },
};
