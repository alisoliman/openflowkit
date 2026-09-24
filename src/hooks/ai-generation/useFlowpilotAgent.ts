import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/components/ui/ToastContext';
import { createId } from '@/lib/id';
import { createLogger } from '@/lib/logger';
import {
  startAgentTurn,
  type AgentTurnConnection,
  type AgentTurnEnd,
  type AgentTurnEvent,
} from '@/services/copilot/agentClient';
import { AGENT_MAX_ANSWER_CHARS, AGENT_MAX_ID_CHARS, AGENT_MAX_SELECTED_IDS } from '@/services/copilot/agentProtocol';
import type { AgentToolName } from '@/services/copilot/agentTools';
import type { CanvasEditDestructiveInfo } from '@/services/flowpilot/agent/canvasOps';
import {
  canUndoAgentTurn,
  createAgentTurnExecutor,
  undoAgentTurn,
  type AgentToolResult,
  type AgentTurnExecutor,
  type AgentTurnUndo,
} from '@/services/flowpilot/agent/executor';
import { summarizeDiagramChanges } from '@/services/flowpilot/changeSummary';
import {
  assistantThreadToAgentHistory,
  createAgentTurnThreadItem,
  createErrorThreadItem,
  createUserThreadItem,
  endAgentTurn,
  upsertThreadItem,
} from '@/services/flowpilot/thread';
import type {
  AgentTurnQuestion,
  AgentTurnState,
  AgentTurnStatus,
  AssistantThreadItem,
  DiagramChangeSummary,
} from '@/services/flowpilot/types';
import { notifyOperationOutcome } from '@/services/operationFeedback';
import { useFlowStore } from '@/store';
import type { AgentTurnLock } from '@/store/types';
import { saveAssistantThreadItem } from './chatHistoryStorage';
import { toErrorMessage } from './graphComposer';

const logger = createLogger({ scope: 'FlowpilotAgent' });

// The server ends a turn after a question waits this long; removal confirmations follow the same rule.
const CONFIRM_IDLE_MS = 10 * 60_000;
const MAX_CONFIRM_LABELS = 10;
const CONTINUE_NOTE = '[Flowpilot context note: your previous turn was interrupted before it finished. Its changes so far are on the canvas. Continue the previous request from the current canvas.]';
const ENDING_ERRORS = {
  stopped: 'The user stopped this turn.',
  expired: 'A removal was not confirmed in time, so this turn ended.',
};

type ThreadUpdate = (items: AssistantThreadItem[]) => AssistantThreadItem[];
type ConfirmQuestion = Extract<AgentTurnQuestion, { kind: 'confirm' }>;

interface UseFlowpilotAgentOptions {
  pageId: string;
  model: string;
  thread: AssistantThreadItem[];
  updateThread: (update: ThreadUpdate) => void;
  /** Why a turn cannot start right now, such as a missing sign-in. */
  blockedReason: string | null;
  onError: (message: string | null) => void;
  fitView?: (options?: { duration?: number; padding?: number }) => void;
}

/** What the chat needs to drive Copilot turns from their thread items. */
export interface AgentTurnControls {
  /** The turn "Undo Copilot's changes" can still revert. */
  undoItemId: string | null;
  answer: (questionId: string, answer: string, wasFreeform: boolean) => Promise<boolean>;
  /** `message` is shown as the user's turn when a removal left open by an ended turn is approved. */
  confirm: (questionId: string, approved: boolean, message: string) => Promise<boolean>;
  continueTurn: (message: string) => Promise<boolean>;
  undo: () => void;
}

