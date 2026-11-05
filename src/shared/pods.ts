// Delivery pods: small teams (a Product Analyst and one or two Developers) that own their features
// from Kick Off to Sign-Off, each with a Product Manager and Solutions Architects to turn to. The
// roster is the same on every floor, kept by server/pods.ts; admins edit it in the Pods window.
//
// A pod's desks are the ones with its sign hung over them (see shared/floorplan.ts): a sign whose
// text is the pod's name. So the pods need nothing of their own on each floor, and pressing L at a
// desk and typing a pod's name puts that desk in it too.

import { SIGN_COLORS, signColor, type FloorPlan } from './floorplan.js';

export type PodRole = 'PA' | 'Developer';
export const POD_ROLES: readonly PodRole[] = ['PA', 'Developer'];

export interface PodMember {
  name: string;
  role: PodRole;
}

/** A feature a pod committed to at Kick Off, until it's signed off. */
export interface PodFeature {
  id: string;
  name: string;
  /** Its Epic in JIRA, like TPE-123. */
  jira?: string;
  /** YYYY-MM-DD. */
  kickoff: string;
  /** The date committed at Kick Off, never overwritten (see recommitted). */
  committed: string;
  /** Each time the date moved: the new one and why. */
  recommitted?: { date: string; reason: string }[];
  /** Taken on past the pod's limit: who approved it and why. */
  override?: string;
  by: string;
  at: number;
}

export interface Pod {
  id: string;
  name: string;
  /** One of SIGN_COLORS, which its desk signs are painted too. */
  color: string;
  /** Who it delivers for: "Tax Maverick", "Internal and small projects". */
  account: string;
  /** The floors (projects) it works on. */
  floors: string[];
  members: PodMember[];
  pm?: string;
  sas: string[];
  /** The most features it carries at once. */
  limit: number;
  features: PodFeature[];
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
export const MAX_FEATURES = 12;
export const POD_NAME_MAX = 32;
export const PERSON_MAX = 24;
export const DEFAULT_LIMIT = 2;
const TEXT_MAX = 80;
const JIRA_MAX = 24;
const REASON_MAX = 160;

/** The stages of the Delivery Flow, as the issues and pull requests are labelled. */
export const STAGES = ['prepare', 'plan', 'build', 'release'] as const;
export type Stage = (typeof STAGES)[number];

/** The pods the office starts with: the pod labels on GitHub, one sign color each. */
export const DEFAULT_POD_NAMES = ['Pod Thai', 'Pairadox.AI', 'Pod Trip', 'SalonPods', 'Pod Influence', 'Tri Pod', 'Spod Bros'];

export function defaultPods(): PodsState {
  return {
    pods: DEFAULT_POD_NAMES.map((name, i) => ({ id: podId(name, new Set()), name, color: SIGN_COLORS[i % SIGN_COLORS.length].color, account: '', floors: [], members: [], sas: [], limit: DEFAULT_LIMIT, features: [] })),
    org: {},
  };
}

/** One line of text: no control characters, collapsed spaces, at most `max` characters. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const flat = v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  return [...flat].slice(0, max).join('').trim();
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A YYYY-MM-DD date, or '' when it isn't one. */
export function cleanDate(v: unknown): string {
  return typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v)) ? v : '';
}

