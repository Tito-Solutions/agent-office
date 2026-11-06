// The Org tab of the Pods window: the CPO and CTO at the top, then each PM with the pods they lead,
// the Solutions Architects and the pods they cover, and the Product Quality Lead over every pod.
// All from the roster, so it's as current as the roster is.
import type { Pod, PodsState } from '../../../shared/pods';
import { h } from '../../ui/dom';

/** People and the pods they're over, in the order they first come up. */
function byPerson(pods: readonly Pod[], who: (p: Pod) => readonly string[]): [string, Pod[]][] {
  const out = new Map<string, Pod[]>();
  for (const p of pods)
    for (const name of who(p)) {
      const k = [...out.keys()].find((n) => n.toLowerCase() === name.toLowerCase()) ?? name;
      out.set(k, [...(out.get(k) ?? []), p]);
    }
  return [...out];
}

const chip = (p: Pod) => h('span.pod-chip', { style: `--pod:${p.color}` }, p.name);

function person(title: string, name: string | undefined, note?: string): HTMLElement {
  return h('div.org-person', { class: name ? '' : 'vacant' }, h('div.org-title', {}, title), h('div.org-name', {}, name || 'Not set'), note ? h('div.org-note', {}, note) : null);
}

export function renderOrg(state: PodsState): HTMLElement {
  const { pods, org } = state;
  const pms = byPerson(pods, (p) => (p.pm ? [p.pm] : []));
  const sas = byPerson(pods, (p) => p.sas);
  const noPm = pods.filter((p) => !p.pm);
  const group = (title: string, rows: [string, Pod[]][], what: string) =>
    h(
      'div.org-group',
      {},
      h('h4', {}, title),
      rows.length
        ? h('div.org-row', {}, ...rows.map(([name, ps]) => h('div.org-person', {}, h('div.org-title', {}, what), h('div.org-name', {}, name), h('div.org-pods', {}, ...ps.map(chip)))))
        : h('p.note', {}, `No ${what}s on the roster yet.`),
    );
  return h(
    'div.org',
    {},
    h('div.org-row.org-top', {}, person('CPO', org.cpo, 'Product direction, contract scope; the PMs and the Product Quality Lead report here'), person('CTO', org.cto, 'Pod capacity, where new work goes; the SAs report here')),
    group('Product Managers: what to build and why', pms, 'PM'),
    noPm.length ? h('p.note', {}, 'No PM yet: ', ...noPm.map(chip)) : null,
    group('Solutions Architects: how well, when it’s needed', sas, 'SA'),
    h('div.org-group', {}, h('h4', {}, 'Product quality'), h('div.org-row', {}, person('Product Quality Lead', org.qualityLead, 'One quality standard for every pod; co-signs high-risk work'))),
    h(
      'div.org-group',
      {},
      h('h4', {}, 'Pods: how and when'),
      h(
        'div.org-pods-grid',
        {},
        ...pods.map((p) =>
          h(
            'div.org-pod',
            { style: `--pod:${p.color}` },
            h('div.org-pod-name', {}, p.name),
            h('div.org-note', {}, p.members.map((m) => `${m.name} (${m.role})`).join(', ') || 'No members yet'),
          ),
        ),
      ),
    ),
  );
}
