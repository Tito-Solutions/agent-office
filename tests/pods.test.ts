import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PodsStore } from '../src/server/pods.js';
import { SIGN_COLORS, type FloorPlan } from '../src/shared/floorplan.js';
import {
  DEFAULT_POD_NAMES,
  cleanPods,
  daysUntil,
  defaultPods,
  dueDate,
  overLimit,
  podDesks,
  podOfDesk,
  podOfLabels,
  podTag,
  stageOfLabels,
  worksIn,
  type PodsState,
} from '../src/shared/pods.js';

function withDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-pods-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const feature = { name: 'E-signature', jira: 'TPE-12', kickoff: '2026-11-02', committed: '2026-11-20' };

test('the office starts with the pods named on GitHub, a sign color each and a limit of 2', () => {
  const { pods } = defaultPods();
  assert.deepEqual(
    pods.map((p) => p.name),
    DEFAULT_POD_NAMES,
  );
  assert.deepEqual(
    pods.map((p) => p.color),
    SIGN_COLORS.map((c) => c.color),
  );
  assert.ok(pods.every((p) => p.limit === 2 && !p.features.length));
  assert.equal(new Set(pods.map((p) => p.id)).size, pods.length);
});

test('a roster is cleaned: names trimmed, duplicates dropped, colors and limits kept in range', () => {
  const state = cleanPods({
    pods: [
      { name: '  Pod   Thai ', color: '#123456', limit: 40, members: [{ name: 'Rhona', role: 'PA' }, { name: 'rhona', role: 'Developer' }, { name: 'JP', role: 'boss' }, { name: '' }], sas: ['Zer', '', 'Jose'], floors: ['tax', 'tax'] },
      { name: 'pod thai' },
      { name: '' },
      { name: 'Tri Pod', limit: 0, features: [{ id: 'f1', name: 'Ok', kickoff: '2026-11-01', committed: '2026-11-09' }, { id: 'f2', name: 'Bad date', kickoff: 'soon', committed: '2026-11-09' }] },
    ],
    org: { cto: ' Zer ', cpo: 7 },
  });
  assert.deepEqual(
    state.pods.map((p) => p.name),
    ['Pod Thai', 'Tri Pod'],
  );
  const [thai, tri] = state.pods;
  assert.equal(thai.color, SIGN_COLORS[0].color);
  assert.equal(thai.limit, 9);
  assert.deepEqual(thai.members, [
    { name: 'Rhona', role: 'PA' },
    { name: 'JP', role: 'Developer' },
  ]);
  assert.deepEqual(thai.sas, ['Zer', 'Jose']);
  assert.deepEqual(thai.floors, ['tax']);
  assert.equal(tri.limit, 1);
  assert.deepEqual(
    tri.features.map((f) => f.id),
    ['f1'],
  );
  assert.deepEqual(state.org, { cto: 'Zer' });
  // Nothing usable at all: the pods the office starts with.
  assert.equal(cleanPods(null).pods.length, DEFAULT_POD_NAMES.length);
});

test('a pod takes features up to its limit, and past it only with who approved it', () => {
  withDir((dir) => {
    const told: PodsState[] = [];
    const store = new PodsStore(dir, (s) => told.push(s));
    const id = store.state().pods[0].id;
    const a = store.addFeature(id, feature, 'Rhona');
    assert.ok(typeof a !== 'string');
    assert.equal(a.jira, 'TPE-12');
    assert.ok(typeof store.addFeature(id, { ...feature, name: 'Invoices' }, 'Rhona') !== 'string');
    // Full now.
    const third = store.addFeature(id, { ...feature, name: 'SMS' }, 'Rhona');
    assert.match(String(third), /limit is 2.*CTO/);
    const approved = store.addFeature(id, { ...feature, name: 'SMS' }, 'Zer', 'Approved by Zer (CTO)');
    assert.ok(typeof approved !== 'string' && approved.override === 'Approved by Zer (CTO)');
    // An override isn't kept on a feature that was within the limit.
    assert.equal(a.override, undefined);
    assert.equal(told.length, 3);
    // Bad input.
    assert.match(String(store.addFeature(id, { ...feature, name: ' ' }, 'Rhona')), /Name the feature/);
    assert.match(String(store.addFeature(id, { ...feature, committed: 'next week' }, 'Rhona')), /dates?/);
    assert.match(String(store.addFeature(id, { ...feature, committed: '2026-10-01' }, 'Rhona')), /before Kick Off/);
    assert.match(String(store.addFeature('nope', feature, 'Rhona')), /no such pod/);
  });
});

test('re-committing keeps the date committed at Kick Off; signing off frees a place', () => {
  withDir((dir) => {
    const store = new PodsStore(dir);
    const id = store.state().pods[1].id;
    const f = store.addFeature(id, feature, 'Marty');
    assert.ok(typeof f !== 'string');
    assert.match(String(store.recommit(id, f.id, '2026-11-27', '')), /reason/);
    const moved = store.recommit(id, f.id, '2026-11-27', 'Client added scope');
    assert.ok(typeof moved !== 'string');
    assert.equal(moved.committed, '2026-11-20');
    assert.equal(dueDate(moved), '2026-11-27');
    assert.ok(typeof store.done(id, f.id) !== 'string');
    assert.equal(store.pod(id)!.features.length, 0);
    assert.match(String(store.done(id, f.id)), /isn’t active/);
  });
});

