// Pod desks doing pod work (see shared/pods.ts): a queued task that's a pod's sits down at one of that
// pod's desks when one is free, and a pull request opened from a pod's desk gets the pod's label.
import type { FloorPlan } from '../shared/floorplan.js';
import { DESK_BY_ID, builtDesks, deskBuilt } from '../shared/layout.js';
import { podDesks, podOfDesk, podOfLabels, type Pod } from '../shared/pods.js';

/** "[Pod Thai] Add the filing banner": the pod a task's title starts with, as the Queue agent writes them. */
export function podOfTitle(title: string, pods: readonly Pod[]): Pod | undefined {
  const m = /^\s*\[([^\]]{1,40})\]/.exec(title);
  const name = m?.[1].trim().toLowerCase();
  return name ? pods.find((p) => p.name.toLowerCase() === name) : undefined;
}

/** The pod a queued task is for: its title's [Pod X], else the pod label on the issue it's linked to. */
export function podOfTask(task: { title: string; issue?: number }, pods: readonly Pod[], issues: readonly { number: number; labels: { name: string }[] }[]): Pod | undefined {
  const byTitle = podOfTitle(task.title, pods);
  if (byTitle || task.issue === undefined) return byTitle;
  const issue = issues.find((i) => i.number === task.issue);
  return issue ? podOfLabels(issue.labels, pods) : undefined;
}

/** The desks a pod's task would rather sit at: the pod's, as far as the floor is built out, in desk order. */
export function preferredDesks(pod: Pod | undefined, plan: FloorPlan): string[] {
  if (!pod) return [];
  return podDesks(plan, pod)
    .filter((id) => {
      const desk = DESK_BY_ID.get(id);
      return !!desk && deskBuilt(desk, plan.wing);
    })
    .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));
}

/**
 * Where a queued task sits, best first: its pod's desks, then the desks that are no pod's, so a task
 * never takes another pod's desk while one of those is free (the queue falls back to any seat after).
 * With no pods on the floor, that's every desk in order, as the queue always seated them.
 */
export function seatOrder(pod: Pod | undefined, plan: FloorPlan, pods: readonly Pod[]): string[] {
  const neutral = builtDesks(plan.wing)
    .map((d) => d.id)
    .filter((id) => !podOfDesk(plan, pods, id));
  return [...preferredDesks(pod, plan), ...neutral];
}

/** The pod whose label a pull request opened from `deskId` gets, if the desk is one of a pod's. */
export function deskPodLabel(plan: FloorPlan, pods: readonly Pod[], deskId: string): string | undefined {
  return podOfDesk(plan, pods, deskId)?.name;
}
