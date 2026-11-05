// The delivery pods (see server/pods.ts): the roster, which admins edit, and each pod's features,
// which its members and its PM add at Kick Off and sign off.
import type { PodsClientMsg } from '../../../shared/protocol.js';
import { worksIn } from '../../../shared/pods.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import type { HandlerMap } from './types.js';

/** Who someone is to the roster: their account's name, which nobody else can take, else the name they go by. */
const nameOf = (ctx: Ctx, c: Client) => ctx.meOf(c.accountId).account?.name ?? c.peer.name;
const isAdmin = (ctx: Ctx, c: Client) => ctx.meOf(c.accountId).admin;

/** Whether `c` may change `podId`'s features: admins, and the pod's own members and PM. Says why not, if not. */
function mayChange(ctx: Ctx, c: Client, podId: string): string | undefined {
  const pod = ctx.pods.pod(podId);
  if (!pod) return 'There’s no such pod';
  if (isAdmin(ctx, c) || worksIn(pod, nameOf(ctx, c))) return undefined;
  return `Only ${pod.name}'s members, its PM and admins can change its features`;
}

export const podsHandlers = {
  'pods.get'(ctx, c) {
    ctx.sendTo(c, { t: 'pods', state: ctx.pods.state() });
  },
  'pods.save'(ctx, c, msg) {
    if (!isAdmin(ctx, c)) return ctx.warn(c, 'Only admins can change the pods');
    const err = ctx.pods.save(msg.state, c.peer.name);
    if (err) return ctx.warn(c, err);
    ctx.toastAll(`👥 ${c.peer.name} updated the pods`);
  },
  'pods.feature.add'(ctx, c, msg) {
    const podId = str(msg.pod, 40);
    const no = mayChange(ctx, c, podId);
    if (no) return ctx.warn(c, no);
    // Past the limit takes the CTO's say-so, which only an admin records.
    const override = isAdmin(ctx, c) ? str(msg.override, 200) : undefined;
    const r = ctx.pods.addFeature(podId, msg.feature, c.peer.name, override);
    if (typeof r === 'string') return ctx.warn(c, r);
    const pod = ctx.pods.pod(podId)!;
    ctx.toastAll(`🚀 ${pod.name} kicked off “${r.name}”${r.jira ? ` (${r.jira})` : ''}, committed for ${r.committed}`);
  },
  'pods.feature.recommit'(ctx, c, msg) {
    const podId = str(msg.pod, 40);
    const no = mayChange(ctx, c, podId);
    if (no) return ctx.warn(c, no);
    const r = ctx.pods.recommit(podId, str(msg.id, 40), msg.date, str(msg.reason, 200));
    if (typeof r === 'string') return ctx.warn(c, r);
    ctx.toastAll(`📅 ${ctx.pods.pod(podId)!.name} moved “${r.name}” to ${r.recommitted!.at(-1)!.date}`);
  },
  'pods.feature.done'(ctx, c, msg) {
    const podId = str(msg.pod, 40);
    const no = mayChange(ctx, c, podId);
    if (no) return ctx.warn(c, no);
    const r = ctx.pods.done(podId, str(msg.id, 40));
    if (typeof r === 'string') return ctx.warn(c, r);
    ctx.toastAll(`✅ ${ctx.pods.pod(podId)!.name} signed off “${r.name}”`);
  },
} satisfies HandlerMap<PodsClientMsg>;
