import { createId } from '@/lib/id';
import type { ChatMessage } from '@/services/aiService';
import { COPILOT_MAX_MESSAGE_CHARS, type CopilotRequest } from '@/services/copilot/protocol';
import type {
  AgentPlan,
  AgentTurnState,
  AgentTurnStatus,
  AssistantThreadItem,
  AssistantThreadItemType,
  AssetGroundingMatch,
  DiagramChangeSummary,
} from './types';

const MAX_CHANGE_NOTE_ENTRIES = 20;

function nowIso(): string {
  return new Date().toISOString();
}

export function createAssistantThreadItem(
  type: AssistantThreadItemType,
  role: AssistantThreadItem['role'],
  content: string,
  extra: Partial<Omit<AssistantThreadItem, 'id' | 'type' | 'role' | 'content' | 'createdAt'>> = {}
): AssistantThreadItem {
  return {
    id: createId(`flowpilot-${type}`),
    type,
    role,
    content,
    createdAt: nowIso(),
    ...extra,
  };
}

export function createUserThreadItem(prompt: string, imageBase64?: string): AssistantThreadItem {
  return createAssistantThreadItem(
    'user_message',
    'user',
    imageBase64 ? `${prompt} [Image Attached]` : prompt
  );
}

export function createPlanThreadItem(plan: AgentPlan): AssistantThreadItem {
  return createAssistantThreadItem('assistant_plan', 'model', plan.reasoningSummary, {
    responseMode: plan.mode,
    thinkingState: 'planning',
    summary: plan.reasoningSummary,
    plan,
  });
}

export function createAnswerThreadItem(
  content: string,
  mode: AssistantThreadItem['responseMode'],
  assetMatches?: AssetGroundingMatch[]
): AssistantThreadItem {
  const type = mode === 'asset_suggestions' ? 'assistant_recommendation' : 'assistant_lookup_result';
  return createAssistantThreadItem(type, 'model', content, {
    responseMode: mode,
    thinkingState: 'ready',
    assetMatches,
  });
}

export function createPreviewThreadItem(
  content: string,
  previewTitle: string,
  previewDetail?: string,
  previewStats?: string[],
  assetMatches?: AssetGroundingMatch[],
  changes?: DiagramChangeSummary
): AssistantThreadItem {
  return createAssistantThreadItem('assistant_canvas_preview', 'model', content, {
    responseMode: 'diagram_preview',
    thinkingState: 'ready',
    previewTitle,
    previewDetail,
    previewStats,
    assetMatches,
    previewStatus: 'pending',
    changes,
  });
}

export function createAppliedThreadItem(summary: string): AssistantThreadItem {
  return createAssistantThreadItem('assistant_applied_result', 'model', summary, {
    responseMode: 'diagram_apply_ready',
    thinkingState: 'ready',
    applied: true,
  });
}

export function createErrorThreadItem(message: string): AssistantThreadItem {
  return createAssistantThreadItem('assistant_error', 'model', message, {
    thinkingState: 'error',
  });
}

export function createAgentTurnThreadItem(): AssistantThreadItem {
  return createAssistantThreadItem('assistant_agent_turn', 'model', '', {
    agentTurn: { status: 'running', steps: [], questions: [] },
  });
}

/** The change note replayed with a Copilot turn, for example `added node "API"; renamed node "A" to "B"`. */
export function describeCanvasChanges(changes: DiagramChangeSummary | undefined): string {
  if (!changes || changes.totalChanges === 0) return 'none';
  const entries = changes.details.slice(0, MAX_CHANGE_NOTE_ENTRIES).map((change) => change.previousLabel
    ? `renamed ${change.kind} "${change.previousLabel}" to "${change.label}"`
    : `${change.status} ${change.kind} "${change.label}"`);
  const more = changes.details.length - entries.length;
  return more > 0 ? `${entries.join('; ')}; and ${more} more` : entries.join('; ');
}

/** The user's answers replayed with a Copilot turn, including an answer given after the turn ended. */
function describeAnswers(turn: AgentTurnState | undefined): string {
  const answers = (turn?.questions ?? []).flatMap((question) => question.kind === 'question' && question.status === 'answered'
    ? [`asked "${question.question}" and the user answered "${question.answer ?? ''}"`]
    : []);
  return answers.length > 0 ? `\n[Questions this turn: ${answers.join('; ')}]` : '';
}

