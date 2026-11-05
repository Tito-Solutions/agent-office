import './ui.css';
import { builtDesks, DESK_BY_ID } from '../../../shared/layout';
import { canLabel } from '../../../shared/floorplan';
import { daysUntil, dueDate, podDesks, today, worksIn, type Pod, type PodFeature } from '../../../shared/pods';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal, toast } from '../../ui/dom';
import { podPeople, podWork, podWorkers } from './work';
import { renderOrg } from './org';
import { renderRoster } from './roster';

type Tab = 'pods' | 'org' | 'roster';

/** Your name as the roster knows you: your account's, else the one you go by. */
function myName(): string {
  return store.me.account?.name ?? store.peers.get(store.you ?? '')?.name ?? '';
}

/** Whether you may change `pod`'s features: admins, and its members and PM. */
function mayChange(pod: Pod): boolean {
  return store.me.admin || worksIn(pod, myName());
}

/** "due in 5 days", "due today", "3 days late". */
function due(f: PodFeature): { text: string; late: boolean } {
  const d = daysUntil(dueDate(f), today());
  if (d < 0) return { text: `${-d} day${d === -1 ? '' : 's'} late`, late: true };
  return { text: d === 0 ? 'due today' : `due in ${d} day${d === 1 ? '' : 's'}`, late: false };
}

