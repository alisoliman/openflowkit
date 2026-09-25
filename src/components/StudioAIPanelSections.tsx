import { useId, useLayoutEffect, useRef, type ReactElement, type RefObject } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  ArrowDown,
  CheckCircle2,
  Crosshair,
  Info,
  Settings2,
  Loader2,
  Paperclip,
  Square,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import { Tooltip } from './Tooltip';
import { FLOWPILOT_NAME } from '@/lib/brand';
import type { ChatMessage } from '@/services/aiService';
import type { AssistantThreadItem } from '@/services/flowpilot/types';
import type { ImportDiff } from '@/hooks/useAIGeneration';
import type { AIReadinessState } from '@/hooks/ai-generation/readiness';
import type { AgentTurnControls } from '@/hooks/ai-generation/useFlowpilotAgent';
import { SECTION_CARD_CLASS, SECTION_SURFACE_CLASS, STATUS_SURFACE_CLASS } from '@/lib/designTokens';
import { STUDIO_AI_COPY } from './studioAICopy';
import { FlowpilotChangeSummary } from './FlowpilotChangeSummary';
import { FlowpilotAgentTurn } from './FlowpilotAgentTurn';

export type AIGenerationMode = 'edit' | 'create';
type TranslateFn = (...args: unknown[]) => string;

interface PendingDiffBannerProps {
  pendingDiff: ImportDiff;
  onConfirmDiff: () => void;
  onDiscardDiff: () => void;
  t: TranslateFn;
  isGenerating?: boolean;
}