function replayText(item: AssistantThreadItem): string {
  if (item.type === 'assistant_canvas_preview') {
    return `Diagram proposal ${item.previewStatus ?? (item.applied ? 'applied' : 'superseded')}. ${
      item.previewStatus === 'applied' || item.applied
        ? 'The canvas may have changed since this historical action; use the current canvas context.'
        : 'This proposal is not the current canvas. Do not treat its suggested edits as applied.'
    }`;
  }
  if (item.type === 'assistant_agent_turn') {
    const undone = item.agentTurn?.undone ? '; the user has since undone these changes' : '';
    return `${item.content}\n[Canvas changes this turn: ${describeCanvasChanges(item.changes)}${undone}]${describeAnswers(item.agentTurn)}`;
  }
  return item.content;
}

export function assistantThreadToChatMessages(items: AssistantThreadItem[]): ChatMessage[] {
  return items
    .filter((item) => item.type !== 'assistant_plan' && item.type !== 'assistant_thinking')
    .map((item) => ({ role: item.role, parts: [{ text: replayText(item) }] }));
}

/** History for a Copilot agent turn. Errors are left out so the model does not read them as its own answers. */
export function assistantThreadToAgentHistory(items: AssistantThreadItem[]): CopilotRequest['history'] {
  return items
    .filter((item) => item.type !== 'assistant_plan' && item.type !== 'assistant_thinking' && item.type !== 'assistant_error')
    .map((item) => ({
      role: item.role === 'model' ? 'assistant' : 'user',
      content: replayText(item).slice(0, COPILOT_MAX_MESSAGE_CHARS),
    }));
}

export function setPreviewStatus(
  items: AssistantThreadItem[],
  previewId: string,
  status: NonNullable<AssistantThreadItem['previewStatus']>
): AssistantThreadItem[] {
  return items.map((item) => item.id === previewId
    ? { ...item, previewStatus: status, applied: status === 'applied' }
    : item);
}

/** Replaces the item with the same id, or appends it. */
export function upsertThreadItem(items: AssistantThreadItem[], item: AssistantThreadItem): AssistantThreadItem[] {
  return items.some((candidate) => candidate.id === item.id)
    ? items.map((candidate) => candidate.id === item.id ? item : candidate)
    : [...items, item];
}

export function expirePendingPreviews(items: AssistantThreadItem[]): AssistantThreadItem[] {
  return items.map((item) => item.type === 'assistant_canvas_preview' && (!item.previewStatus || item.previewStatus === 'pending')
    ? { ...item, previewStatus: item.applied ? 'applied' : 'superseded' }
    : item);
}

/** An ended turn leaves nothing open: its unfinished steps failed and its waiting questions closed. */
export function endAgentTurn(turn: AgentTurnState, status: AgentTurnStatus): AgentTurnState {
  return {
    ...turn,
    status,
    steps: turn.steps.map((step) => step.status === 'started' ? { ...step, status: 'failed' } : step),
    questions: turn.questions.map((question) => question.status === 'waiting'
      ? { ...question, status: 'closed' }
      : question),
  };
}

/** A turn saved while it ran or waited for an answer did not finish; its open questions can still start a new turn. */
export function interruptUnfinishedAgentTurns(items: AssistantThreadItem[]): AssistantThreadItem[] {
  return items.map((item) => item.agentTurn?.status === 'running' || item.agentTurn?.status === 'waiting'
    ? { ...item, agentTurn: endAgentTurn(item.agentTurn, 'interrupted') }
    : item);
}

export function getLatestAssistantResponse(items: AssistantThreadItem[]): AssistantThreadItem | undefined {
  const latest = [...items].reverse().find((item) =>
    item.type !== 'assistant_plan' && item.type !== 'assistant_thinking');
  return latest?.role === 'model' ? latest : undefined;
}

export function getPendingConversationPlan(items: AssistantThreadItem[]): string | undefined {
  const lastAnswer = getLatestAssistantResponse(items);
  return lastAnswer?.responseMode === 'plan' ? lastAnswer.content : undefined;
}
