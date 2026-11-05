import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deskPodLabel, podOfTask, podOfTitle, preferredDesks, seatOrder } from '../src/server/pod-desks.js';
import { TaskQueue, type QueueWorkers } from '../src/server/queue.js';
import { SIGN_COLORS, type FloorPlan } from '../src/shared/floorplan.js';
import { defaultPods } from '../src/shared/pods.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

const pods = defaultPods().pods;
const sign = (text: string) => ({ text, color: SIGN_COLORS[0].color, by: 'Zer', at: 0 });
const plan: FloorPlan = { wing: 0, labels: { 'desk-10': sign('Pod Thai'), 'desk-2': sign('Pod Thai'), 'desk-3': sign('Tri Pod'), 'desk-17': sign('Pod Thai') } };

test('a task is a pod’s by its [Pod X] title, else by its issue’s pod label', () => {
  assert.equal(podOfTitle('[Pod Thai] Add the filing banner', pods)?.name, 'Pod Thai');
  assert.equal(podOfTitle('  [salonpods] Fix it', pods)?.name, 'SalonPods');
  assert.equal(podOfTitle('[Nobody] Fix it', pods), undefined);
  assert.equal(podOfTitle('Fix [Pod Thai] later', pods), undefined);
  const issues = [{ number: 7, labels: [{ name: 'bug' }, { name: 'Tri Pod' }] }];
  assert.equal(podOfTask({ title: 'Fix the bug', issue: 7 }, pods, issues)?.name, 'Tri Pod');
  // The title says so first.
  assert.equal(podOfTask({ title: '[Pod Trip] Fix the bug', issue: 7 }, pods, issues)?.name, 'Pod Trip');
  assert.equal(podOfTask({ title: 'Fix the bug', issue: 8 }, pods, issues), undefined);
  assert.equal(podOfTask({ title: 'Fix the bug' }, pods, issues), undefined);
});

test('a pod’s desks, in order and only where the floor is built out', () => {
  // desk-17 is in the back office, which isn't built.
  assert.deepEqual(preferredDesks(pods[0], plan), ['desk-2', 'desk-10']);
  assert.deepEqual(preferredDesks(pods[0], { ...plan, wing: 1 }), ['desk-2', 'desk-10', 'desk-17']);
  assert.deepEqual(preferredDesks(undefined, plan), []);
  assert.equal(deskPodLabel(plan, pods, 'desk-3'), 'Tri Pod');
  // Its own desks first, then the ones that are no pod's.
  assert.deepEqual(seatOrder(pods[0], plan, pods).slice(0, 5), ['desk-2', 'desk-10', 'desk-1', 'desk-4', 'desk-5']);
  assert.ok(!seatOrder(undefined, plan, pods).includes('desk-3'));
  // No pods at all: every desk, in order.
  assert.deepEqual(seatOrder(undefined, { wing: 0, labels: {} }, []).slice(0, 3), ['desk-1', 'desk-2', 'desk-3']);
  assert.equal(deskPodLabel(plan, pods, 'desk-4'), undefined);
});

test('the queue seats a pod’s task at the pod’s free desk, and anywhere free when its desks are taken', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-pod-desks-'));
  const workers: WorkerInfo[] = [];
  let n = 0;
  const manager: QueueWorkers = {
    defaultProvider: 'claude',
    list: () => workers,
    deskOccupied: (desk) => workers.some((w) => w.deskId === desk),
    spawn(deskId, by, prompt, worktree, kind, provider) {
      const w = { id: `w${n++}`, deskId, kind, provider, prompt, name: 'Test', color: '#fff', status: 'working', acked: false, createdBy: by, createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [] } as WorkerInfo;
      workers.push(w);
      return w;
    },
    kill: () => Promise.resolve({}),
  };
  const q = new TaskQueue(dir, manager, false, {
    update() {},
    toast() {},
    claimIssue: async () => undefined,
    refreshGitHub() {},
    hiringPaused: () => undefined,
    emptied() {},
    prefer: (task) => seatOrder(podOfTask(task, pods, []), plan, pods),
  });
  t.after(() => {
    q.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });
  q.setLimit(5);
  q.add('Do it', 'Rhona', '[Pod Thai] First');
  q.add('Do it', 'Rhona', '[Pod Thai] Second');
  q.add('Do it', 'Rhona', '[Pod Thai] Third');
  q.add('Do it', 'Zer', 'No pod');
  assert.deepEqual(
    workers.map((w) => w.deskId),
    // Pod Thai's two desks, then desks that are no pod's (desk-3 is Tri Pod's), for the third and for the task with no pod.
    ['desk-2', 'desk-10', 'desk-1', 'desk-4'],
  );
});