/** The Pods window: each pod's features and work, the org over them, and (for admins) the roster. */
export function openPods(net: Net, start: Tab = 'pods') {
  let tab: Tab = start;
  /** A form open in the Pods tab: what it's for, so the window isn't redrawn under someone typing. */
  let form: { pod: string; kind: 'add' | 'recommit' | 'desks'; feature?: string } | null = null;
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
      ...tabList.map(([t, label]) =>
        h('button.btn', { type: 'button', role: 'tab', class: t === tab ? 'on' : '', 'aria-selected': String(t === tab), onclick: () => ((tab = t), (form = null), render()) }, label),
      ),
    );
    const state = store.pods;
    if (!state) return body.replaceChildren(h('p.note', {}, 'Loading the pods…'));
    if (tab === 'org') return body.replaceChildren(renderOrg(state));
    if (tab === 'roster')
      return body.replaceChildren(
        renderRoster(state, {
          save: (next) => net.send({ t: 'pods.save', state: next }),
          floors: store.floors.map((f) => ({ id: f.id, name: f.name })),
        }),
      );
    body.replaceChildren(
      h('p.note.pods-intro', {}, 'A pod carries at most its limit of active features, from Kick Off (step 7) to Sign-Off (step 11). Issues and PRs are this floor’s, by their pod and stage labels.'),
      ...state.pods.map(podCard),
    );
  };

  function podCard(pod: Pod): HTMLElement {
    const may = mayChange(pod);
    const full = pod.features.length >= pod.limit;
    const { stages, prs, inReview } = podWork(pod);
    const { desks, workers } = podWorkers(pod);
    const deskNames = [...desks].map((id) => DESK_BY_ID.get(id)?.label ?? id).join(', ');
    const features = h(
      'ul.pod-features',
      {},
      ...pod.features.map((f) => {
        const d = due(f);
        return h(
          'li',
          {},
          h('div.pod-feature-main', {}, h('strong', {}, f.name), f.jira ? h('span.pod-jira', {}, f.jira) : null, f.override ? h('span.pod-override', { title: f.override }, 'over limit') : null),
          h(
            'div.pod-feature-meta',
            {},
            `Kick Off ${f.kickoff} · committed ${f.committed}`,
            ...(f.recommitted ?? []).map((r) => h('span.pod-recommit', { title: r.reason }, ` → ${r.date}`)),
            ' · ',
            h('span', { class: d.late ? 'pod-late' : '' }, d.text),
          ),
          may
            ? h(
                'div.pod-feature-actions',
                {},
                h('button.btn', { type: 'button', onclick: () => ((form = { pod: pod.id, kind: 'recommit', feature: f.id }), render()) }, '📅 Re-commit'),
                h('button.btn', { type: 'button', onclick: () => confirm(`Mark “${f.name}” as signed off? It stops counting against ${pod.name}'s limit.`) && net.send({ t: 'pods.feature.done', pod: pod.id, id: f.id }) }, '✓ Signed off'),
              )
            : null,
          form?.kind === 'recommit' && form.feature === f.id && form.pod === pod.id ? recommitForm(pod, f) : null,
        );
      }),
    );
    const canAdd = may && (!full || store.me.admin);
    return h(
      'section.pod-card',
      { style: `--pod:${pod.color}` },
      h(
        'header',
        {},
        h('span.pod-swatch'),
        h('h3', {}, pod.name),
        h('span.pod-limit', { class: full ? 'full' : '' }, `${pod.features.length}/${pod.limit} features${full ? ' · full' : ''}`),
      ),
      h(
        'p.pod-people',
        {},
        podPeople(pod) || 'No members yet',
        pod.pm ? ` · PM ${pod.pm}` : '',
        pod.sas.length ? ` · SA ${pod.sas.join(', ')}` : '',
        pod.account ? h('span.pod-account', {}, ` · ${pod.account}`) : '',
      ),
      features,
      pod.features.length ? null : h('p.note', {}, 'No active features.'),
      h(
        'p.pod-work',
        {},
        `Issues: prepare ${stages.prepare} · plan ${stages.plan} · build ${stages.build} · release ${stages.release}`,
        ` · 🔀 ${prs} open PR${prs === 1 ? '' : 's'}${inReview ? ` (${inReview} in review)` : ''}`,
      ),
      h('p.pod-work', {}, desks.size ? `🪑 ${deskNames} · 🤖 ${workers.length} worker${workers.length === 1 ? '' : 's'}${workers.some((w) => w.status === 'needs_input') ? ' · 🙋 one needs you' : ''}` : '🪑 No desks on this floor yet'),
      h(
        'div.pod-actions',
        {},
        canAdd ? h('button.btn.primary', { type: 'button', onclick: () => ((form = { pod: pod.id, kind: 'add' }), render()) }, '＋ Feature at Kick Off') : null,
        may && full && !store.me.admin ? h('span.note', {}, 'Full: another feature needs the CTO’s approval, which an admin records.') : null,
        store.me.admin && store.floor ? h('button.btn', { type: 'button', onclick: () => ((form = { pod: pod.id, kind: 'desks' }), render()) }, '🪑 Desks here') : null,
      ),
      form?.pod === pod.id && form.kind === 'add' ? addForm(pod, full) : null,
      form?.pod === pod.id && form.kind === 'desks' ? desksForm(pod) : null,
    );
  }

  const cancel = () => h('button.btn', { type: 'button', onclick: () => ((form = null), render()) }, 'Cancel');
  const field = (label: string, input: HTMLElement) => h('label.pod-field', {}, h('span', {}, label), input);

  function addForm(pod: Pod, full: boolean): HTMLElement {
    const name = h('input', { type: 'text', maxlength: 80, placeholder: 'Client portal: e-signature', autocomplete: 'off' }) as HTMLInputElement;
    const jira = h('input', { type: 'text', maxlength: 24, placeholder: 'TPE-123', autocomplete: 'off' }) as HTMLInputElement;
    const kickoff = h('input', { type: 'date', value: today() }) as HTMLInputElement;
    const committed = h('input', { type: 'date' }) as HTMLInputElement;
    const override = full ? (h('input', { type: 'text', maxlength: 160, placeholder: 'Approved by Zer (CTO) on…', autocomplete: 'off' }) as HTMLInputElement) : null;
    const f = h(
      'form.pod-form',
      {},
      field('Feature', name),
      h('div.pod-row', {}, field('JIRA Epic', jira), field('Kick Off', kickoff), field('Committed date', committed)),
      override ? field(`${pod.name} is full: who approved taking it on`, override) : null,
      h('div.pod-form-actions', {}, cancel(), h('button.btn.primary', { type: 'submit' }, '🚀 Commit')),
    ) as HTMLFormElement;
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!name.value.trim() || !committed.value) return toast('Name the feature and give its committed date', 'warn');
      if (override && !override.value.trim()) return toast('Say who approved going past the limit', 'warn');
      net.send({ t: 'pods.feature.add', pod: pod.id, feature: { name: name.value, jira: jira.value || undefined, kickoff: kickoff.value, committed: committed.value }, override: override?.value || undefined });
      form = null;
    });
    queueMicrotask(() => name.focus());
    return f;
  }

  function recommitForm(pod: Pod, feature: PodFeature): HTMLElement {
    const date = h('input', { type: 'date', value: dueDate(feature) }) as HTMLInputElement;
    const reason = h('input', { type: 'text', maxlength: 160, placeholder: 'Client added scope (client change)', autocomplete: 'off' }) as HTMLInputElement;
    const f = h(
      'form.pod-form',
      {},
      h('p.note', {}, `The date committed at Kick Off (${feature.committed}) stays on record.`),
      h('div.pod-row', {}, field('New date', date), field('Why it moved', reason)),
      h('div.pod-form-actions', {}, cancel(), h('button.btn.primary', { type: 'submit' }, '📅 Re-commit')),
    ) as HTMLFormElement;
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!date.value || !reason.value.trim()) return toast('Give the new date and why it moved', 'warn');
      net.send({ t: 'pods.feature.recommit', pod: pod.id, id: feature.id, date: date.value, reason: reason.value });
      form = null;
    });
    return f;
  }

  /** Picks the desks on this floor that hang the pod's sign: the desks it works at. */
  function desksForm(pod: Pod): HTMLElement {
    const mine = new Set(podDesks(store.floorPlan, pod));
    const boxes = builtDesks(store.floorPlan.wing)
      .filter((d) => canLabel(d.id))
      .map((d) => {
        const sign = store.floorPlan.labels[d.id]?.text;
        const box = h('input', { type: 'checkbox', value: d.id }) as HTMLInputElement;
        box.checked = mine.has(d.id);
        return { id: d.id, box, el: h('label.pod-desk', {}, box, ` ${d.label}`, sign && !mine.has(d.id) ? h('span.note', {}, ` (now “${sign}”)`) : null) };
      });
    const f = h(
      'form.pod-form',
      {},
      h('p.note', {}, `Ticked desks get a “${pod.name}” sign over them, in its color: its workers sit there. Pressing L at a desk and typing the pod's name does the same.`),
      h('div.pod-desks', {}, ...boxes.map((b) => b.el)),
      h('div.pod-form-actions', {}, cancel(), h('button.btn.primary', { type: 'submit' }, '🪧 Hang the signs')),
    ) as HTMLFormElement;
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      for (const { id, box } of boxes) {
        if (box.checked && !mine.has(id)) net.send({ t: 'desk.label', deskId: id, text: pod.name, color: pod.color });
        else if (!box.checked && mine.has(id)) net.send({ t: 'desk.label', deskId: id, text: '' });
      }
      form = null;
      render();
    });
    return f;
  }

  // Redraw as things change, except under someone filling in a form.
  const refresh = () => {
    if (!form && tab !== 'roster') render();
  };
  const offs = (['pods', 'issues', 'pulls', 'workers', 'floorPlan', 'me'] as const).map((t) => store.on(t, refresh));
  const modal = openModal(el, { doing: '👥 at the Pod board', onClose: () => offs.forEach((off) => off()) });
  close.addEventListener('click', () => modal.close());
  render();
}
