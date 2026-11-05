import type { PodsState } from '../../../shared/pods';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The delivery pods (see shared/pods.ts), once the office has sent them: the same on every floor. */
    pods: PodsState | null;
  }
  interface Topics {
    pods: true;
  }
}

export const pods: Slice = {
  init(s) {
    s.pods = null;
  },
  on: {
    pods(s, m) {
      s.pods = m.state;
      return ['pods'];
    },
  },
};
