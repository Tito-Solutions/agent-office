// The delivery pods (see shared/pods.ts): the roster, which admins edit.

import type { PodsState } from '../pods.js';

export type PodsClientMsg =
  /** Sends the roster back: the page asks once it's in, and again after a reconnect. */
  | { t: 'pods.get' }
  /** An admin's edit of the roster and the people over it. */
  | { t: 'pods.save'; state: PodsState };

export type PodsServerMsg = { t: 'pods'; state: PodsState };
