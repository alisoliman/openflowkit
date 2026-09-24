import React, { lazy, Suspense } from 'react';
import { ArrowRight, Code2, Loader2, Square, WandSparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FLOWPILOT_NAME } from '@/lib/brand';
import type { FlowEdge, FlowNode } from '@/lib/types';
import type { ChatMessage } from '@/services/aiService';
import type { AssistantThreadItem } from '@/services/flowpilot/types';
import type { StudioCodeMode, StudioTab } from '@/hooks/useFlowEditorUIState';
import type { AIReadinessState } from '@/hooks/ai-generation/readiness';
import type { ImportDiff } from '@/hooks/useAIGeneration';
import type { AgentTurnControls } from '@/hooks/ai-generation/useFlowpilotAgent';
import { useIsAgentEditing } from '@/store/selectionHooks';
import { SidebarBody, SidebarHeader, SidebarSegmentedTabs, SidebarShell } from './SidebarShell';
import { InertWhileAgentEdits } from './flow-editor/InertWhileAgentEdits';

const LazyStudioAIPanel = lazy(async () => {
    const module = await import('./StudioAIPanel');
    return { default: module.StudioAIPanel };
});

const LazyStudioCodePanel = lazy(async () => {
    const module = await import('./StudioCodePanel');
    return { default: module.StudioCodePanel };
});

const STUDIO_TABS: Array<{
    id: StudioTab;
    icon: typeof WandSparkles;
    label: string;
    badge?: string;
}> = [
    { id: 'ai', icon: WandSparkles, label: FLOWPILOT_NAME, badge: 'Beta' },
    { id: 'code', icon: Code2, label: 'Code' },
];

function getEffectiveStudioTab(activeTab: StudioTab): 'ai' | 'code' {
    if (activeTab === 'infra' || activeTab === 'playback') {
        return 'ai';
    }

    return activeTab;
}

interface StudioPanelProps {
    onClose: () => void;
    nodes: FlowNode[];
    edges: FlowEdge[];
    onApply: (nodes: FlowNode[], edges: FlowEdge[]) => void;
    onAIGenerate: (prompt: string, imageBase64?: string) => Promise<boolean>;
    isGenerating: boolean;
    streamingText: string | null;
    retryCount: number;
    cancelGeneration: () => void;
    pendingDiff: ImportDiff | null;
    onConfirmDiff: () => void;
    onDiscardDiff: () => void;
    aiReadiness: AIReadinessState;
    lastAIError: string | null;
    onClearAIError: () => void;
    chatMessages: ChatMessage[];
    assistantThread: AssistantThreadItem[];
    agentTurnControls?: AgentTurnControls;
    canUndoLastChange?: boolean;
    undoLastChange?: () => void;
    onClearChat: () => void;
    activeTab: StudioTab;
    onTabChange: (tab: StudioTab) => void;
    codeMode: StudioCodeMode;
    onCodeModeChange: (mode: StudioCodeMode) => void;
    selectedNode: FlowNode | null;
    selectedNodeCount: number;
    onViewProperties: () => void;
    playback: {
        currentStepIndex: number;
        totalSteps: number;
        isPlaying: boolean;
        onStartPlayback: () => void;
        onPlayPause: () => void;
        onStop: () => void;
        onScrubToStep: (index: number) => void;
        onNext: () => void;
        onPrev: () => void;
        playbackSpeed: number;
        onPlaybackSpeedChange: (durationMs: number) => void;
    };
    initialPrompt?: string;
    onInitialPromptConsumed?: () => void;
}


