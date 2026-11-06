import './team.css';
import './signins.css';
import './jira.css';
import type { JiraState } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, type Modal } from './dom';
import { confirmDialog } from './prompt';

let open: Modal | null = null;

const when = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * 🧩 Jira: connect it once, here, and every worker you hire gets Jira's tools, with no sign-in steps
 * in their terminals. The office signs in to Atlassian itself (a tab to Atlassian's page and back)
 * and relays the workers' calls with your token (see server/jira/links.ts).
 */
export function openJira(net: Net) {
  if (open) return;
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');
  const card = h('div.signins');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': 'Jira', style: 'width:min(600px,100%)' },
    h('header', {}, h('h2', {}, '🧩 Jira'), close),
    h(
      'div.body.team',
      {},
      h('p.note.lead', {}, 'Connect Jira once and every worker you hire can find, read, create and update issues, as you. The office keeps the sign-in and hands it to your workers itself: nothing to approve in their terminals.'),
      card,
      h(
        'p.note',
        {},
        'Workers already at their desks get it the next time they start: type ',
        h('code', {}, '/exit'),
        ' in a worker’s terminal, then press ',
        h('kbd', {}, 'R'),
        ' at its desk, and it carries on where it left off.',
      ),
      h('p.note.jira-tools', {}, 'Claude Code workers see Jira’s tools as ', h('code', {}, 'mcp__jira__…'), '; Codex and OpenCode workers get them too.'),
    ),
  );
  /** A tab sent to Atlassian, until the office hears back. */
  let waiting = false;

  const button = (label: string, onClick: () => void, cls = '') => {
    const b = h('button.btn', { type: 'button', class: cls }, label);
    b.addEventListener('click', onClick);
    return b;
  };

  const connect = () => {
    waiting = true;
    // A tab of its own, so the office stays where it is; it closes itself once Atlassian sends it back.
    const tab = window.open('/jira/connect', 'agent-office-jira', 'popup,width=620,height=760');
    if (!tab) location.assign('/jira/connect');
    render();
  };

  const view = (s: JiraState) => {
    const ok = s.status === 'connected';
    const who = ok ? `✅ Connected${s.by ? ` by ${s.by}` : ''}${s.since ? ` · ${when(s.since)}` : ''}` : waiting ? '⏳ Finish on Atlassian’s page…' : 'Not connected';
    let host = s.server;
    try {
      host = new URL(s.server).host;
    } catch {
      // shown as it is
    }
    const body = h('div.signin-body');
    if (s.error && !ok) body.append(h('p.team-status.error', {}, s.error));
    if (!store.me.account) body.append(h('p.note', {}, 'On the shared office password this is the office’s own connection: everyone’s workers use it.'));
    const actions = h('div.signin-actions');
    if (ok) {
      actions.append(
        button('Reconnect', connect),
        button('Disconnect', () =>
          confirmDialog('Disconnect Jira?', 'Workers you hire from now on won’t have Jira, and the ones that have it lose it.', 'Disconnect', () => net.send({ t: 'jira.disconnect' })),
        ),
      );
    } else {
      actions.append(button(waiting ? 'Open Atlassian’s page again' : 'Connect Jira', connect, 'primary'));
    }
    body.append(actions);
    return h(
      'section.signin.jira-card',
      { class: ok ? 'ok' : waiting ? 'busy' : 'none' },
      h('div.team-head', {}, h('div', {}, h('h4', {}, '🧩 Atlassian'), h('span.jira-server', {}, host)), h('span.signin-who', { class: ok ? 'ok' : 'none' }, who)),
      body,
    );
  };

  const render = () => {
    const s = store.jira;
    if (s && (s.status === 'connected' || s.error)) waiting = false;
    card.replaceChildren(s ? view(s) : h('p.empty', {}, 'Loading…'));
  };

  const unsub = store.on('jira', render);
  open = openModal(el, {
    onClose: () => {
      unsub();
      open = null;
    },
  });
  close.addEventListener('click', () => open?.close());
  render();
  net.send({ t: 'jira.get' });
}
