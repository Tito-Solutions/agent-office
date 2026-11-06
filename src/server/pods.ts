import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cleanPods, defaultPods, type Pod, type PodsState } from '../shared/pods.js';

/**
 * The delivery pods: who is in each and who they turn to. Saved in .agent-office/pods.json; the
 * office starts with the pods named on GitHub (see defaultPods).
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

  pod(id: string): Pod | undefined {
    return this.saved.pods.find((p) => p.id === id);
  }

  /** An admin's edit of the roster: who's in each pod and over them. */
  save(raw: unknown, by: string): string | undefined {
    const next = cleanPods(raw);
    if (!next.pods.length) return 'Keep at least one pod';
    this.saved = { ...next, by, at: Date.now() };
    this.changed();
    return undefined;
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
