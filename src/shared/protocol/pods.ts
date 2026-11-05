// The delivery pods (see shared/pods.ts): the roster, and each pod's features from Kick Off to Sign-Off.

import type { PodsState } from '../pods.js';

/** What someone fills in for a feature at Kick Off. */
export interface PodFeatureInput {
  name: string;
  jira?: string;
  kickoff: string;
  committed: string;
}

export type PodsClientMsg =
  /** Sends the roster back: the page asks once it's in, and again after a reconnect. */
  | { t: 'pods.get' }
  /** An admin's edit of the roster and the people over it. Each pod keeps the features it has. */
  | { t: 'pods.save'; state: PodsState }
  /** A pod commits to a feature at Kick Off; `override` (admins only) takes it past the pod's limit, saying who approved it. */
  | { t: 'pods.feature.add'; pod: string; feature: PodFeatureInput; override?: string }
  /** The feature's date moved: the new one, and why. */
  | { t: 'pods.feature.recommit'; pod: string; id: string; date: string; reason: string }
  /** Signed off (step 11): it's no longer one of the pod's active features. */
  | { t: 'pods.feature.done'; pod: string; id: string };

export type PodsServerMsg = { t: 'pods'; state: PodsState };