interface PendingConfirm {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ActiveTurn {
  lock: AgentTurnLock;
  executor: AgentTurnExecutor;
  item: AssistantThreadItem;
  reply: string;
  state: AgentTurnState;
  connection?: AgentTurnConnection;
  confirms: Map<string, PendingConfirm>;
  /** Tool calls run one at a time, in arrival order. */
  queue: Promise<void>;
  /** Set by Stop or a removal nobody confirmed. Tool calls still queued or running then change nothing. */
  ending?: keyof typeof ENDING_ERRORS;
  settle: (ok: boolean) => void;
}

function itemOf(turn: ActiveTurn): AssistantThreadItem {
  return { ...turn.item, content: turn.reply, agentTurn: turn.state };
}

// A page left for another page of the document is in tabs; one left for another document is in documents.
function turnChanges(turn: ActiveTurn): DiagramChangeSummary | undefined {
  const store = useFlowStore.getState();
  const turnPageId = turn.lock.pageId;
  const page = store.activeTabId === turnPageId
    ? store
    : store.tabs.find((tab) => tab.id === turnPageId)
      ?? store.documents.flatMap((document) => document.pages).find((candidate) => candidate.id === turnPageId);
  const changes = page
    ? summarizeDiagramChanges(turn.executor.startGraph, page, { countMoves: true })
    : undefined;
  return changes && changes.totalChanges > 0 ? changes : undefined;
}

function withQuestions(state: AgentTurnState, questions: AgentTurnQuestion[]): AgentTurnState {
  return {
    ...state,
    questions,
    status: questions.some((question) => question.status === 'waiting') ? 'waiting' : 'running',
  };
}

function closeQuestion(question: AgentTurnQuestion, status: 'expired' | 'closed'): AgentTurnQuestion {
  return question.status === 'waiting' ? { ...question, status } : question;
}

function findSavedQuestion(items: AssistantThreadItem[], questionId: string): AgentTurnQuestion | undefined {
  for (const item of items) {
    const question = item.agentTurn?.questions.find((candidate) => candidate.id === questionId);
    if (question) return question;
  }
  return undefined;
}

function updateSavedQuestion(
  items: AssistantThreadItem[],
  questionId: string,
  update: (question: AgentTurnQuestion) => AgentTurnQuestion
): AssistantThreadItem[] {
  return items.map((item) => item.agentTurn?.questions.some((question) => question.id === questionId)
    ? {
      ...item,
      agentTurn: {
        ...item.agentTurn,
        questions: item.agentTurn.questions.map((question) => question.id === questionId ? update(question) : question),
      },
    }
    : item);
}

function answered(question: AgentTurnQuestion, answer: string): AgentTurnQuestion {
  return question.kind === 'question' ? { ...question, status: 'answered', answer } : question;
}

function decided(question: AgentTurnQuestion, approved: boolean): AgentTurnQuestion {
  return question.kind === 'confirm' ? { ...question, status: 'answered', approved } : question;
}

function describeRemoval(question: ConfirmQuestion): string {
  const more = question.removedCount - question.removedLabels.length;
  const labels = question.removedLabels.map((label) => `"${label}"`).join(', ');
  return more > 0 ? `${labels} and ${more} more` : labels;
}

/**
 * Runs Copilot agent turns for the open page: the browser holds the page lock, executes the agent's
 * tool calls in arrival order, asks the user when the agent or a large removal needs an answer, and
 * saves the turn to the thread when it pauses or ends.
 */
export function useFlowpilotAgent(options: UseFlowpilotAgentOptions) {
  const { addToast } = useToast();
  const [liveItem, setLiveItem] = useState<AssistantThreadItem | null>(null);
  const [undo, setUndo] = useState<{ itemId: string; undo: AgentTurnUndo } | null>(null);
  const canUndo = useFlowStore((state) => canUndoAgentTurn(state, undo?.undo ?? null));
  const optionsRef = useRef(options);
  const turnRef = useRef<ActiveTurn | null>(null);
  const { pageId } = options;

  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  const show = useCallback((turn: ActiveTurn) => {
    if (turnRef.current === turn) setLiveItem(itemOf(turn));
  }, []);

  // The open page's thread saves itself; a turn that outlived its page saves straight to storage.
  const persist = useCallback((turnPageId: string, item: AssistantThreadItem) => {
    if (optionsRef.current.pageId === turnPageId) {
      optionsRef.current.updateThread((items) => upsertThreadItem(items, item));
      return;
    }
    void saveAssistantThreadItem(turnPageId, item).catch((error: unknown) => {
      logger.error('Could not save the Flowpilot turn.', { error });
    });
  }, []);

  const setQuestions = useCallback((turn: ActiveTurn, questions: AgentTurnQuestion[], save = false) => {
    turn.state = withQuestions(turn.state, questions);
    show(turn);
    // A reload during the pause replays the saved item, so it records the changes so far.
    if (save) persist(turn.lock.pageId, { ...itemOf(turn), changes: turnChanges(turn) });
  }, [persist, show]);

  const settleConfirm = useCallback((turn: ActiveTurn, id: string, outcome: boolean | 'expired' | 'closed') => {
    const pending = turn.confirms.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    turn.confirms.delete(id);
    // A decision is saved like an answer, so a reload before the turn ends does not offer it again.
    setQuestions(turn, turn.state.questions.map((question) => question.id !== id
      ? question
      : typeof outcome === 'boolean' ? decided(question, outcome) : closeQuestion(question, outcome)), typeof outcome === 'boolean');
    pending.resolve(outcome === true);
  }, [setQuestions]);

  const confirmRemoval = useCallback((turn: ActiveTurn, removal: CanvasEditDestructiveInfo) => {
    if (turn.ending) return Promise.resolve(false);
    const id = createId('flowpilot-confirm');
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        turn.ending = 'expired';
        settleConfirm(turn, id, 'expired');
        // As at Stop, other open questions close: an answer once the turn is ending cannot reach the model.
        setQuestions(turn, turn.state.questions.map((question) => closeQuestion(question, 'closed')));
        turn.connection?.cancel();
      }, CONFIRM_IDLE_MS);
      turn.confirms.set(id, { resolve, timer });
      setQuestions(turn, [...turn.state.questions, {
        kind: 'confirm',
        id,
        status: 'waiting',
        removedLabels: removal.removedNodes.slice(0, MAX_CONFIRM_LABELS).map((node) => node.label || node.id),
        removedCount: removal.removedNodes.length,
        clearsCanvas: removal.clearsCanvas,
      }], true);
    });
  }, [setQuestions, settleConfirm]);

  const runToolCall = useCallback(async (turn: ActiveTurn, callId: string, name: AgentToolName, args: unknown) => {
    const result: AgentToolResult = turn.ending
      ? { ok: false, error: ENDING_ERRORS[turn.ending], resultType: 'rejected' }
      : await turn.executor.execute(name, args);
    turn.connection?.sendToolResult(callId, result);
    // A template or a whole-page layout moves everything, so bring the result into view.
    const { fitView } = optionsRef.current;
    if (result.ok && fitView && (name === 'use_template' || (name === 'layout' && (args as { scope?: unknown }).scope === 'all'))) {
      setTimeout(() => fitView({ duration: 600, padding: 0.2 }), 100);
    }
  }, []);

  const handleEvent = useCallback((turn: ActiveTurn, event: AgentTurnEvent) => {
    switch (event.type) {
      case 'reply_delta':
        turn.reply += event.text;
        show(turn);
        return;
      case 'step': {
        const step = { callId: event.callId, name: event.name, status: event.status };
        const steps = turn.state.steps.some((candidate) => candidate.callId === step.callId)
          ? turn.state.steps.map((candidate) => candidate.callId === step.callId ? step : candidate)
          : [...turn.state.steps, step];
        turn.state = { ...turn.state, steps };
        show(turn);
        return;
      }
      case 'question':
        // A question that arrives once the turn is ending can no longer be answered in it, like one open at Stop.
        setQuestions(turn, [...turn.state.questions, {
          kind: 'question',
          id: event.questionId,
          status: turn.ending ? 'closed' : 'waiting',
          question: event.question,
          choices: event.choices,
          allowFreeform: event.allowFreeform,
        }], true);
        return;
      case 'question_expired':
        // Also an answer sent as the question expired: the server no longer took it, so it can start a new turn.
        setQuestions(turn, turn.state.questions.map((question) => question.id === event.questionId
          ? { ...question, status: 'expired' }
          : question));
        return;
      case 'tool_call':
        turn.queue = turn.queue
          .then(() => runToolCall(turn, event.callId, event.name, event.args))
          .catch((error: unknown) => logger.error('A Flowpilot tool call failed unexpectedly.', { error }));
    }
  }, [runToolCall, setQuestions, show]);

  const finish = useCallback((turn: ActiveTurn, end: AgentTurnEnd) => {
    if (turnRef.current !== turn) return;
    for (const id of [...turn.confirms.keys()]) settleConfirm(turn, id, 'closed');
    turnRef.current = null;
    const turnPageId = turn.lock.pageId;
    if (useFlowStore.getState().agentTurn?.turnId === turn.lock.turnId) useFlowStore.getState().setAgentTurn(null);

    const onPage = useFlowStore.getState().activeTabId === turnPageId;
    const changes = turnChanges(turn);
    const reply = end.type === 'done' && end.reply ? end.reply : turn.reply;
    const status: AgentTurnStatus = end.type === 'interrupted'
      ? 'interrupted'
      : end.type === 'error' ? 'failed' : turn.ending === 'stopped' ? 'stopped' : 'done';
    const madeProgress = Boolean(reply || changes) || turn.state.steps.length > 0 || turn.state.questions.length > 0;
    const item = end.type === 'error' && !madeProgress
      ? createErrorThreadItem(end.message)
      : {
        ...turn.item,
        content: reply,
        changes,
        agentTurn: {
          ...endAgentTurn(turn.state, status),
          ...(end.type === 'error' ? { error: end.message } : {}),
        },
      };
    persist(turnPageId, item);
    const turnUndo = turn.executor.getUndo();
    if (turnUndo && onPage) setUndo({ itemId: item.id, undo: turnUndo });
    setLiveItem(null);

    if (end.type === 'error') {
      if (optionsRef.current.pageId === turnPageId) optionsRef.current.onError(end.message);
      notifyOperationOutcome(addToast, { status: 'error', summary: end.message });
    } else if (end.type === 'interrupted') {
      addToast('Flowpilot was interrupted. Its changes so far stay on the canvas.', 'warning');
    }
    turn.settle(end.type !== 'error');
  }, [addToast, persist, settleConfirm]);

  const runTurn = useCallback((message: string, prompt: string, image?: string, update?: ThreadUpdate): Promise<boolean> => {
    const { model, thread, updateThread, blockedReason, onError } = optionsRef.current;
    const turnPageId = optionsRef.current.pageId;
    const store = useFlowStore.getState();
    if (turnRef.current || store.agentTurn || store.activeTabId !== turnPageId) return Promise.resolve(false);
    if (blockedReason) {
      onError(blockedReason);
      return Promise.resolve(false);
    }
    onError(null);
    const history = assistantThreadToAgentHistory(thread);
    updateThread((items) => [...(update ? update(items) : items), createUserThreadItem(message, image)]);
    const lock = { turnId: createId('flowpilot-turn'), pageId: turnPageId };
    store.setAgentTurn(lock);

    return new Promise<boolean>((settle) => {
      const item = createAgentTurnThreadItem();
      const turn: ActiveTurn = {
        lock,
        executor: createAgentTurnExecutor({
          turn: lock,
          confirmRemoval: (removal) => confirmRemoval(turn, removal),
          endingReason: () => turn.ending && ENDING_ERRORS[turn.ending],
        }),
        item,
        reply: '',
        state: item.agentTurn ?? { status: 'running', steps: [], questions: [] },
        confirms: new Map(),
        queue: Promise.resolve(),
        settle,
      };
      turnRef.current = turn;
      setLiveItem(itemOf(turn));
      // Ids too long for the protocol are left out rather than failing the turn.
      const selectedIds = [...store.nodes, ...store.edges]
        .filter((element) => element.selected && element.id.length <= AGENT_MAX_ID_CHARS)
        .map((element) => element.id);
      try {
        turn.connection = startAgentTurn({
          turnId: lock.turnId,
          prompt,
          model: model || 'auto',
          history,
          image,
          canvas: {
            pageName: (store.tabs.find((tab) => tab.id === turnPageId)?.name ?? '').slice(0, 500),
            nodeCount: store.nodes.length,
            edgeCount: store.edges.length,
            selectedIds: selectedIds.slice(0, AGENT_MAX_SELECTED_IDS),
          },
        }, {
          onEvent: (event) => handleEvent(turn, event),
          onEnd: (end) => finish(turn, end),
        });
      } catch (error) {
        finish(turn, { type: 'error', code: 'invalid_request', message: toErrorMessage(error) });
      }
    });
  }, [confirmRemoval, finish, handleEvent]);

  const abandonTurn = useCallback(() => {
    const turn = turnRef.current;
    if (!turn) return;
    turn.connection?.close();
    finish(turn, { type: 'interrupted' });
  }, [finish]);

  // Leaving the page, for another page or by closing the editor, ends its turn. The work so far stays.
  useEffect(() => abandonTurn, [abandonTurn, pageId]);

  const send = useCallback((prompt: string, image?: string): Promise<boolean> => {
    if (!prompt.trim() && !image) return Promise.resolve(false);
    return runTurn(prompt, prompt.trim() || 'Use the attached image.', image);
  }, [runTurn]);

  const stop = useCallback(() => {
    const turn = turnRef.current;
    if (!turn) return;
    turn.ending = 'stopped';
    // Stop is not an answer: open questions and removals close, and a reply once the turn ends starts a new one.
    for (const id of [...turn.confirms.keys()]) settleConfirm(turn, id, 'closed');
    setQuestions(turn, turn.state.questions.map((question) => closeQuestion(question, 'closed')));
    turn.connection?.cancel();
  }, [setQuestions, settleConfirm]);

  const answer = useCallback((questionId: string, text: string, wasFreeform: boolean): Promise<boolean> => {
    const reply = text.trim().slice(0, AGENT_MAX_ANSWER_CHARS);
    if (!reply) return Promise.resolve(false);
    const turn = turnRef.current;
    const live = turn?.state.questions.find((question) => question.id === questionId);
    if (turn && live) {
      if (live.status !== 'waiting') return Promise.resolve(false);
      turn.connection?.answer(questionId, reply, wasFreeform);
      setQuestions(turn, turn.state.questions.map((question) => question.id === questionId ? answered(question, reply) : question), true);
      return Promise.resolve(true);
    }
    // The question outlived its turn, so the answer starts a new one.
    const saved = findSavedQuestion(optionsRef.current.thread, questionId);
    if (saved?.kind !== 'question' || saved.status === 'answered') return Promise.resolve(false);
    const why = saved.status === 'expired' ? 'expired before the user replied' : 'was still open when that turn ended';
    return runTurn(
      reply,
      `[Flowpilot context note: this answers your earlier question "${saved.question}", which ${why}. Check the current canvas and continue from there.]\n\n${reply}`,
      undefined,
      (items) => updateSavedQuestion(items, questionId, (question) => answered(question, reply))
    );
  }, [runTurn, setQuestions]);

  const confirm = useCallback((questionId: string, approved: boolean, message: string): Promise<boolean> => {
    const turn = turnRef.current;
    if (turn?.state.questions.some((question) => question.id === questionId)) {
      if (!turn.confirms.has(questionId)) return Promise.resolve(false);
      settleConfirm(turn, questionId, approved);
      return Promise.resolve(true);
    }
    const saved = findSavedQuestion(optionsRef.current.thread, questionId);
    if (saved?.kind !== 'confirm' || saved.status === 'answered') return Promise.resolve(false);
    const decide: ThreadUpdate = (items) => updateSavedQuestion(items, questionId, (question) => decided(question, approved));
    // Keeping the nodes needs no new turn: the unconfirmed removal was never applied.
    if (!approved) {
      optionsRef.current.updateThread(decide);
      return Promise.resolve(true);
    }
    const change = saved.clearsCanvas ? 'clear the canvas' : 'remove nodes';
    const why = saved.status === 'expired' ? 'the user did not confirm it in time' : 'the turn ended before the user confirmed it';
    return runTurn(
      message,
      `[Flowpilot context note: your earlier edit to ${change} (${describeRemoval(saved)}) was not applied because ${why}. The user now approves it. Check the current canvas and make that change.]\n\n${message}`,
      undefined,
      decide
    );
  }, [runTurn, settleConfirm]);

  const continueTurn = useCallback((message: string) => runTurn(message, `${CONTINUE_NOTE}\n\n${message}`), [runTurn]);

  const undoTurn = useCallback(() => {
    if (!undo) return;
    if (!undoAgentTurn(undo.undo)) {
      addToast('The canvas has changed since this turn. Use the canvas Undo control to review more recent changes first.', 'warning');
      return;
    }
    optionsRef.current.updateThread((items) => items.map((item) => item.id === undo.itemId && item.agentTurn
      ? { ...item, agentTurn: { ...item.agentTurn, undone: true } }
      : item));
    setUndo(null);
    addToast("Undid Copilot's changes.", 'success');
  }, [addToast, undo]);

  const undoItemId = canUndo && undo ? undo.itemId : null;
  const controls = useMemo<AgentTurnControls>(
    () => ({ undoItemId, answer, confirm, continueTurn, undo: undoTurn }),
    [answer, confirm, continueTurn, undoItemId, undoTurn]
  );

  return { liveItem, isRunning: liveItem !== null, send, stop, controls };
}
