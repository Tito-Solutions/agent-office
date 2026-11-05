// The "AI use" section of a worker's pull request: which agent and model wrote the change, and room
// for whoever reviews it to say how it was verified. Teams that ask every pull request to say what
// AI generated and how it was checked get it on every one a worker opens, from its desk (O) or by
// itself (gh pr create). Its text is the 'pull.aiUse' prompt, so ⚙️ Settings can reword it or
// empty it to turn it off.
import type { WorkerInfo } from '../../shared/protocol.js';
import { providerMeta } from '../../shared/providers.js';
import { officePrompt, type PromptSource } from '../prompts.js';

const AI_USE_START = '<!-- agent-office:ai-use -->';
const AI_USE_END = '<!-- /agent-office:ai-use -->';

/** Which agent a worker is, with its model when the office knows it: "Claude Code (claude-opus-5-5)". */
export function agentLabel(info: WorkerInfo): string | undefined {
  const meta = info.kind === 'shell' ? undefined : providerMeta(info.provider ?? 'claude');
  if (!meta) return undefined;
  const model = info.usage?.model || info.model;
  return model ? `${meta.label} (${model})` : meta.label;
}

/** The section for a worker's pull request, between markers so it's only ever added once; empty when there's nothing to add. */
export function aiUseBlock(info: WorkerInfo, prompts?: PromptSource): string {
  const agent = agentLabel(info);
  if (!agent) return '';
  const text = officePrompt(prompts, 'pull.aiUse', { agent, worker: info.name });
  return text ? `${AI_USE_START}\n${text}\n${AI_USE_END}` : '';
}

/**
 * A description with the section added at the end, unless it has one already. One that's there is
 * never rewritten: whoever reviews the pull request fills in how it was verified.
 */
export function withAiUse(body: string, block: string): string {
  if (!block || body.includes(AI_USE_START)) return body;
  return body.trim() ? `${body.trimEnd()}\n\n${block}` : block;
}