/** A stable id from a pod's name, unique among `taken`. */
export function podId(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pod';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

const sameName = (a: string | undefined, b: string | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

function cleanFeature(raw: unknown): PodFeature | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const f = raw as Record<string, unknown>;
  const name = cleanText(f.name, TEXT_MAX);
  const kickoff = cleanDate(f.kickoff);
  const committed = cleanDate(f.committed);
  const id = cleanText(f.id, 40);
  if (!name || !kickoff || !committed || !id) return undefined;
  const recommitted = Array.isArray(f.recommitted)
    ? f.recommitted
        .map((r) => ({ date: cleanDate((r as Record<string, unknown>)?.date), reason: cleanText((r as Record<string, unknown>)?.reason, REASON_MAX) }))
        .filter((r) => r.date && r.reason)
        .slice(-20)
    : [];
  const jira = cleanText(f.jira, JIRA_MAX);
  const override = cleanText(f.override, REASON_MAX);
  return {
    id,
    name,
    ...(jira ? { jira } : {}),
    kickoff,
    committed,
    ...(recommitted.length ? { recommitted } : {}),
    ...(override ? { override } : {}),
    by: cleanText(f.by, PERSON_MAX) || 'someone',
    at: typeof f.at === 'number' && Number.isFinite(f.at) ? f.at : 0,
  };
}

/** A pod as it may be kept, with every field checked. */
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
  const floors = (Array.isArray(p.floors) ? p.floors : []).map((f) => cleanText(f, 64)).filter(Boolean).slice(0, 20);
  const limit = typeof p.limit === 'number' && Number.isFinite(p.limit) ? Math.min(9, Math.max(1, Math.round(p.limit))) : DEFAULT_LIMIT;
  const features = (Array.isArray(p.features) ? p.features : []).map(cleanFeature).filter((f): f is PodFeature => !!f).slice(0, MAX_FEATURES);
  const pm = cleanText(p.pm, PERSON_MAX);
  return { id, name, color: signColor(p.color), account: cleanText(p.account, TEXT_MAX), floors: [...new Set(floors)], members, ...(pm ? { pm } : {}), sas, limit, features };
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

/** The pod a sign over a desk puts it in: the one whose name the sign says. */
export function podOfDesk(plan: FloorPlan, pods: readonly Pod[], deskId: string): Pod | undefined {
  const text = plan.labels[deskId]?.text;
  return text ? pods.find((p) => sameName(p.name, text)) : undefined;
}

/** The desks with `pod`'s sign over them on a floor. */
export function podDesks(plan: FloorPlan, pod: Pod): string[] {
  return Object.entries(plan.labels)
    .filter(([, l]) => sameName(l.text, pod.name))
    .map(([id]) => id);
}

/** What someone is in the pods, for under their name: "Pod Thai · PA", "PM · Pod Thai, Tri Pod", "CTO". */
export function podTag(name: string, state: PodsState | null | undefined): string | undefined {
  if (!state || !name.trim()) return undefined;
  const member = state.pods.flatMap((p) => p.members.filter((m) => sameName(m.name, name)).map((m) => `${p.name} · ${m.role}`));
  if (member.length) return member.join(' · ');
  // Over more than two pods: the account they share ("Tax Maverick"), else how many, so the tag stays short.
  const led = (pick: (p: Pod) => boolean) => {
    const pods = state.pods.filter(pick);
    if (pods.length <= 2) return pods.map((p) => p.name).join(', ');
    if (pods.length === state.pods.length) return 'all pods';
    const account = pods[0].account;
    return account && pods.every((p) => p.account === account) ? account : `${pods.length} pods`;
  };
  const pm = led((p) => sameName(p.pm, name));
  const sa = led((p) => p.sas.some((s) => sameName(s, name)));
  const titles = [
    sameName(state.org.cpo, name) ? 'CPO' : '',
    sameName(state.org.cto, name) ? 'CTO' : '',
    sameName(state.org.qualityLead, name) ? 'Product Quality Lead' : '',
    pm ? `PM · ${pm}` : '',
    sa ? `SA · ${sa}` : '',
  ].filter(Boolean);
  return titles.length ? titles.join(' · ') : undefined;
}

/** Whether `name` may add and sign off `pod`'s features: its members and its PM (admins always may). */
export function worksIn(pod: Pod, name: string): boolean {
  return pod.members.some((m) => sameName(m.name, name)) || sameName(pod.pm, name);
}

/** Why `pod` can't take another feature, or nothing when it can. */
export function overLimit(pod: Pod): string | undefined {
  return pod.features.length >= pod.limit ? `${pod.name} already carries ${pod.features.length} active feature${pod.features.length === 1 ? '' : 's'} (its limit is ${pod.limit}): another needs the CTO's approval` : undefined;
}

/** The pod an issue or pull request is labelled for, by its labels' names. */
export function podOfLabels(labels: readonly { name: string }[], pods: readonly Pod[]): Pod | undefined {
  return pods.find((p) => labels.some((l) => sameName(l.name, p.name)));
}

/** The Delivery Flow stage an issue or pull request is labelled with. */
export function stageOfLabels(labels: readonly { name: string }[]): Stage | undefined {
  return STAGES.find((s) => labels.some((l) => sameName(l.name, s)));
}

/** The date a feature is due now: its last re-committed date, else the one committed at Kick Off. */
export function dueDate(f: PodFeature): string {
  const last = f.recommitted?.[f.recommitted.length - 1];
  return last?.date ?? f.committed;
}

/** Days from `today` (YYYY-MM-DD) to `date`: negative once it's past. */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
}

/** Today in the local time zone, as YYYY-MM-DD. */
export function today(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export { cleanFeature };
