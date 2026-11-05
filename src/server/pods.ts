import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PodFeatureInput } from '../shared/protocol.js';
import { cleanDate, cleanPods, cleanText, defaultPods, MAX_FEATURES, overLimit, type Pod, type PodFeature, type PodsState } from '../shared/pods.js';

/**
 * The delivery pods, the same on every floor: who is in each, who they turn to, and the features
 * each has committed to, from Kick Off until they're signed off. Saved in .agent-office/pods.json;
 * the office starts with the pods named on GitHub (see defaultPods).
 */
export class PodsStore {
  private saved: PodsState;
  private file: string;

  constructor(
    dataDir: string,
    private onChange: (state: PodsState) => void = () => {},
  ) {
    this.file = path.join(dataDir, 'pods.json');
    this.saved = this.load();
  }

  state(): PodsState {
    return structuredClone(this.saved);
  }

  /** The pods as they are, not to be changed: for reading often (which pod a desk or a task is). */
  list(): readonly Pod[] {
    return this.saved.pods;
  }

  pod(id: string): Pod | undefined {
    return this.saved.pods.find((p) => p.id === id);
  }

  /** An admin's edit of the roster: who's in each pod and over them. Each pod that stays keeps its features. */
  save(raw: unknown, by: string): string | undefined {
    const next = cleanPods(raw);
    if (!next.pods.length) return 'Keep at least one pod';
    for (const p of next.pods) p.features = this.pod(p.id)?.features ?? [];
    this.saved = { ...next, by, at: Date.now() };
    this.changed();
    return undefined;
  }

  /** A pod commits to a feature at Kick Off. Past its limit only with `override`: who approved it. What went wrong, if anything. */
  addFeature(podId: string, input: PodFeatureInput, by: string, override?: string): PodFeature | string {
    const pod = this.pod(podId);
    if (!pod) return 'There’s no such pod';
    const name = cleanText(input?.name, 80);
    const kickoff = cleanDate(input?.kickoff);
    const committed = cleanDate(input?.committed);
    if (!name) return 'Name the feature';
    if (!kickoff || !committed) return 'Give the Kick Off date and the committed date';
    if (committed < kickoff) return 'The committed date can’t be before Kick Off';
    if (pod.features.length >= MAX_FEATURES) return `${pod.name} has ${MAX_FEATURES} features already`;
    const why = cleanText(override, 160);
    const full = overLimit(pod);
    if (full && !why) return full;
    const jira = cleanText(input?.jira, 24);
    const feature: PodFeature = { id: randomUUID().slice(0, 8), name, ...(jira ? { jira } : {}), kickoff, committed, ...(full ? { override: why } : {}), by, at: Date.now() };
    pod.features.push(feature);
    this.changed();
    return feature;
  }

  /** A feature's date moved. The one committed at Kick Off stays as it was. */
  recommit(podId: string, id: string, date: unknown, reason: unknown): PodFeature | string {
    const f = this.pod(podId)?.features.find((x) => x.id === id);
    if (!f) return 'That feature isn’t active any more';
    const d = cleanDate(date);
    const why = cleanText(reason, 160);
    if (!d || !why) return 'Give the new date and the reason it moved';
    f.recommitted = [...(f.recommitted ?? []), { date: d, reason: why }].slice(-20);
    this.changed();
    return f;
  }

  /** Signed off: no longer one of the pod's active features. */
  done(podId: string, id: string): PodFeature | string {
    const pod = this.pod(podId);
    const i = pod?.features.findIndex((x) => x.id === id) ?? -1;
    if (!pod || i < 0) return 'That feature isn’t active any more';
    const [f] = pod.features.splice(i, 1);
    this.changed();
    return f;
  }

  private changed() {
    this.persist();
    this.onChange(this.state());
  }

  private load(): PodsState {
    if (!existsSync(this.file)) return defaultPods();
    try {
      const state = cleanPods(JSON.parse(readFileSync(this.file, 'utf8')));
      return state.pods.length ? state : defaultPods();
    } catch {
      // A broken file just means the pods the office starts with.
      return defaultPods();
    }
  }

  private persist() {
    try {
      writeFileSync(this.file, JSON.stringify(this.saved, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}
