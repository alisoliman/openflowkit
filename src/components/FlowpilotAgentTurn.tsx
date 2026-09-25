import { useId, useState, type ReactElement } from 'react';
import { CheckCircle2, Loader2, MessageCircle, RotateCcw, Undo2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AgentTurnControls } from '@/hooks/ai-generation/useFlowpilotAgent';
import { AGENT_MAX_ANSWER_CHARS } from '@/services/copilot/agentProtocol';
import type { AgentTurnQuestion, AgentTurnStep, AssistantThreadItem } from '@/services/flowpilot/types';
import { SECTION_SURFACE_CLASS, STATUS_SURFACE_CLASS } from '@/lib/designTokens';
import { FlowpilotChangeSummary } from './FlowpilotChangeSummary';

type TFunction = ReturnType<typeof useTranslation>['t'];

interface FlowpilotAgentTurnProps {
  item: AssistantThreadItem;
  controls?: AgentTurnControls;
  /** Continue is only offered on the newest turn. */
  isLatest: boolean;
  /** A request is running, so a new turn cannot start. */
  busy: boolean;
}

const ACTION_BUTTON_CLASS = `inline-flex min-h-9 items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--brand-background)] disabled:cursor-not-allowed disabled:opacity-50 ${SECTION_SURFACE_CLASS}`;

function getStepLabel(t: TFunction, name: string): string {
  switch (name) {
    case 'get_canvas': return t('flowpilot.agent.tools.get_canvas', 'Read the canvas');
    case 'edit_canvas': return t('flowpilot.agent.tools.edit_canvas', 'Edited the canvas');
    case 'capture_canvas': return t('flowpilot.agent.tools.capture_canvas', 'Looked at the canvas');
    case 'focus_canvas': return t('flowpilot.agent.tools.focus_canvas', 'Moved the view');
    case 'find_icons': return t('flowpilot.agent.tools.find_icons', 'Looked up icons');
    case 'layout': return t('flowpilot.agent.tools.layout', 'Arranged the layout');
    case 'review_architecture': return t('flowpilot.agent.tools.review_architecture', 'Reviewed the architecture');
    case 'list_templates': return t('flowpilot.agent.tools.list_templates', 'Browsed templates');
    case 'use_template': return t('flowpilot.agent.tools.use_template', 'Loaded a template');
    case 'ask_user': return t('flowpilot.agent.tools.ask_user', 'Asked you a question');
    default: return name;
  }
}

function StepIcon({ status }: { status: AgentTurnStep['status'] }): ReactElement {
  if (status === 'started') return <Loader2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" />;
  if (status === 'failed') return <X aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--color-surface-danger-text)]" />;
  return <CheckCircle2 aria-hidden="true" className="h-3 w-3 shrink-0 text-[var(--color-surface-success-text)]" />;
}

// Questions from Copilot and removal confirmations share one card. Answering one that expired or closed starts a new turn.
function QuestionCard({ question, controls, busy }: {
  question: AgentTurnQuestion;
  controls?: AgentTurnControls;
  busy: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const answerId = useId();
  const questionId = useId();
  const ended = question.status === 'expired' || question.status === 'closed';
  const canReply = Boolean(controls) && (question.status === 'waiting' || (ended && !busy));

  function sendAnswer(answer: string, wasFreeform: boolean): void {
    if (controls && answer.trim()) void controls.answer(question.id, answer, wasFreeform);
  }

  return (
    <div
      data-question-status={question.status}
      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-brand-border)] bg-[var(--brand-background)] p-3"
    >
      {question.kind === 'question' ? (
        <p id={questionId} className="whitespace-pre-wrap font-medium leading-6">{question.question}</p>
      ) : (
        <>
          <p className="font-medium">
            {question.clearsCanvas
              ? t('flowpilot.agent.confirmClear', 'Copilot wants to clear the canvas, removing:')
              : t('flowpilot.agent.confirmRemoval', 'Copilot wants to remove these nodes from before this turn:')}
          </p>
          <p className="break-words text-xs text-[var(--brand-secondary)]">
            {question.removedLabels.join(', ')}
            {question.removedCount > question.removedLabels.length
              ? ` ${t('flowpilot.agent.moreNodes', { count: question.removedCount - question.removedLabels.length, defaultValue: 'and {{count}} more' })}`
              : null}
          </p>
        </>
      )}

      {question.status === 'answered' ? (
        <p className="text-xs text-[var(--brand-secondary)]">
          {question.kind === 'question'
            ? t('flowpilot.agent.yourAnswer', { answer: question.answer, defaultValue: 'Your answer: {{answer}}' })
            : question.approved
              ? t('flowpilot.agent.removalApproved', 'Removal approved')
              : t('flowpilot.agent.removalDeclined', 'Kept these nodes')}
        </p>
      ) : null}
      {ended ? (
        <p className="text-xs text-[var(--brand-secondary)]">
          {question.status === 'expired'
            ? t('flowpilot.agent.expired', 'No answer for 10 minutes, so the turn ended. Answer to start a new turn.')
            : t('flowpilot.agent.closed', 'The turn ended before you answered. Answer to start a new turn.')}
        </p>
      ) : null}

      {canReply && question.kind === 'confirm' && controls ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void controls.confirm(question.id, true, t('flowpilot.agent.approveRemovalMessage', 'Go ahead with the removal.'))}
            className="min-h-9 rounded-[var(--radius-sm)] bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700"
          >
            {t('flowpilot.agent.remove', 'Remove')}
          </button>
          <button type="button" onClick={() => void controls.confirm(question.id, false, '')} className={ACTION_BUTTON_CLASS}>
            {t('flowpilot.agent.keep', 'Keep')}
          </button>
        </div>
      ) : null}
      {canReply && question.kind === 'question' ? (
        <>
          {question.choices && question.choices.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {question.choices.map((choice) => (
                <button key={choice} type="button" onClick={() => sendAnswer(choice, false)} className={ACTION_BUTTON_CLASS}>
                  {choice}
                </button>
              ))}
            </div>
          ) : null}
          {question.allowFreeform ? (
            <form
              className="space-y-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                sendAnswer(draft, true);
              }}
            >
              <label htmlFor={answerId} className="block text-xs font-medium text-[var(--brand-secondary)]">{t('flowpilot.agent.yourReply', 'Your reply')}</label>
              <div className="flex gap-2">
                <input
                  id={answerId}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  // Keeps canvas shortcuts from reacting to typing.
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
                  }}
                  maxLength={AGENT_MAX_ANSWER_CHARS}
                  placeholder={t('flowpilot.agent.answerPlaceholder', 'Type your answer')}
                  aria-describedby={questionId}
                  className="min-h-9 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-brand-border)] bg-[var(--brand-surface)] px-2.5 py-1.5 text-sm text-[var(--brand-text)] outline-none focus:border-[var(--brand-primary)] focus:ring-1 focus:ring-[var(--brand-primary)]"
                />
                <button type="submit" disabled={!draft.trim()} className={ACTION_BUTTON_CLASS}>
                  {t('flowpilot.agent.sendAnswer', 'Send')}
                </button>
              </div>
            </form>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** One Copilot agent turn in the chat: its steps, reply, questions, canvas changes and outcome. */
