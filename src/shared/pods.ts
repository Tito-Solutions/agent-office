// Delivery pods: small teams (a Product Analyst and one or two Developers) that own their features
// from Kick Off to Sign-Off, each with a Product Manager and Solutions Architects to turn to. The
// roster is kept by server/pods.ts; admins edit it in the Pods window.
//
// A pod's name is spelled as its GitHub label, which is how its issues and pull requests are found.
// Its features and their dates are not kept here: the Kick Off Document in the repository is their record.

import { SIGN_COLORS, signColor } from './floorplan.js';

export type PodRole = 'PA' | 'Developer';
export const POD_ROLES: readonly PodRole[] = ['PA', 'Developer'];

export interface PodMember {
  name: string;
  role: PodRole;
}

export interface Pod {
  id: string;
  name: string;
  /** One of SIGN_COLORS: its card on the Pod board. */
  color: string;
  members: PodMember[];
  pm?: string;
  sas: string[];
  /** The most features it carries at once. */
  limit: number;
}

export interface PodsState {
  pods: Pod[];
  /** The people over every pod. */
  org: { cpo?: string; cto?: string; qualityLead?: string };
  /** Who last changed the roster, and when. */
  by?: string;
  at?: number;
}

/**
 * The Pod board: a board on legs out on the open floor between the desks and the stairs, mirroring
 * the whiteboard across the room, showing the pods on both faces. `width` and `height` are its face,
 * whose bottom edge is `bottom` above the floor.
 */
export const POD_BOARD = { x: 5.4, z: 5.4, width: 4.2, height: 2.2, bottom: 0.6 } as const;

export const MAX_PODS = 20;
export const MAX_MEMBERS = 8;
export const POD_NAME_MAX = 32;
export const PERSON_MAX = 24;
export const DEFAULT_LIMIT = 2;

/** The stages of the Delivery Flow, as the issues and pull requests are labelled. */
export const STAGES = ['prepare', 'plan', 'build', 'release'] as const;
export type Stage = (typeof STAGES)[number];

/** The pods the office starts with: the Tax Maverick pods' labels on GitHub, one color each. */
export const DEFAULT_POD_NAMES = ['Pod Thai', 'Pairadox.AI', 'Pod Trip', 'SalonPods', 'Pod Influence', 'Tri Pod'];

export function defaultPods(): PodsState {
  return {
    pods: DEFAULT_POD_NAMES.map((name, i) => ({ id: podId(name, new Set()), name, color: SIGN_COLORS[i % SIGN_COLORS.length].color, members: [], sas: [], limit: DEFAULT_LIMIT })),
    org: {},
  };
}

/** One line of text: no control characters, collapsed spaces, at most `max` characters. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const flat = v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  return [...flat].slice(0, max).join('').trim();
}

/** A stable id from a pod's name, unique among `taken`. */
export function podId(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pod';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

const sameName = (a: string | undefined, b: string | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** A pod as it may be kept, with every field checked. Fields it no longer has (features, account, floors) are dropped. */
function cleanPod(raw: unknown, taken: Set<string>): Pod | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as Record<string, unknown>;
  const name = cleanText(p.name, POD_NAME_MAX);
  if (!name) return undefined;
  const wanted = cleanText(p.id, 40);
  const id = wanted && !taken.has(wanted) ? wanted : podId(name, taken);
  taken.add(id);
  const members = (Array.isArray(p.members) ? p.members : [])
    .map((m) => ({ name: cleanText((m as Record<string, unknown>)?.name, PERSON_MAX), role: (m as Record<string, unknown>)?.role === 'PA' ? 'PA' : 'Developer' }) as PodMember)
    .filter((m, i, all) => m.name && all.findIndex((o) => sameName(o.name, m.name)) === i)
    .slice(0, MAX_MEMBERS);
  const sas = (Array.isArray(p.sas) ? p.sas : []).map((s) => cleanText(s, PERSON_MAX)).filter(Boolean).slice(0, 6);
  const limit = typeof p.limit === 'number' && Number.isFinite(p.limit) ? Math.min(9, Math.max(1, Math.round(p.limit))) : DEFAULT_LIMIT;
  const pm = cleanText(p.pm, PERSON_MAX);
  return { id, name, color: signColor(p.color), members, ...(pm ? { pm } : {}), sas, limit };
}

/** The roster as it may be kept, from whatever was saved or sent: pods with the same name are one. */
export function cleanPods(raw: unknown): PodsState {
  if (!raw || typeof raw !== 'object') return defaultPods();
  const r = raw as Record<string, unknown>;
  const taken = new Set<string>();
  const pods: Pod[] = [];
  for (const p of Array.isArray(r.pods) ? r.pods : []) {
    if (pods.length >= MAX_PODS) break;
    const pod = cleanPod(p, taken);
    if (pod && !pods.some((o) => sameName(o.name, pod.name))) pods.push(pod);
  }
  const o = (r.org && typeof r.org === 'object' ? r.org : {}) as Record<string, unknown>;
  const org: PodsState['org'] = {};
  for (const k of ['cpo', 'cto', 'qualityLead'] as const) {
    const v = cleanText(o[k], PERSON_MAX);
    if (v) org[k] = v;
  }
  const by = cleanText(r.by, PERSON_MAX);
  return { pods, org, ...(by ? { by } : {}), ...(typeof r.at === 'number' && Number.isFinite(r.at) ? { at: r.at } : {}) };
}

/** The pod an issue or pull request is labelled for, by its labels' names. */
export function podOfLabels(labels: readonly { name: string }[], pods: readonly Pod[]): Pod | undefined {
  return pods.find((p) => labels.some((l) => sameName(l.name, p.name)));
}

/** The pod label of issue `n` among `issues`, spelled as the issue has it: what a pull request that closes it is labelled with. */
export function podLabelOfIssue(issues: readonly { number: number; labels: readonly { name: string }[] }[], n: number, pods: readonly Pod[]): string | undefined {
  const issue = issues.find((i) => i.number === n);
  return issue?.labels.find((l) => pods.some((p) => sameName(p.name, l.name)))?.name;
}

/** The Delivery Flow stage an issue or pull request is labelled with. */
export function stageOfLabels(labels: readonly { name: string }[]): Stage | undefined {
  return STAGES.find((s) => labels.some((l) => sameName(l.name, s)));
}