export function PendingDiffBanner({
  pendingDiff,
  onConfirmDiff,
  onDiscardDiff,
  t,
  isGenerating,
}: PendingDiffBannerProps): ReactElement {
  return (
    <div className={`mx-1 mb-2 shrink-0 rounded-[var(--radius-md)] border p-3 ${pendingDiff.stale ? STATUS_SURFACE_CLASS.warning : STATUS_SURFACE_CLASS.success}`}>
      <div className="flex items-center gap-2 mb-2">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--color-surface-success-text)]" />
        <p className="text-sm font-semibold text-[var(--brand-text)]">
          {pendingDiff.previewTitle}
        </p>
      </div>
      {pendingDiff.previewDetail ? (
        <p className="mb-3 text-xs leading-5 text-[var(--brand-secondary)]">
          {pendingDiff.previewDetail}
        </p>
      ) : null}
      {pendingDiff.previewStats && pendingDiff.previewStats.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {pendingDiff.previewStats.map((stat) => (
            <span
              key={stat}
              className={`rounded-full px-2 py-1 text-xs font-medium ${SECTION_SURFACE_CLASS}`}
            >
              {stat}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mb-3">
        <FlowpilotChangeSummary changes={pendingDiff.changes} compact />
      </div>
      {pendingDiff.stale && (
        <p role="status" className="mb-3 text-sm leading-5">
          {t('flowpilot.stalePreview', 'The canvas changed. Discard this draft and request an updated edit.')}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onDiscardDiff}
          className={`flex min-h-9 flex-1 items-center justify-center rounded-[var(--radius-sm)] px-2 text-xs font-medium text-[var(--brand-text)] hover:bg-[var(--brand-background)] ${SECTION_SURFACE_CLASS}`}
        >
          {t('commandBar.aiStudio.discard', 'Discard')}
        </button>
        <button
          type="button"
          onClick={onConfirmDiff}
          disabled={pendingDiff.stale || isGenerating}
          className="flex min-h-9 flex-1 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--brand-action)] px-2 text-xs font-semibold text-white hover:bg-[var(--brand-action-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('commandBar.aiStudio.applyToCanvas', 'Apply to canvas')}
        </button>
      </div>
    </div>
  );
}

interface ChatHistoryViewProps {
  hasHistory: boolean;
  chatMessages: ChatMessage[];
  assistantThread: AssistantThreadItem[];
  agentTurnControls?: AgentTurnControls;
  isGenerating: boolean;
  streamingText: string | null;
  retryCount: number;
  isCanvasEmpty: boolean;
  canGenerate: boolean;
  examplePrompts: Array<{ label: string; prompt: string; icon: LucideIcon }>;
  getExampleIconColor: (index: number) => string;
  onSelectExample: (prompt: string) => void;
  onOpenAISettings: () => void;
  onClearChat: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  showScrollToLatest?: boolean;
  onScrollToLatest?: () => void;
  t: TranslateFn;
}

function getThreadBubbleClassName(isUser: boolean): string {
  if (isUser) {
    return 'rounded-br-sm bg-[var(--brand-action)] text-white shadow-sm';
  }

  return 'rounded-bl-sm border border-[var(--color-brand-border)] bg-[var(--brand-surface)] text-[var(--brand-text)]';
}

function renderThreadAssetMatches(item: AssistantThreadItem): ReactElement | null {
  if (!item.assetMatches || item.assetMatches.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {item.assetMatches.slice(0, 4).map((match) => (
        <span
          key={match.id}
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${SECTION_SURFACE_CLASS}`}
        >
          {match.label}
        </span>
      ))}
    </div>
  );
}

function renderThreadPreview(item: AssistantThreadItem): ReactElement | null {
  if (!item.previewTitle) {
    return null;
  }

  return (
    <div className="mt-3 rounded-[var(--radius-sm)] border border-[var(--color-brand-border)]/70 bg-[var(--brand-background)] px-2.5 py-2">
      <div className="text-xs font-semibold text-[var(--brand-text)]">{item.previewTitle}</div>
      {item.previewDetail ? (
        <div className="mt-1 text-xs leading-4 text-[var(--brand-secondary)]">
          {item.previewDetail}
        </div>
      ) : null}
      {item.previewStats && item.previewStats.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.previewStats.map((stat) => (
            <span
              key={`${item.id}-${stat}`}
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${SECTION_SURFACE_CLASS}`}
            >
              {stat}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function renderPlanContent(item: AssistantThreadItem): ReactElement {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--brand-secondary)]">
        <WandSparkles className="h-3.5 w-3.5" />
        Plan
      </div>
      <div className="leading-relaxed">{item.plan?.reasoningSummary}</div>
      <div className="flex flex-wrap gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SECTION_SURFACE_CLASS}`}>
          Mode: {item.plan?.mode.replaceAll('_', ' ')}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SECTION_SURFACE_CLASS}`}>
          Confidence: {Math.round((item.plan?.confidence ?? 0) * 100)}%
        </span>
      </div>
      <div className="space-y-1 text-xs leading-relaxed text-[var(--brand-secondary)]">
        {item.plan?.steps.map((step, index) => (
          <div key={`${item.id}-step-${index}`}>{index + 1}. {step}</div>
        ))}
      </div>
    </div>
  );
}

interface AgentTurnContext {
  controls?: AgentTurnControls;
  latestItemId?: string;
  busy: boolean;
}

function renderThreadContent(item: AssistantThreadItem, t: TranslateFn, agent: AgentTurnContext): ReactElement {
  if (item.type === 'assistant_agent_turn') {
    return (
      <FlowpilotAgentTurn
        item={item}
        controls={agent.controls}
        isLatest={item.id === agent.latestItemId}
        busy={agent.busy}
      />
    );
  }
  if (item.type === 'assistant_canvas_preview') {
    const status = item.previewStatus ?? (item.applied ? 'applied' : 'superseded');
    const statusLabels = {
      pending: t('flowpilot.previewPending', 'Proposed changes'),
      applied: t('flowpilot.previewApplied', 'Applied to canvas'),
      discarded: t('flowpilot.previewDiscarded', 'Discarded · canvas unchanged'),
      superseded: t('flowpilot.previewSuperseded', 'Previous draft · not applied'),
      undone: t('flowpilot.previewUndone', 'Undone'),
    };
    return (
      <div className="space-y-3 whitespace-normal">
        <p className="text-sm font-semibold" data-preview-status={status}>{statusLabels[status]}</p>
        {item.changes ? <FlowpilotChangeSummary changes={item.changes} /> : <p>{item.previewTitle}</p>}
        <details className="text-xs text-[var(--brand-secondary)]">
          <summary className="cursor-pointer rounded-[var(--radius-xs)] py-1.5">{t('flowpilot.viewCode', 'View diagram code')}</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">{item.content}</pre>
        </details>
      </div>
    );
  }
  if (item.role !== 'user' && item.type === 'assistant_plan' && item.plan) {
    return renderPlanContent(item);
  }

  return <div className="leading-relaxed">{item.content}</div>;
}

function getStreamingStatusCopy(
  streamingText: string | null,
  retryCount: number,
  chatMessageCount: number,
  t: TranslateFn
): string {
  if (retryCount > 0) {
    return t('commandBar.aiStudio.retrying', {
      retryCount,
      defaultValue: 'Retrying ({{retryCount}} of 3)...',
    });
  }

  if (chatMessageCount > 0) {
    return t('flowpilot.readingCanvas', 'Reading your diagram and planning the next step.');
  }

  if (streamingText) {
    return t('flowpilot.writingReply', 'Writing a response to your request.');
  }

  return t('flowpilot.planningReply', 'Planning a response to your request.');
}

function renderThreadItem(item: AssistantThreadItem, t: TranslateFn, agent: AgentTurnContext): ReactElement {
  const isUser = item.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`} key={item.id} data-thread-type={item.type}>
      <div
        className={`min-w-0 ${isUser ? 'max-w-[90%]' : 'w-full'} rounded-[var(--radius-md)] px-3.5 py-3 text-sm whitespace-pre-wrap [overflow-wrap:anywhere] ${getThreadBubbleClassName(isUser)}`}
      >
        <p className={`mb-1.5 text-xs font-semibold ${isUser ? 'text-white/85' : 'text-[var(--brand-secondary)]'}`}>
          {isUser ? t('flowpilot.you', 'You') : FLOWPILOT_NAME}
        </p>
        {renderThreadContent(item, t, agent)}
        {isUser || item.type === 'assistant_canvas_preview' ? null : renderThreadAssetMatches(item)}
        {isUser || item.type === 'assistant_canvas_preview' ? null : renderThreadPreview(item)}
      </div>
    </div>
  );
}

export function ChatHistoryView({
  hasHistory,
  chatMessages,
  assistantThread,
  agentTurnControls,
  isGenerating,
  streamingText,
  retryCount,
  isCanvasEmpty,
  canGenerate,
  examplePrompts,
  getExampleIconColor,
  onSelectExample,
  onOpenAISettings,
  onClearChat,
  scrollRef,
  showScrollToLatest,
  onScrollToLatest,
  t,
}: ChatHistoryViewProps): ReactElement {
  if (hasHistory) {
    const latestItem = assistantThread.at(-1);
    // A running Copilot turn shows its own progress and saves itself when it ends.
    const isAgentTurnLive = latestItem?.agentTurn?.status === 'running' || latestItem?.agentTurn?.status === 'waiting';
    const agent = { controls: agentTurnControls, latestItemId: latestItem?.id, busy: isGenerating };
    return (
      <>
        <div className="flex shrink-0 items-center justify-between gap-2 px-1 pb-1">
          <p className="text-xs font-semibold text-[var(--brand-secondary)]">{t('flowpilot.conversation', 'Conversation')}</p>
          <button
            type="button"
            onClick={onClearChat}
            disabled={isGenerating || isAgentTurnLive}
            aria-label={t('commandBar.ai.clearChat')}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-xs text-[var(--brand-secondary)] transition-colors hover:bg-[var(--brand-background)] hover:text-[var(--brand-text)] disabled:cursor-not-allowed disabled:opacity-50"
            title={t('commandBar.ai.clearChat')}
          >
            <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
            {t('flowpilot.clear', 'Clear')}
          </button>
        </div>
        <div
          ref={scrollRef}
          role="log"
          aria-label={t('flowpilot.conversation', 'Conversation')}
          aria-live="polite"
          aria-relevant="additions text"
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-1 py-3 custom-scrollbar"
        >
          {assistantThread.map((item) => renderThreadItem(item, t, agent))}
          {isGenerating && !isAgentTurnLive ? (
            <div className="flex justify-start">
              <div className="min-w-0 w-full rounded-[var(--radius-md)] rounded-bl-sm border border-[var(--color-brand-border)] bg-[var(--brand-surface)] px-3.5 py-3 text-sm text-[var(--brand-text)] [overflow-wrap:anywhere]">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--brand-secondary)]">
                  <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                  {streamingText ? t('flowpilot.draftingResponse', 'Drafting response') : t('flowpilot.thinking', 'Thinking')}
                </div>
                <div className="mt-2 text-xs leading-relaxed text-[var(--brand-secondary)]">
                  {getStreamingStatusCopy(streamingText, retryCount, chatMessages.length, t)}
                </div>
                {streamingText && !/^\s*(?:```[^\n]*\n?)?\s*flow\s*:/i.test(streamingText) ? (
                  <div className="mt-3 whitespace-pre-wrap leading-relaxed">{streamingText}</div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        {showScrollToLatest && onScrollToLatest ? (
          <div className="flex shrink-0 justify-center py-2">
            <button type="button" onClick={onScrollToLatest} className={`inline-flex min-h-9 items-center gap-2 px-3 text-xs font-medium text-[var(--brand-text)] hover:bg-[var(--brand-background)] ${SECTION_SURFACE_CLASS}`}>
              <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
              {t('flowpilot.latestMessage', 'Latest message')}
            </button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-4 custom-scrollbar"
    >
      <div className="flex min-h-full flex-col items-center justify-center px-2 py-5 text-center">
        <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] text-[var(--color-surface-warning-text)] ${SECTION_CARD_CLASS} ring-1 ring-[var(--color-surface-warning-border)]`}>
          <WandSparkles aria-hidden="true" className="h-6 w-6" />
        </div>
        <h3 className="text-xl font-bold tracking-tight text-[var(--brand-text)]">
          {FLOWPILOT_NAME}
        </h3>
        <p className="mb-6 mt-2 max-w-[280px] text-sm leading-6 text-[var(--brand-secondary)]">
          {isCanvasEmpty
            ? t('commandBar.aiStudio.emptyDescription', {
                appName: FLOWPILOT_NAME,
                defaultValue:
                  'Describe the diagram you want and {{appName}} will draft the first graph for you.',
              })
            : t('commandBar.aiStudio.editDescription', {
                appName: FLOWPILOT_NAME,
                defaultValue:
                  'Describe the changes you want and {{appName}} will update the graph for you.',
              })}
        </p>

        {canGenerate ? (
          <div className="grid w-full max-w-[360px] gap-2">
            {examplePrompts.map((skill, index) => {
              const Icon = skill.icon;
              return (
                <button
                  type="button"
                  key={skill.label}
                  onClick={() => onSelectExample(skill.prompt)}
                  disabled={isGenerating}
                  className="inline-flex min-h-11 items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-brand-border)] bg-[var(--brand-surface)] px-3 py-2.5 text-left text-sm font-medium leading-5 text-[var(--brand-text)] transition-colors hover:border-[var(--brand-primary)] hover:bg-[var(--brand-background)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-background)]">
                    <Icon aria-hidden="true" className={`h-3.5 w-3.5 ${getExampleIconColor(index)}`} />
                  </span>
                  <span>{skill.label}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-8 flex justify-center">
            <button
              type="button"
              onClick={onOpenAISettings}
              className={`flex min-h-11 items-center gap-2 px-4 py-2 text-sm font-semibold text-[var(--brand-text)] transition-colors hover:bg-[var(--brand-background)] ${SECTION_SURFACE_CLASS}`}
            >
              <Settings2 className="h-3.5 w-3.5" />
              {t('copilot.setupCta', 'Set up Flowpilot')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface ComposerSectionProps {
  showModeToggle: boolean;
  selectedNodeCount: number;
  effectiveGenerationMode: AIGenerationMode;
  selectedImage: string | null;
  prompt: string;
  placeholder: string;
  isGenerating: boolean;
  isInputEmpty: boolean;
  isBeveled: boolean;
  aiReadiness: AIReadinessState;
  lastError: string | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onSetGenerationMode: (mode: AIGenerationMode) => void;
  onRemoveImage: () => void;
  onPromptChange: (value: string) => void;
  onPromptKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>;
  onAttachImage: () => void;
  onImageSelect: React.ChangeEventHandler<HTMLInputElement>;
  onOpenAISettings: () => void;
  onClearError: () => void;
  onCancelGeneration: () => void;
  onSubmit: () => void;
  sendButtonLabel: string;
  sendButtonIcon: ReactElement;
  getGenerationModeButtonClassName: (isActive: boolean) => string;
  getInfoIconClassName: (isActive: boolean) => string;
  getPrimaryComposerClassName: (isInputEmpty: boolean, isBeveled: boolean) => string;
  t: TranslateFn;
}

function isLikelyNetworkFailure(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('network') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('fetch') ||
    normalized.includes('cors') ||
    normalized.includes('rate limit') ||
    normalized.includes('timeout')
  );
}

interface AIRecoveryBannerProps {
  aiReadiness: AIReadinessState;
  lastError: string;
  isGenerating: boolean;
  canRetry: boolean;
  onRetry: () => void;
  onOpenAISettings: () => void;
  onClearError: () => void;
}

function AIRecoveryBanner({
  aiReadiness,
  lastError,
  isGenerating,
  canRetry,
  onRetry,
  onOpenAISettings,
  onClearError,
}: AIRecoveryBannerProps): ReactElement {
  const setupIssue = aiReadiness.blockingIssue;
  const showSettingsCta = Boolean(setupIssue) || isLikelyNetworkFailure(lastError);
  const detail = setupIssue?.detail ?? lastError;

  return (
    <div role="alert" className={`mb-3 rounded-[var(--radius-md)] border px-3 py-3 ${STATUS_SURFACE_CLASS.warning}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-surface-warning-text)]" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-[var(--color-surface-warning-text)]">
            {setupIssue?.title ?? STUDIO_AI_COPY.lastRequestFailedTitle}
          </div>
          <div className="mt-1 break-words text-xs leading-5 text-[var(--color-surface-warning-text)]">{detail}</div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!isGenerating && !setupIssue ? (
              <button
                type="button"
                onClick={onRetry}
                disabled={!canRetry}
                className="min-h-9 rounded-[var(--radius-sm)] bg-[var(--brand-action)] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[var(--brand-action-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Retry request
              </button>
            ) : null}
            {showSettingsCta ? (
              <button
                type="button"
                onClick={onOpenAISettings}
                className={`min-h-9 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--brand-background)] ${SECTION_SURFACE_CLASS}`}
              >
                Review AI settings
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClearError}
              className="min-h-9 rounded-[var(--radius-sm)] px-2 py-1.5 text-xs font-medium text-[var(--color-surface-warning-text)] transition-colors hover:bg-[var(--brand-background)]"
              aria-label={STUDIO_AI_COPY.dismissErrorAriaLabel}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ComposerSection({
  showModeToggle,
  selectedNodeCount,
  effectiveGenerationMode,
  selectedImage,
  prompt,
  placeholder,
  isGenerating,
  isInputEmpty,
  isBeveled,
  aiReadiness,
  lastError,
  fileInputRef,
  onSetGenerationMode,
  onRemoveImage,
  onPromptChange,
  onPromptKeyDown,
  onAttachImage,
  onImageSelect,
  onOpenAISettings,
  onClearError,
  onCancelGeneration,
  onSubmit,
  sendButtonLabel,
  sendButtonIcon,
  getGenerationModeButtonClassName,
  getInfoIconClassName,
  getPrimaryComposerClassName,
  t,
}: ComposerSectionProps): ReactElement {
  const promptId = useId();
  const hintId = useId();
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const input = promptRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 76), 180)}px`;
  }, [prompt]);

  return (
    <div className="shrink-0 border-t border-[var(--color-brand-border)] px-1 pt-3">
      {lastError ? (
        <AIRecoveryBanner
          aiReadiness={aiReadiness}
          lastError={lastError}
          isGenerating={isGenerating}
          canRetry={!isInputEmpty && aiReadiness.canGenerate}
          onRetry={onSubmit}
          onOpenAISettings={onOpenAISettings}
          onClearError={onClearError}
        />
      ) : null}
      {showModeToggle ? (
        <div role="group" aria-label={t('flowpilot.generationMode', 'Generation mode')} className="mb-3 flex rounded-[var(--radius-md)] border border-[var(--color-brand-border)] bg-[var(--brand-background)] p-1">
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => onSetGenerationMode('edit')}
            className={`flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${getGenerationModeButtonClassName(effectiveGenerationMode === 'edit')}`}
            aria-pressed={effectiveGenerationMode === 'edit'}
          >
            {t('commandBar.aiStudio.editCurrent', 'Edit current')}
            <Tooltip
              text={t('commandBar.aiStudio.editCurrentHint', 'Modify your existing canvas')}
              side="top"
              className="flex items-center"
            >
              <Info aria-hidden="true" className={getInfoIconClassName(effectiveGenerationMode === 'edit')} />
            </Tooltip>
          </button>
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => onSetGenerationMode('create')}
            className={`flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${getGenerationModeButtonClassName(effectiveGenerationMode === 'create')}`}
            aria-pressed={effectiveGenerationMode === 'create'}
          >
            {t('commandBar.aiStudio.createNew', 'Create new')}
            <Tooltip
              text={t('commandBar.aiStudio.createNewHint', 'Start fresh with a new diagram')}
              side="top"
              className="flex items-center"
            >
              <Info aria-hidden="true" className={getInfoIconClassName(effectiveGenerationMode === 'create')} />
            </Tooltip>
          </button>
        </div>
      ) : null}

      {selectedNodeCount > 0 && effectiveGenerationMode === 'edit' ? (
        <div className="mb-3 flex items-center gap-1.5 rounded-[var(--radius-xs)] border border-[var(--brand-primary-100)] bg-[var(--brand-primary-50)] px-2.5 py-1.5">
          <Crosshair aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--brand-primary)]" />
          <span className="text-xs font-medium text-[var(--brand-primary)]">
            {t('commandBar.aiStudio.editingSelectedNodes', {
              count: selectedNodeCount,
              defaultValue: 'Editing {{count}} selected node',
            })}
          </span>
        </div>
      ) : null}

      {selectedImage ? (
        <div className="mb-3 flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-brand-border)] bg-[var(--brand-background)] p-2">
          <img
            src={selectedImage}
            alt={t('commandBar.aiStudio.uploadPreviewAlt', 'Upload preview')}
            className="h-12 w-12 shrink-0 rounded-[var(--radius-sm)] object-cover"
          />
          <span className="min-w-0 flex-1 text-xs text-[var(--brand-secondary)]">{t('flowpilot.referenceImage', 'Reference image attached')}</span>
          <button
            type="button"
            onClick={onRemoveImage}
            aria-label={t('flowpilot.removeImage', 'Remove attached image')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--brand-secondary)] transition-colors hover:bg-[var(--brand-surface)] hover:text-[var(--brand-text)]"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <label htmlFor={promptId} className="mb-2 block text-xs font-medium text-[var(--brand-secondary)]">{t('flowpilot.messageLabel', 'Message Flowpilot')}</label>
      <div className="flex w-full flex-col rounded-[var(--brand-radius)] border border-[var(--color-brand-border)] bg-[var(--brand-surface)] shadow-sm transition-[border-color,box-shadow] focus-within:border-[var(--brand-primary)] focus-within:shadow-[0_0_0_1px_var(--brand-primary),0_0_0_4px_color-mix(in_srgb,var(--brand-primary)_16%,transparent)]">
        <textarea
          id={promptId}
          data-flowpilot-composer
          ref={promptRef}
          aria-describedby={hintId}
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={onPromptKeyDown}
          placeholder={placeholder}
          className="w-full resize-none rounded-[var(--brand-radius)] bg-transparent px-3 pb-2 pt-3 text-sm leading-6 text-[var(--brand-text)] placeholder-[var(--brand-secondary)] outline-none custom-scrollbar"
          style={{ minHeight: '76px', maxHeight: '180px' }}
          rows={3}
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <div className="flex items-center gap-1">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              ref={fileInputRef}
              onChange={onImageSelect}
            />
            <button
              onClick={onAttachImage}
              className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--brand-secondary)] transition-colors hover:bg-[var(--brand-background)] hover:text-[var(--brand-text)]"
              aria-label={t('commandBar.aiStudio.attachImage', 'Attach image')}
              title={t('commandBar.aiStudio.attachImage', 'Attach image')}
              type="button"
            >
              <Paperclip aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            {isGenerating ? (
              <button
                onClick={onCancelGeneration}
                className="flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-brand-border)] bg-[var(--brand-background)] px-3 text-xs font-semibold text-[var(--brand-text)] transition-colors hover:bg-[var(--brand-surface)]"
                aria-label={t('flowpilot.stopGeneration', 'Stop generation')}
                type="button"
              >
                <Square aria-hidden="true" className="h-3 w-3 fill-current" />
                {t('flowpilot.stop', 'Stop')}
              </button>
            ) : (
              <button
                onClick={onSubmit}
                disabled={isInputEmpty}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border transition-colors ${getPrimaryComposerClassName(isInputEmpty, isBeveled)}`}
                aria-label={t('ai.generateWithFlowpilot', {
                  defaultValue: 'Generate with Flowpilot',
                })}
                title={sendButtonLabel}
                type="button"
              >
                {sendButtonIcon}
              </button>
            )}
          </div>
        </div>
      </div>
      <p id={hintId} className="mt-2 text-xs leading-5 text-[var(--brand-secondary)]">
        {isGenerating
          ? t('flowpilot.draftWhileWorking', 'You can draft your next message while Flowpilot works.')
          : t('flowpilot.keyboardHint', 'Enter to send · Shift + Enter for a new line')}
      </p>
    </div>
  );
}