export function FlowpilotAgentTurn({ item, controls, isLatest, busy }: FlowpilotAgentTurnProps): ReactElement {
  const { t } = useTranslation();
  const turn = item.agentTurn ?? { status: 'done', steps: [], questions: [] };
  const live = turn.status === 'running' || turn.status === 'waiting';

  return (
    <div className="space-y-3 whitespace-normal" data-agent-status={turn.status}>
      {turn.steps.length > 0 ? (
        <details open={live} className="text-xs text-[var(--brand-secondary)]">
          <summary className="cursor-pointer rounded-[var(--radius-xs)] py-1.5 font-medium text-[var(--brand-text)]">
            {t('flowpilot.agent.steps', { count: turn.steps.length, defaultValue: 'Steps: {{count}}' })}
          </summary>
          <ul className="mt-1.5 max-h-48 space-y-2 overflow-y-auto overscroll-contain rounded-[var(--radius-sm)] bg-[var(--brand-background)] p-2.5">
            {turn.steps.map((step) => (
              <li key={step.callId} className="flex items-start gap-2 leading-5" data-step-status={step.status}>
                <span className="pt-0.5">
                  <StepIcon status={step.status} />
                </span>
                <span className="min-w-0 flex-1">{getStepLabel(t, step.name)}</span>
                {step.status === 'started' ? <span className="text-[var(--brand-primary)]">{t('flowpilot.agent.runningStep', 'Running')}</span> : null}
                {step.status === 'failed' ? <span className="text-[var(--color-surface-danger-text)]">{t('flowpilot.agent.failedStep', 'Failed')}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {item.content ? <div className="whitespace-pre-wrap leading-relaxed">{item.content}</div> : null}

      {turn.questions.map((question) => (
        <QuestionCard key={question.id} question={question} controls={controls} busy={busy} />
      ))}

      {turn.status === 'running' ? (
        <p role="status" className="flex items-center gap-1.5 text-xs text-[var(--brand-secondary)]">
          <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          {t('flowpilot.agent.working', 'Working on it…')}
        </p>
      ) : null}
      {turn.status === 'waiting' ? (
        <p role="status" className="flex items-center gap-2 text-xs font-medium text-[var(--brand-primary)]">
          <MessageCircle aria-hidden="true" className="h-3.5 w-3.5" />
          {t('flowpilot.agent.waitingForYou', 'Waiting for your answer')}
        </p>
      ) : null}

      {!live && item.changes ? <FlowpilotChangeSummary changes={item.changes} compact /> : null}

      {turn.status === 'stopped' ? (
        <p className="text-xs text-[var(--brand-secondary)]">
          {t('flowpilot.agent.stopped', 'Stopped. Changes so far stay on the canvas.')}
        </p>
      ) : null}
      {turn.status === 'failed' ? (
        <div role="alert" className={`rounded-[var(--radius-sm)] border p-2.5 text-xs leading-5 ${STATUS_SURFACE_CLASS.danger}`}>
          <p className="font-medium">{t('flowpilot.agent.failed', 'Copilot could not finish this turn.')}</p>
          {turn.error ? <p className="mt-0.5 break-words">{turn.error}</p> : null}
        </div>
      ) : null}
      {turn.status === 'interrupted' ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--brand-secondary)]">
          <span>{t('flowpilot.agent.interrupted', 'Interrupted — continue?')}</span>
          {isLatest && controls ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void controls.continueTurn(t('flowpilot.agent.continueMessage', 'Continue where you left off.'))}
              className={ACTION_BUTTON_CLASS}
            >
              <RotateCcw aria-hidden="true" className="h-3 w-3" />
              {t('flowpilot.agent.continue', 'Continue')}
            </button>
          ) : null}
        </div>
      ) : null}
      {turn.undone ? (
        <p className="text-xs text-[var(--brand-secondary)]">
          {t('flowpilot.agent.undone', "Copilot's changes were undone.")}
        </p>
      ) : null}

      {controls && controls.undoItemId === item.id && !busy ? (
        <button type="button" onClick={controls.undo} className={ACTION_BUTTON_CLASS}>
          <Undo2 aria-hidden="true" className="h-3 w-3" />
          {t('flowpilot.agent.undo', "Undo Copilot's changes")}
        </button>
      ) : null}
    </div>
  );
}
