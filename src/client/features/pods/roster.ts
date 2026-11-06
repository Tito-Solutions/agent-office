// The Roster tab of the Pods window, for admins: each pod's name, color, limit, PM, SAs and members,
// and the people over every pod. Edits stay a draft until Save.
import { SIGN_COLORS } from '../../../shared/floorplan';
import { DEFAULT_LIMIT, MAX_MEMBERS, MAX_PODS, PERSON_MAX, POD_NAME_MAX, POD_ROLES, type Pod, type PodRole, type PodsState } from '../../../shared/pods';
import { h, toast } from '../../ui/dom';

export interface RosterDeps {
  save(state: PodsState): void;
}

const text = (value: string, max: number, placeholder: string, set: (v: string) => void) =>
  h('input', { type: 'text', value, maxlength: max, placeholder, autocomplete: 'off', spellcheck: 'false', oninput: (e: Event) => set((e.target as HTMLInputElement).value) });

const field = (label: string, input: HTMLElement) => h('label.pod-field', {}, h('span', {}, label), input);

export function renderRoster(state: PodsState, deps: RosterDeps): HTMLElement {
  const draft: PodsState = structuredClone(state);
  const root = h('div.roster');

  const draw = () => {
    root.replaceChildren(
      h('p.note', {}, 'Spell each pod’s name as its GitHub label: that’s how its issues and pull requests are found.'),
      h(
        'section.roster-org',
        {},
        h('h3', {}, '🏢 Over every pod'),
        h(
          'div.pod-row',
          {},
          field('CPO', text(draft.org.cpo ?? '', PERSON_MAX, 'Ram', (v) => (draft.org.cpo = v))),
          field('CTO', text(draft.org.cto ?? '', PERSON_MAX, 'Zer', (v) => (draft.org.cto = v))),
          field('Product Quality Lead', text(draft.org.qualityLead ?? '', PERSON_MAX, 'Marc', (v) => (draft.org.qualityLead = v))),
        ),
      ),
      ...draft.pods.map(podEditor),
      h(
        'div.roster-actions',
        {},
        draft.pods.length < MAX_PODS
          ? h(
              'button.btn',
              {
                type: 'button',
                onclick: () => {
                  draft.pods.push({ id: '', name: `Pod ${draft.pods.length + 1}`, color: SIGN_COLORS[draft.pods.length % SIGN_COLORS.length].color, members: [], sas: [], limit: DEFAULT_LIMIT });
                  draw();
                },
              },
              '＋ Add a pod',
            )
          : null,
        h('span.grow'),
        h('button.btn', { type: 'button', onclick: () => (Object.assign(draft, structuredClone(state)), draw()) }, 'Undo changes'),
        h(
          'button.btn.primary',
          {
            type: 'button',
            onclick: () => {
              if (draft.pods.some((p) => !p.name.trim())) return toast('Every pod needs a name', 'warn');
              deps.save(draft);
            },
          },
          '💾 Save the roster',
        ),
      ),
    );
  };

  function podEditor(pod: Pod, index: number): HTMLElement {
    const swatches = h(
      'div.pod-swatches',
      { role: 'radiogroup', 'aria-label': 'Color' },
      ...SIGN_COLORS.map((c) =>
        h('button.pod-swatch-btn', {
          type: 'button',
          role: 'radio',
          title: c.name,
          'aria-checked': String(pod.color === c.color),
          class: pod.color === c.color ? 'on' : '',
          style: `background:${c.color}`,
          onclick: () => ((pod.color = c.color), draw()),
        }),
      ),
    );
    const limit = h('input', { type: 'number', min: 1, max: 9, value: pod.limit, oninput: (e: Event) => (pod.limit = Number((e.target as HTMLInputElement).value) || DEFAULT_LIMIT) });
    const members = h(
      'div.roster-members',
      {},
      ...pod.members.map((m, i) =>
        h(
          'div.roster-member',
          {},
          text(m.name, PERSON_MAX, 'Name', (v) => (m.name = v)),
          h(
            'select',
            { onchange: (e: Event) => (m.role = (e.target as HTMLSelectElement).value as PodRole) },
            ...POD_ROLES.map((r) => {
              const o = h('option', { value: r }, r === 'PA' ? 'Product Analyst' : 'Developer') as HTMLOptionElement;
              o.selected = m.role === r;
              return o;
            }),
          ),
          h('button.btn', { type: 'button', title: 'Take them off the pod', onclick: () => (pod.members.splice(i, 1), draw()) }, '✕'),
        ),
      ),
      pod.members.length < MAX_MEMBERS ? h('button.btn', { type: 'button', onclick: () => (pod.members.push({ name: '', role: pod.members.some((m) => m.role === 'PA') ? 'Developer' : 'PA' }), draw()) }, '＋ Member') : null,
    );
    return h(
      'section.roster-pod',
      { style: `--pod:${pod.color}` },
      h(
        'header',
        {},
        h('span.pod-swatch'),
        text(pod.name, POD_NAME_MAX, 'Pod name, as its GitHub label', (v) => (pod.name = v)),
        h(
          'button.btn.danger',
          {
            type: 'button',
            title: 'Take this pod off the roster',
            onclick: () => {
              draft.pods.splice(index, 1);
              draw();
            },
          },
          'Remove',
        ),
      ),
      h('div.pod-row', {}, field('Color', swatches), field('Feature limit', limit)),
      h(
        'div.pod-row',
        {},
        field('PM', text(pod.pm ?? '', PERSON_MAX, 'Jhem', (v) => (pod.pm = v))),
        field('SAs (comma between)', text(pod.sas.join(', '), 120, 'Zer, Jose', (v) => (pod.sas = v.split(',').map((s) => s.trim()).filter(Boolean)))),
      ),
      field('Members', members),
    );
  }

  draw();
  return root;
}
