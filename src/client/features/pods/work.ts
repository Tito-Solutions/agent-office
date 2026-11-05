// What a pod has on this floor: its issues by stage, its pull requests, the workers at its desks.
import { podDesks, podOfLabels, stageOfLabels, STAGES, type Pod, type Stage } from '../../../shared/pods';
import { store } from '../../state';

/** A pod's open issues on this floor by stage, its open pull requests, and those waiting on a review. */
export function podWork(pod: Pod): { stages: Record<Stage, number>; prs: number; inReview: number } {
  const pods = store.pods?.pods ?? [];
  const stages = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const i of store.issues.items) {
    if (i.state !== 'OPEN' || podOfLabels(i.labels, pods) !== pod) continue;
    const s = stageOfLabels(i.labels);
    if (s) stages[s]++;
  }
  const open = store.pulls.items.filter((p) => p.state === 'OPEN' && podOfLabels(p.labels, pods) === pod);
  return { stages, prs: open.length, inReview: open.filter((p) => !p.isDraft && p.reviewDecision !== 'APPROVED').length };
}

/** The workers at a pod's desks on this floor. */
export function podWorkers(pod: Pod) {
  const desks = new Set(podDesks(store.floorPlan, pod));
  return { desks, workers: [...store.workers.values()].filter((w) => desks.has(w.deskId)) };
}

/** "PA Rhona · Dev JP, Irefrans". */
export function podPeople(pod: Pod): string {
  const pa = pod.members.filter((m) => m.role === 'PA').map((m) => m.name);
  const dev = pod.members.filter((m) => m.role === 'Developer').map((m) => m.name);
  return [pa.length ? `PA ${pa.join(', ')}` : '', dev.length ? `Dev ${dev.join(', ')}` : ''].filter(Boolean).join(' · ');
}
