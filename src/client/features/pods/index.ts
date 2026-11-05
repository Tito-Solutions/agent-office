/**
 * The delivery pods in the office: the Pod board out on the floor (a card per pod), the Pods window
 * it opens (each pod's features and work, the org, and the roster admins edit), and what someone is
 * in the pods, under their name.
 */
import { dueDate, podTag, today, type Pod } from '../../../shared/pods';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { openPods } from './ui';
import { podPeople, podWork, podWorkers } from './work';
import { drawPodBoard, type PodCard } from './world';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    pods: true;
  }
}

function card(pod: Pod, now: string): PodCard {
  const { desks, workers } = podWorkers(pod);
  return {
    name: pod.name,
    color: pod.color,
    features: pod.features.length,
    limit: pod.limit,
    late: pod.features.filter((f) => dueDate(f) < now).length,
    people: podPeople(pod),
    ...podWork(pod),
    desks: desks.size,
    workers: workers.length,
    needsInput: workers.some((w) => w.status === 'needs_input'),
  };
}

export function installPods(ctx: Ctx) {
  const { net } = ctx;
  // The roster isn't part of the welcome: ask for it once in, and after every reconnect.
  ctx.messages.on('welcome', () => net.send({ t: 'pods.get' }));

  /** The pods this floor works on first, then the rest. */
  const shown = (): Pod[] => {
    const pods = store.pods?.pods ?? [];
    const here = pods.filter((p) => !p.floors.length || (store.floor && p.floors.includes(store.floor)));
    return here.length ? here : pods;
  };
  let drawn = '';
  const render = () => {
    const now = today();
    const cards = shown().map((p) => card(p, now));
    const floorName = store.floors.find((f) => f.id === store.floor)?.name;
    const k = JSON.stringify([cards, floorName]);
    if (k === drawn) return;
    drawn = k;
    drawPodBoard(cards, floorName);
  };
  for (const topic of ['pods', 'issues', 'pulls', 'workers', 'floorPlan', 'floor', 'floors'] as const) store.on(topic, render);
  render();

  const showPods = () => openPods(net);

  ctx.interactions.define('pods', {
    reach: 6,
    hint: () => {
      const pods = store.pods?.pods ?? [];
      const full = pods.filter((p) => p.features.length >= p.limit).length;
      return { k: `${pods.length}|${full}`, parts: [hintTitle('👥 Pod board'), aside(pods.length ? `${pods.length} pods${full ? ` · ${full} full` : ''}` : 'the delivery pods'), key('E', 'Open')] };
    },
    use: onE(() => showPods()),
  });

  /** What `name` is in the pods, for their name tag and the people list: "Pod Thai · PA". */
  const tagFor = (name: string) => podTag(name, store.pods);
  /** Runs `fn` whenever the roster changes, so name tags can catch up. */
  const onTags = (fn: () => void) => store.on('pods', fn);

  return { showPods, tagFor, onTags };
}