test('the roster is saved and comes back; a save keeps each pod’s features and needs a pod', () => {
  withDir((dir) => {
    const store = new PodsStore(dir);
    const id = store.state().pods[0].id;
    store.addFeature(id, feature, 'Rhona');
    const next = store.state();
    next.pods[0].name = 'Pod Thai Renamed';
    next.pods[0].members = [{ name: 'Rhona', role: 'PA' }];
    // Features sent with a save are ignored: the office keeps its own.
    next.pods[0].features = [];
    next.pods.push({ id: '', name: 'Pod Eight', color: SIGN_COLORS[1].color, account: 'Internal', floors: [], members: [], sas: [], limit: 1, features: [] });
    assert.equal(store.save(next, 'Zer'), undefined);
    const again = new PodsStore(dir).state();
    assert.equal(again.pods[0].name, 'Pod Thai Renamed');
    assert.equal(again.pods[0].features.length, 1);
    assert.equal(again.pods.at(-1)!.id, 'pod-eight');
    assert.equal(again.by, 'Zer');
    assert.equal(statSync(path.join(dir, 'pods.json')).mode & 0o777, 0o600);
    assert.match(String(store.save({ pods: [] }, 'Zer')), /at least one pod/);
    // A broken file: the pods the office starts with.
    writeFileSync(path.join(dir, 'pods.json'), '{nope');
    assert.equal(new PodsStore(dir).state().pods.length, DEFAULT_POD_NAMES.length);
    assert.ok(readFileSync(path.join(dir, 'pods.json'), 'utf8').startsWith('{nope'));
  });
});

test('a desk is in the pod whose name its sign says', () => {
  const { pods } = defaultPods();
  const plan: FloorPlan = {
    wing: 0,
    labels: {
      'desk-1': { text: 'pod thai', color: SIGN_COLORS[0].color, by: 'Zer', at: 0 },
      'desk-2': { text: 'Pod Thai', color: SIGN_COLORS[0].color, by: 'Zer', at: 0 },
      'desk-3': { text: 'Frontend', color: SIGN_COLORS[2].color, by: 'Zer', at: 0 },
    },
  };
  assert.equal(podOfDesk(plan, pods, 'desk-1')?.name, 'Pod Thai');
  assert.equal(podOfDesk(plan, pods, 'desk-3'), undefined);
  assert.equal(podOfDesk(plan, pods, 'desk-9'), undefined);
  assert.deepEqual(podDesks(plan, pods[0]), ['desk-1', 'desk-2']);
});

test('what someone is in the pods, for their name tag', () => {
  const state = cleanPods({
    pods: [
      { name: 'Pod Thai', members: [{ name: 'Rhona', role: 'PA' }, { name: 'JP', role: 'Developer' }], pm: 'Jhem', sas: ['Zer', 'Jose'] },
      { name: 'Tri Pod', members: [{ name: 'Bea', role: 'PA' }], pm: 'Bea', sas: ['Kim'] },
    ],
    org: { cto: 'Zer', cpo: 'Ram', qualityLead: 'Marc' },
  });
  assert.equal(podTag('rhona', state), 'Pod Thai · PA');
  assert.equal(podTag('JP', state), 'Pod Thai · Developer');
  // A member first: Bea is Tri Pod's PA (and its PM).
  assert.equal(podTag('Bea', state), 'Tri Pod · PA');
  assert.equal(podTag('Jhem', state), 'PM · Pod Thai');
  assert.equal(podTag('Zer', state), 'CTO · SA · Pod Thai');
  assert.equal(podTag('Marc', state), 'Product Quality Lead');
  assert.equal(podTag('Ram', state), 'CPO');
  assert.equal(podTag('Someone', state), undefined);
  // Over more than two pods: the account they share, else how many.
  const many = cleanPods({
    pods: ['A', 'B', 'C', 'D'].map((n, i) => ({ name: n, account: i < 3 ? 'Tax Maverick' : 'Internal', pm: i < 3 ? 'Jhem' : 'Bea', sas: i < 3 ? ['Jose'] : ['Kim'] })).concat([{ name: 'E', account: 'Internal', pm: 'Jhem', sas: ['Jose', 'Kim'] }] as never),
  });
  assert.equal(podTag('Jose', many), 'SA · 4 pods');
  assert.equal(podTag('Kim', many), 'SA · D, E');
  assert.equal(podTag('Jhem', many), 'PM · 4 pods');
  many.pods.pop();
  assert.equal(podTag('Jose', many), 'SA · Tax Maverick');
  assert.equal(podTag('Rhona', null), undefined);
  assert.ok(worksIn(state.pods[0], 'jhem'));
  assert.ok(!worksIn(state.pods[0], 'Zer'));
});

test('limits, labels and dates', () => {
  const pod = { ...defaultPods().pods[0], limit: 1 };
  assert.equal(overLimit(pod), undefined);
  pod.features = [{ id: 'a', name: 'A', kickoff: '2026-11-01', committed: '2026-11-05', by: 'x', at: 0 }];
  assert.match(String(overLimit(pod)), /limit is 1.*another needs the CTO/);
  const pods = defaultPods().pods;
  assert.equal(podOfLabels([{ name: 'bug' }, { name: 'SalonPods' }], pods)?.name, 'SalonPods');
  assert.equal(stageOfLabels([{ name: 'Build' }, { name: 'Pod Thai' }]), 'build');
  assert.equal(stageOfLabels([{ name: 'bug' }]), undefined);
  assert.equal(daysUntil('2026-11-10', '2026-11-05'), 5);
  assert.equal(daysUntil('2026-11-01', '2026-11-05'), -4);
});
