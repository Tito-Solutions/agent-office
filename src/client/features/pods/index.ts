/**
 * The delivery pods in the office: the Pod board out on the floor (a card per pod) and the Pods
 * window it opens (each pod's work, the org, and the roster admins edit).
 */
import type { Pod } from '../../../shared/pods';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { openPods } from './ui';
import { podPeople, podWork } from './work';
import { drawPodBoard, type PodCard } from './world';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    pods: true;
  }
}

function card(pod: Pod): PodCard {
  return { name: pod.name, color: pod.color, people: podPeople(pod), ...podWork(pod) };
}

export function installPods(ctx: Ctx) {
  const { net } = ctx;
  // The roster isn't part of the welcome: ask for it once in, and after every reconnect.
  ctx.messages.on('welcome', () => net.send({ t: 'pods.get' }));

  let drawn = '';
  const render = () => {
    const cards = (store.pods?.pods ?? []).map(card);
    const floorName = store.floors.find((f) => f.id === store.floor)?.name;
    const k = JSON.stringify([cards, floorName]);
    if (k === drawn) return;
    drawn = k;
    drawPodBoard(cards, floorName);
  };
  for (const topic of ['pods', 'issues', 'pulls', 'floor', 'floors'] as const) store.on(topic, render);
  render();

  const showPods = () => openPods(net);

  ctx.interactions.define('pods', {
    reach: 6,
    hint: () => {
      const pods = store.pods?.pods ?? [];
      return { k: String(pods.length), parts: [hintTitle('👥 Pod board'), aside(pods.length ? `${pods.length} pods` : 'the delivery pods'), key('E', 'Open')] };
    },
    use: onE(() => showPods()),
  });

  return { showPods };
}
