import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PodsStore } from '../src/server/pods.js';
import { SIGN_COLORS } from '../src/shared/floorplan.js';
import { DEFAULT_POD_NAMES, cleanPods, defaultPods, podOfLabels, stageOfLabels } from '../src/shared/pods.js';

function withDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-pods-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the office starts with the pods named on GitHub, a color each and a limit of 2', () => {
  const { pods } = defaultPods();
  assert.deepEqual(
    pods.map((p) => p.name),
    DEFAULT_POD_NAMES,
  );
  assert.deepEqual(
    pods.map((p) => p.color),
    SIGN_COLORS.map((c) => c.color),
  );
  assert.ok(pods.every((p) => p.limit === 2));
  assert.equal(new Set(pods.map((p) => p.id)).size, pods.length);
});

test('a roster is cleaned: names trimmed, duplicates dropped, colors and limits kept in range', () => {
  const state = cleanPods({
    pods: [
      { name: '  Pod   Thai ', color: '#123456', limit: 40, members: [{ name: 'Rhona', role: 'PA' }, { name: 'rhona', role: 'Developer' }, { name: 'JP', role: 'boss' }, { name: '' }], sas: ['Zer', '', 'Jose'] },
      { name: 'pod thai' },
      { name: '' },
      { name: 'Tri Pod', limit: 0 },
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
  assert.equal(tri.limit, 1);
  assert.deepEqual(state.org, { cto: 'Zer' });
  // Nothing usable at all: the pods the office starts with.
  assert.equal(cleanPods(null).pods.length, DEFAULT_POD_NAMES.length);
});

test('a roster saved before the cleanup loses its features, accounts and floors, and keeps the rest', () => {
  const state = cleanPods({
    pods: [
      {
        id: 'pod-thai',
        name: 'Pod Thai',
        account: 'Tax Maverick',
        floors: ['tax'],
        features: [{ id: 'f1', name: 'Ok', kickoff: '2026-11-01', committed: '2026-11-09' }],
        members: [{ name: 'Rhona', role: 'PA' }],
        pm: 'Jhem',
        sas: ['Zer'],
        limit: 2,
      },
    ],
    org: {},
  });
  assert.deepEqual(state.pods[0], { id: 'pod-thai', name: 'Pod Thai', color: SIGN_COLORS[0].color, members: [{ name: 'Rhona', role: 'PA' }], pm: 'Jhem', sas: ['Zer'], limit: 2 });
});

test('the roster is saved and comes back, and needs a pod', () => {
  withDir((dir) => {
    const store = new PodsStore(dir);
    const next = store.state();
    next.pods[0].name = 'Pod Thai Renamed';
    next.pods[0].members = [{ name: 'Rhona', role: 'PA' }];
    next.pods.push({ id: '', name: 'Pod Eight', color: SIGN_COLORS[1].color, members: [], sas: [], limit: 1 });
    assert.equal(store.save(next, 'Zer'), undefined);
    const again = new PodsStore(dir).state();
    assert.equal(again.pods[0].name, 'Pod Thai Renamed');
    assert.deepEqual(again.pods[0].members, [{ name: 'Rhona', role: 'PA' }]);
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

test('labels name the pod and the stage', () => {
  const pods = defaultPods().pods;
  assert.equal(podOfLabels([{ name: 'bug' }, { name: 'SalonPods' }], pods)?.name, 'SalonPods');
  assert.equal(podOfLabels([{ name: 'bug' }], pods), undefined);
  assert.equal(stageOfLabels([{ name: 'Build' }, { name: 'Pod Thai' }]), 'build');
  assert.equal(stageOfLabels([{ name: 'bug' }]), undefined);
});