export function StudioPanel({
    onClose,
    nodes,
    edges,
    onApply,
    onAIGenerate,
    isGenerating,
    streamingText,
    retryCount,
    cancelGeneration,
    pendingDiff,
    onConfirmDiff,
    onDiscardDiff,
    aiReadiness,
    lastAIError,
    onClearAIError,
    chatMessages,
    assistantThread,
    agentTurnControls,
    canUndoLastChange,
    undoLastChange,
    onClearChat,
    activeTab,
    onTabChange,
    codeMode,
    onCodeModeChange,
    selectedNode,
    selectedNodeCount,
    onViewProperties,
    playback: _playback,
    initialPrompt,
    onInitialPromptConsumed,
}: StudioPanelProps): React.ReactElement {
    const { t } = useTranslation();
    const effectiveTab = getEffectiveStudioTab(activeTab);
    const isAgentEditing = useIsAgentEditing();

    return (
        <SidebarShell>
            <SidebarHeader title="Studio" onClose={onClose} />

            <div className="border-b border-[var(--color-brand-border)] bg-[var(--brand-surface)] px-4 py-2.5">
                <SidebarSegmentedTabs
                    tabs={STUDIO_TABS.map(({ id, icon: Icon, label, badge }) => ({
                        id,
                        label,
                        icon: <Icon className="h-3.5 w-3.5" />,
                        badge,
                    }))}
                    activeTab={effectiveTab}
                    onTabChange={(tab) => onTabChange(tab as StudioTab)}
                />
            </div>

            {isAgentEditing && (
                <div
                    role="status"
                    className="flex items-center gap-2 border-b border-[var(--color-brand-border)] bg-[var(--brand-primary-50)] px-4 py-2 text-xs text-[var(--brand-text)]"
                >
                    <Loader2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--brand-primary)]" />
                    <span className="min-w-0 flex-1">
                        {t('flowpilot.agent.locked', 'Copilot is editing this page. Canvas editing is paused until it finishes.')}
                    </span>
                    <button
                        type="button"
                        onClick={cancelGeneration}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-red-600"
                    >
                        <Square aria-hidden="true" className="h-2.5 w-2.5 fill-current" />
                        {t('flowpilot.agent.stop', 'Stop')}
                    </button>
                </div>
            )}

            {/* The properties rail is locked during a Flowpilot turn, and leaving the studio would hide Stop. */}
            {selectedNode && (
                <InertWhileAgentEdits>
                    <button
                        onClick={onViewProperties}
                        className="flex w-full items-center justify-between border-b border-[var(--color-brand-border)] bg-[var(--brand-background)] px-4 py-2 text-left transition-colors hover:bg-[var(--brand-primary-50)]"
                    >
                        <span className="truncate text-xs font-medium text-[var(--brand-secondary)]">
                            {(selectedNode.data as { label?: string }).label?.trim() || 'Selected node'}
                        </span>
                        <span className="ml-2 flex shrink-0 items-center gap-1 text-[11px] font-medium text-[var(--brand-primary)]">
                            Properties <ArrowRight className="h-3 w-3" />
                        </span>
                    </button>
                </InertWhileAgentEdits>
            )}

            <SidebarBody scrollable={false} className="px-4 py-3">
                {effectiveTab === 'ai' ? (
                    <Suspense fallback={null}>
                        <LazyStudioAIPanel
                            onAIGenerate={onAIGenerate}
                            isGenerating={isGenerating}
                            streamingText={streamingText}
                            retryCount={retryCount}
                            onCancelGeneration={cancelGeneration}
                            pendingDiff={pendingDiff}
                            onConfirmDiff={onConfirmDiff}
                            onDiscardDiff={onDiscardDiff}
                            aiReadiness={aiReadiness}
                            lastError={lastAIError}
                            onClearError={onClearAIError}
                            chatMessages={chatMessages}
                            assistantThread={assistantThread}
                            agentTurnControls={agentTurnControls}
                            canUndoLastChange={canUndoLastChange}
                            undoLastChange={undoLastChange}
                            onClearChat={onClearChat}
                            nodeCount={nodes.length}
                            selectedNodeCount={selectedNodeCount}
                            initialPrompt={initialPrompt}
                            onInitialPromptConsumed={onInitialPromptConsumed}
                        />
                    </Suspense>
                ) : effectiveTab === 'code' ? (
                    // Applying code replaces the page, so it waits for a Flowpilot turn to end.
                    <InertWhileAgentEdits>
                        <Suspense fallback={null}>
                            <LazyStudioCodePanel
                                nodes={nodes}
                                edges={edges}
                                onApply={onApply}
                                mode={codeMode}
                                onModeChange={onCodeModeChange}
                            />
                        </Suspense>
                    </InertWhileAgentEdits>
                ) : null}
            </SidebarBody>
        </SidebarShell>
    );
}
