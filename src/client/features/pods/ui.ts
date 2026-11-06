import './ui.css';
import type { Pod } from '../../../shared/pods';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal } from '../../ui/dom';
import { podPeople, podWork } from './work';
import { renderOrg } from './org';
import { renderRoster } from './roster';

type Tab = 'pods' | 'org' | 'roster';

/** The Pods window: each pod's people and work, the org over them, and (for admins) the roster. */
export function openPods(net: Net, start: Tab = 'pods') {
  let tab: Tab = start;
  const body = h('div.body.pods');
  const tabs = h('div.pod-tabs', { role: 'tablist' });
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');
  const el = h('div.modal.pods-window', { role: 'dialog', 'aria-label': 'Pods' }, h('header', {}, h('h2', {}, '👥 Pods'), tabs, close), body);

  const render = () => {
    const tabList: [Tab, string][] = [
      ['pods', '🗂️ Pods'],
      ['org', '🏢 Org'],
      ...(store.me.admin ? [['roster', '✏️ Roster'] as [Tab, string]] : []),
    ];
    if (!tabList.some(([t]) => t === tab)) tab = 'pods';
    tabs.replaceChildren(
      ...tabList.map(([t, label]) => h('button.btn', { type: 'button', role: 'tab', class: t === tab ? 'on' : '', 'aria-selected': String(t === tab), onclick: () => ((tab = t), render()) }, label)),
    );
    const state = store.pods;
    if (!state) return body.replaceChildren(h('p.note', {}, 'Loading the pods…'));
    if (tab === 'org') return body.replaceChildren(renderOrg(state));
    if (tab === 'roster') return body.replaceChildren(renderRoster(state, { save: (next) => net.send({ t: 'pods.save', state: next }) }));
    body.replaceChildren(h('p.note.pods-intro', {}, 'Issues and PRs are this floor’s, by their pod and stage labels.'), ...state.pods.map(podCard));
  };

  function podCard(pod: Pod): HTMLElement {
    const { stages, prs, inReview } = podWork(pod);
    return h(
      'section.pod-card',
      { style: `--pod:${pod.color}` },
      h('header', {}, h('span.pod-swatch'), h('h3', {}, pod.name), h('span.pod-limit', {}, `limit ${pod.limit}`)),
      h('p.pod-people', {}, podPeople(pod) || 'No members yet', pod.pm ? ` · PM ${pod.pm}` : '', pod.sas.length ? ` · SA ${pod.sas.join(', ')}` : ''),
      h(
        'p.pod-work',
        {},
        `Issues: prepare ${stages.prepare} · plan ${stages.plan} · build ${stages.build} · release ${stages.release}`,
        ` · 🔀 ${prs} open PR${prs === 1 ? '' : 's'}${inReview ? ` (${inReview} in review)` : ''}`,
      ),
    );
  }

  // Redraw as things change, except under an admin editing the roster.
  const refresh = () => {
    if (tab !== 'roster') render();
  };
  const offs = (['pods', 'issues', 'pulls', 'me'] as const).map((t) => store.on(t, refresh));
  const modal = openModal(el, { doing: '👥 at the Pod board', onClose: () => offs.forEach((off) => off()) });
  close.addEventListener('click', () => modal.close());
  render();
}
