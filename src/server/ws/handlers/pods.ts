// The delivery pods (see server/pods.ts): the roster, which admins edit.
import type { PodsClientMsg } from '../../../shared/protocol.js';
import type { HandlerMap } from './types.js';

export const podsHandlers = {
  'pods.get'(ctx, c) {
    ctx.sendTo(c, { t: 'pods', state: ctx.pods.state() });
  },
  'pods.save'(ctx, c, msg) {
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can change the pods');
    const err = ctx.pods.save(msg.state, c.peer.name);
    if (err) return ctx.warn(c, err);
    ctx.toastAll(`👥 ${c.peer.name} updated the pods`);
  },
} satisfies HandlerMap<PodsClientMsg>;
