import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createLogger } from '@/lib/logger';
import type { FlowEdge, FlowNode, FlowHistoryState } from '@/lib/types';
import { captureAnalyticsEvent } from '@/services/analytics/analytics';
import { chatWithFlowpilot } from '@/services/aiService';
import {
  buildFlowpilotConversationPrompt,
  buildFlowpilotAssistantSystemInstruction,
  buildFlowpilotDiagramPrompt,
} from '@/services/flowpilot/prompting';
import { groundFlowpilotAssets, summarizeAssetGrounding } from '@/services/flowpilot/assetGrounding';
import { buildFlowpilotPlan, isFlowpilotConfirmation } from '@/services/flowpilot/responsePolicy';
import {
  assistantThreadToChatMessages,
  createAnswerThreadItem,
  createErrorThreadItem,
  createPreviewThreadItem,
  createUserThreadItem,
  getLatestAssistantResponse,
  getPendingConversationPlan,
  setPreviewStatus,
} from '@/services/flowpilot/thread';
import type { AssetGroundingMatch, DiagramChangeSummary } from '@/services/flowpilot/types';
import { getCanvasFingerprint, summarizeDiagramChanges } from '@/services/flowpilot/changeSummary';
import { serializeCanvasContextForAI } from '@/services/ai/contextSerializer';
import { useFlowStore } from '@/store';
import { useToast } from '@/components/ui/ToastContext';
import { toErrorMessage } from './ai-generation/graphComposer';
import { generateAIFlowResult, type GenerateAIFlowResult } from './ai-generation/requestLifecycle';
import { parseStreamingDsl } from './ai-generation/streamingParser';
import { setStreamingGraph, setStreamingActive } from './ai-generation/streamingStore';
import {
  buildCodeToArchitecturePrompt,
  buildCodebaseToArchitecturePrompt,
  type SupportedLanguage,
} from './ai-generation/codeToArchitecture';
import type { CodebaseAnalysis } from './ai-generation/codebaseAnalyzer';
import { buildCodebaseNativeDiagram } from './ai-generation/codebaseToNativeDiagram';
import { buildSqlToErdPrompt } from './ai-generation/sqlToErd';
import {
  buildTerraformToCloudPrompt,
  type TerraformInputFormat,
} from './ai-generation/terraformToCloud';
import { buildOpenApiToSequencePrompt } from './ai-generation/openApiToSequence';
import { getAIReadinessState } from './ai-generation/readiness';
import { useCopilotConnection } from './ai-generation/useCopilotConnection';
import { useAssistantThread } from './ai-generation/useAssistantThread';
import { notifyOperationOutcome } from '@/services/operationFeedback';

const logger = createLogger({ scope: 'useAIGeneration' });

export interface ImportDiff {
  addedCount: number;
  removedCount: number;
  updatedCount: number;
  previewTitle: string;
  previewDetail?: string;
  previewStats?: string[];
  assetMatches?: AssetGroundingMatch[];
  result: GenerateAIFlowResult;
  changes: DiagramChangeSummary;
  threadItemId: string;
  documentId: string;
  baselineFingerprint: string;
  stale?: boolean;
}

type PreviewRequestKind =
  | 'prompt'
  | 'focused-edit'
  | 'code-import'
  | 'sql-import'
  | 'terraform-import'
  | 'openapi-import';

interface PreviewDescriptor {
  title: string;
  detail?: string;
  stats?: string[];
}

function buildPreviewCopy(
  requestKind: PreviewRequestKind,
  addedCount: number,
  updatedCount: number,
  previewDescriptor?: PreviewDescriptor
): Pick<ImportDiff, 'previewTitle' | 'previewDetail' | 'previewStats'> {
  if (previewDescriptor) {
    return {
      previewTitle: previewDescriptor.title,
      previewDetail: previewDescriptor.detail,
      previewStats: previewDescriptor.stats,
    };
  }

  if (requestKind === 'code-import') {
    return {
      previewTitle: 'Codebase enhancement ready — review the upgraded diagram.',
      previewDetail:
        addedCount > 0 || updatedCount > 0
          ? 'Started from the native repository map and layered in AI architecture improvements.'
          : 'The native repository map is ready and no additional AI upgrades were needed.',
      previewStats: undefined,
    };
  }

  return {
    previewTitle: 'Changes ready to review.',
    previewStats: undefined,
  };
}

function computeImportDiff(
  currentNodes: FlowNode[],
  currentEdges: FlowEdge[],
  result: GenerateAIFlowResult,
  requestKind: PreviewRequestKind,
  documentId: string,
  previewDescriptor?: PreviewDescriptor,
  assetMatches?: AssetGroundingMatch[]
): ImportDiff {
  const baseline = { nodes: currentNodes, edges: currentEdges };
  const changes = summarizeDiagramChanges(baseline, { nodes: result.layoutedNodes, edges: result.layoutedEdges });
  const { addedCount, removedCount, updatedCount } = changes;
  const copy = buildPreviewCopy(requestKind, addedCount, updatedCount, previewDescriptor);
  const item = createPreviewThreadItem(result.dslText, copy.previewTitle, copy.previewDetail, copy.previewStats, assetMatches, changes);

  return {
    addedCount,
    removedCount,
    updatedCount,
    assetMatches,
    ...copy,
    result,
    changes,
    threadItemId: item.id,
    documentId,
    baselineFingerprint: getCanvasFingerprint(baseline),
  };
}

function buildCodebasePreviewDescriptor(
  analysis: CodebaseAnalysis,
  nativeDiagram: ReturnType<typeof buildCodebaseNativeDiagram>
): PreviewDescriptor {
  const platformLabel =
    analysis.cloudPlatform === 'unknown'
      ? 'Platform: app-only'
      : `Platform: ${analysis.cloudPlatform}`;
  const serviceLabel =
    nativeDiagram.platformServiceCount > 0
      ? `${nativeDiagram.platformServiceCount} platform service${nativeDiagram.platformServiceCount === 1 ? '' : 's'}`
      : `${analysis.detectedServices.length} detected service${analysis.detectedServices.length === 1 ? '' : 's'}`;

  return {
    title: 'Codebase enhancement ready — review the upgraded diagram.',
    detail:
      'Started from the native repository map, then layered in AI architecture upgrades for services, sections, and labeled flows.',
    stats: [
      platformLabel,
      `${nativeDiagram.sectionCount} native section${nativeDiagram.sectionCount === 1 ? '' : 's'}`,
      serviceLabel,
      `${nativeDiagram.edgeCount} preview edge${nativeDiagram.edgeCount === 1 ? '' : 's'}`,
    ],
  };
}

function getSuccessSummary(existingNodeCount: number, focusedNodeIds?: string[]): string {
  if ((focusedNodeIds?.length ?? 0) > 0) {
    return 'Applied AI changes to the selected nodes.';
  }

  if (existingNodeCount > 0) {
    return 'Applied AI changes to the current diagram.';
  }

  return 'Created a new AI diagram draft.';
}

function getFailureSummary(existingNodeCount: number, focusedNodeIds?: string[]): string {
  if ((focusedNodeIds?.length ?? 0) > 0) {
    return 'Could not update the selected nodes.';
  }

  if (existingNodeCount > 0) {
    return 'Could not update the current diagram.';
  }

  return 'Could not generate the requested diagram.';
}

interface AppliedChange {
  documentId: string;
  threadItemId: string;
  fingerprint: string;
  undoSnapshot: FlowHistoryState | undefined;
}

export function useAIGeneration(applyComposedGraph: (nodes: FlowNode[], edges: FlowEdge[]) => void) {
  const { nodes, edges, aiSettings, globalEdgeOptions, activeTabId } = useFlowStore();
  const selectedNodeIds = nodes.filter((n) => n.selected).map((n) => n.id);
  const { addToast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [pendingDiff, setPendingDiff] = useState<ImportDiff | null>(null);
  const { assistantThread, threadReady, updateThread, appendThreadItem } = useAssistantThread(activeTabId);
  const [lastAppliedChange, setLastAppliedChange] = useState<AppliedChange | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const { connection } = useCopilotConnection((aiSettings.provider ?? 'copilot') === 'copilot');
  const providerReadiness = useMemo(() => getAIReadinessState(aiSettings, connection), [aiSettings, connection]);
  const readiness = useMemo(() => !threadReady && providerReadiness.canGenerate ? {
    ...providerReadiness,
    canGenerate: false,
    blockingIssue: {
      tone: 'info' as const,
      title: 'Restoring conversation',
      detail: 'The Flowpilot conversation is still loading. Please try again in a moment.',
    },
  } : providerReadiness, [providerReadiness, threadReady]);
  const canvasFingerprint = useMemo(() => getCanvasFingerprint({ nodes, edges }), [nodes, edges]);
  const currentPreview = threadReady && pendingDiff?.documentId === activeTabId
    && assistantThread.some((item) => item.id === pendingDiff.threadItemId && item.previewStatus === 'pending')
    ? pendingDiff : null;
  const activeHistory = useFlowStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId)?.history);
  const canUndoLastChange = Boolean(
    lastAppliedChange
    && lastAppliedChange.documentId === activeTabId
    && lastAppliedChange.fingerprint === canvasFingerprint
    && lastAppliedChange.undoSnapshot
    && activeHistory?.past.at(-1) === lastAppliedChange.undoSnapshot
  );

  const chatMessages = useMemo(() => assistantThreadToChatMessages(assistantThread), [assistantThread]);

  useEffect(() => () => abortControllerRef.current?.abort(), [activeTabId]);

  const cancelGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const clearChat = useCallback(() => {
    abortControllerRef.current?.abort();
    setPendingDiff(null);
    updateThread(() => []);
  }, [updateThread]);

  const clearLastError = useCallback(() => {
    setLastError(null);
  }, []);

  const applyChange = useCallback((preview: ImportDiff) => {
    const current = useFlowStore.getState();
    if (current.activeTabId !== preview.documentId || getCanvasFingerprint(current) !== preview.baselineFingerprint) {
      throw new Error('The canvas changed after this draft was prepared. Generate an updated draft before applying it.');
    }
    applyComposedGraph(preview.result.layoutedNodes, preview.result.layoutedEdges);
    const applied = useFlowStore.getState();
    setLastAppliedChange({
      documentId: preview.documentId,
      threadItemId: preview.threadItemId,
      fingerprint: getCanvasFingerprint(applied),
      undoSnapshot: applied.tabs.find((tab) => tab.id === applied.activeTabId)?.history.past.at(-1),
    });
    updateThread((items) => setPreviewStatus(items, preview.threadItemId, 'applied'));
  }, [applyComposedGraph, updateThread]);

  const confirmPendingDiff = useCallback((): boolean => {
    if (!currentPreview || abortControllerRef.current) return false;
    try {
      applyChange(currentPreview);
      setPendingDiff(null);
      setLastError(null);
      notifyOperationOutcome(addToast, { status: 'success', summary: 'Changes applied to canvas.' });
      return true;
    } catch (error) {
      const message = toErrorMessage(error);
      setLastError(message);
      notifyOperationOutcome(addToast, { status: 'error', summary: message });
      return false;
    }
  }, [currentPreview, applyChange, addToast]);

  const discardPendingDiff = useCallback(() => {
    if (currentPreview) updateThread((items) => setPreviewStatus(items, currentPreview.threadItemId, 'discarded'));
    setPendingDiff(null);
  }, [currentPreview, updateThread]);

  const undoLastChange = useCallback(() => {
    const current = useFlowStore.getState();
    const history = current.tabs.find((tab) => tab.id === current.activeTabId)?.history;
    if (!lastAppliedChange || current.activeTabId !== lastAppliedChange.documentId
      || getCanvasFingerprint(current) !== lastAppliedChange.fingerprint
      || history?.past.at(-1) !== lastAppliedChange.undoSnapshot) {
      addToast('The canvas has changed since this AI edit. Use the canvas Undo control to review more recent changes first.', 'warning');
      return;
    }
    current.undoV2();
    updateThread((items) => setPreviewStatus(items, lastAppliedChange.threadItemId, 'undone'));
    setLastAppliedChange(null);
    addToast('Undid the last AI edit.', 'success');
  }, [addToast, lastAppliedChange, updateThread]);

  const runConversationRequest = useCallback(
    async (
      prompt: string,
      mode: 'answer' | 'plan',
      assetMatches: AssetGroundingMatch[],
      imageBase64?: string
    ): Promise<boolean> => {
      if (abortControllerRef.current) return false;
      if (!readiness.canGenerate && readiness.blockingIssue) {
        setLastError(readiness.blockingIssue.detail);
        return false;
      }

      setLastError(null);
      setStreamingText('');
      setRetryCount(0);
      setIsGenerating(true);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await chatWithFlowpilot(
          chatMessages,
          buildFlowpilotConversationPrompt(
            prompt,
            {
              prompt,
              nodeCount: nodes.length,
              selectedNodeCount: selectedNodeIds.length,
              hasImage: Boolean(imageBase64),
              currentDiagram: serializeCanvasContextForAI(nodes, edges, selectedNodeIds),
            },
            assetMatches,
            mode
          ),
          buildFlowpilotAssistantSystemInstruction(mode),
          aiSettings.apiKey,
          aiSettings.model,
          aiSettings.provider || 'copilot',
          aiSettings.customBaseUrl,
          (delta) => setStreamingText((previous) => (previous ?? '') + delta),
          controller.signal,
          imageBase64
        );

        controller.signal.throwIfAborted();
        if (getCanvasFingerprint(useFlowStore.getState()) !== getCanvasFingerprint({ nodes, edges })) {
          throw new Error('The canvas changed while Flowpilot was answering. Ask again using the current diagram.');
        }
        appendThreadItem(createAnswerThreadItem(response, mode, assetMatches));
        notifyOperationOutcome(addToast, {
          status: 'success',
          summary: mode === 'plan' ? 'Plan ready.' : 'Flowpilot answered in chat.',
        });
        return true;
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          return false;
        }
        const errorMessage = toErrorMessage(error);
        setLastError(errorMessage);
        appendThreadItem(createErrorThreadItem(errorMessage));
        notifyOperationOutcome(addToast, {
          status: 'error',
          summary: 'Flowpilot could not finish the response.',
          detail: errorMessage,
        });
        return false;
      } finally {
        abortControllerRef.current = null;
        setIsGenerating(false);
        setStreamingText(null);
        setRetryCount(0);
      }
    },
    [
      addToast,
      aiSettings.apiKey,
      aiSettings.customBaseUrl,
      aiSettings.model,
      aiSettings.provider,
      appendThreadItem,
      chatMessages,
      nodes,
      edges,
      readiness.blockingIssue,
      readiness.canGenerate,
      selectedNodeIds,
    ]
  );

  const runDiagramRequest = useCallback(
    async (
      prompt: string,
      imageBase64?: string,
      focusedNodeIds?: string[],
      showPreview = false,
      requestKind: PreviewRequestKind = 'prompt',
      seedDsl?: string,
      previewDescriptor?: PreviewDescriptor,
      assetMatches?: AssetGroundingMatch[]
    ): Promise<boolean> => {
      if (abortControllerRef.current) return false;
      if (!readiness.canGenerate && readiness.blockingIssue) {
        setLastError(readiness.blockingIssue.detail);
        notifyOperationOutcome(addToast, {
          status: readiness.blockingIssue.tone,
          summary: readiness.blockingIssue.title,
          detail: readiness.blockingIssue.detail,
        });
        return false;
      }

      setLastError(null);
      setStreamingText('');
      setStreamingGraph(null);
      setStreamingActive(true);
      setRetryCount(0);
      setIsGenerating(true);

      const controller = new AbortController();
      abortControllerRef.current = controller;
      const baselineFingerprint = getCanvasFingerprint({ nodes, edges });
      let streamedDsl = '';
      if (currentPreview) {
        updateThread((items) => setPreviewStatus(items, currentPreview.threadItemId, 'superseded'));
        setPendingDiff(null);
      }
      captureAnalyticsEvent('ai_generation_started', {
        provider: aiSettings.provider || 'copilot',
        has_image: Boolean(imageBase64),
        is_preview: showPreview,
        request_kind: requestKind,
        selected_count: focusedNodeIds?.length ?? selectedNodeIds.length,
      });

      try {
        const groundedAssets = assetMatches ?? (
          requestKind === 'prompt' || requestKind === 'focused-edit' ? await groundFlowpilotAssets(prompt) : []
        );
        controller.signal.throwIfAborted();
        const result = await generateAIFlowResult({
          chatMessages,
          prompt: buildFlowpilotDiagramPrompt(prompt, groundedAssets),
          seedDsl,
          imageBase64,
          nodes,
          edges,
          selectedNodeIds: focusedNodeIds ?? selectedNodeIds,
          aiSettings,
          globalEdgeOptions,
          onChunk: (delta) => {
            if (controller.signal.aborted) return;
            streamedDsl += delta;
            setStreamingText(streamedDsl);
            const parsed = parseStreamingDsl(streamedDsl);
            if (parsed.nodeCount > 0) setStreamingGraph(parsed);
          },
          onRetry: (attempt) => {
            setRetryCount(attempt);
            streamedDsl = '';
            setStreamingText('');
            setStreamingGraph(null);
          },
          signal: controller.signal,
        });

        controller.signal.throwIfAborted();
        const current = useFlowStore.getState();
        if (current.activeTabId !== activeTabId || getCanvasFingerprint(current) !== baselineFingerprint) {
          throw new Error('The canvas changed while Flowpilot was working. No changes were applied. Retry using the current diagram.');
        }
        const previewDiff = computeImportDiff(nodes, edges, result, requestKind, activeTabId, previewDescriptor, groundedAssets);
        if (previewDiff.changes.totalChanges === 0) {
          appendThreadItem(createAnswerThreadItem('No changes are needed; the canvas already matches this result.', 'answer'));
          return true;
        }
        appendThreadItem({
          ...createPreviewThreadItem(result.dslText, previewDiff.previewTitle, previewDiff.previewDetail, previewDiff.previewStats, groundedAssets, previewDiff.changes),
          id: previewDiff.threadItemId,
        });
        if (showPreview && !aiSettings.autoApply) {
          setPendingDiff(previewDiff);
          notifyOperationOutcome(addToast, {
            status: 'success',
            summary: previewDiff.previewTitle,
            detail: previewDiff.previewDetail,
          });
          captureAnalyticsEvent('import_preview_ready', {
            provider: aiSettings.provider || 'copilot',
            request_kind: requestKind,
          });
        } else {
          applyChange(previewDiff);
          notifyOperationOutcome(addToast, {
            status: 'success',
            summary: getSuccessSummary(nodes.length, focusedNodeIds),
          });
        }
        captureAnalyticsEvent('ai_generation_succeeded', {
          provider: aiSettings.provider || 'copilot',
          has_image: Boolean(imageBase64),
          is_preview: showPreview,
          request_kind: requestKind,
          selected_count: focusedNodeIds?.length ?? selectedNodeIds.length,
        });
        return true;
      } catch (error: unknown) {
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          captureAnalyticsEvent('ai_generation_cancelled', {
            provider: aiSettings.provider || 'copilot',
            is_preview: showPreview,
            request_kind: requestKind,
          });
          return false;
        }
        const errorMessage = toErrorMessage(error);
        logger.error('AI generation failed.', { error });
        setLastError(errorMessage);
        appendThreadItem(createErrorThreadItem(errorMessage));
        captureAnalyticsEvent('ai_generation_failed', {
          provider: aiSettings.provider || 'copilot',
          is_preview: showPreview,
          request_kind: requestKind,
          error_name: error instanceof Error ? error.name : 'UnknownError',
        });
        notifyOperationOutcome(addToast, {
          status: 'error',
          summary: getFailureSummary(nodes.length, focusedNodeIds),
          detail: errorMessage,
        });
        return false;
      } finally {
        abortControllerRef.current = null;
        setIsGenerating(false);
        setStreamingText(null);
        setStreamingGraph(null);
        setStreamingActive(false);
        setRetryCount(0);
      }
    },
    [
      addToast,
      aiSettings,
      appendThreadItem,
      chatMessages,
      edges,
      globalEdgeOptions,
      readiness,
      nodes,
      selectedNodeIds,
      activeTabId,
      applyChange,
      currentPreview,
      updateThread,
    ]
  );

  const handleAIRequest = useCallback(
    async (prompt: string, imageBase64?: string): Promise<boolean> => {
      if (abortControllerRef.current) return false;
      if (!threadReady) {
        addToast('The Flowpilot conversation is still loading. Please try again in a moment.', 'info');
        return false;
      }
      const userThreadItem = createUserThreadItem(prompt, imageBase64);
      appendThreadItem(userThreadItem);
      if (currentPreview && getLatestAssistantResponse(assistantThread)?.id === currentPreview.threadItemId
        && isFlowpilotConfirmation(prompt)) return confirmPendingDiff();

      const previousPlan = getPendingConversationPlan(assistantThread);
      const plan = buildFlowpilotPlan({
        prompt,
        nodeCount: nodes.length,
        selectedNodeCount: selectedNodeIds.length,
        hasImage: Boolean(imageBase64),
        hasPendingPlan: Boolean(previousPlan),
      });
      if (plan.mode === 'asset_suggestions') {
        const controller = new AbortController();
        abortControllerRef.current = controller;
        setIsGenerating(true);
        try {
          const assetMatches = await groundFlowpilotAssets(prompt);
          controller.signal.throwIfAborted();
          const assetSummary = assetMatches.length > 0
            ? `I found these strong local matches: ${summarizeAssetGrounding(assetMatches)}.`
            : 'I could not find a strong local asset match yet. Try naming the cloud provider or exact service.';
          appendThreadItem(createAnswerThreadItem(assetSummary, 'asset_suggestions', assetMatches));
          return true;
        } catch (error) {
          if (!controller.signal.aborted) {
            const message = toErrorMessage(error);
            setLastError(message);
            addToast(message, 'error');
          }
          return false;
        } finally {
          abortControllerRef.current = null;
          setIsGenerating(false);
        }
      }

      if (plan.mode === 'answer' || plan.mode === 'plan' || plan.mode === 'clarification') {
        return runConversationRequest(prompt, plan.mode === 'plan' ? 'plan' : 'answer', [], imageBase64);
      }

      const diagramPrompt = previousPlan && isFlowpilotConfirmation(prompt)
        ? `${prompt}\n\nCarry out this previously discussed plan on the CURRENT DIAGRAM:\n${previousPlan}`
        : prompt;
      return runDiagramRequest(diagramPrompt, imageBase64, undefined, true, 'prompt');
    },
    [
      appendThreadItem,
      nodes.length,
      runConversationRequest,
      runDiagramRequest,
      selectedNodeIds.length,
      addToast,
      assistantThread,
      confirmPendingDiff,
      currentPreview,
      threadReady,
    ]
  );

  const handleFocusedAIRequest = useCallback(
    async (prompt: string, focusedNodeIds: string[], imageBase64?: string): Promise<boolean> => {
      if (abortControllerRef.current || !threadReady) return false;
      appendThreadItem(createUserThreadItem(prompt, imageBase64));
      return runDiagramRequest(
        prompt,
        imageBase64,
        focusedNodeIds,
        true,
        'focused-edit',
        undefined,
        undefined
      );
    },
    [appendThreadItem, runDiagramRequest, threadReady]
  );

  const handleCodeAnalysis = useCallback(
    async (code: string, language: SupportedLanguage): Promise<boolean> => {
      return runDiagramRequest(
        buildCodeToArchitecturePrompt({ code, language }),
        undefined,
        undefined,
        false,
        'code-import'
      );
    },
    [runDiagramRequest]
  );

  const handleSqlAnalysis = useCallback(
    async (sql: string): Promise<boolean> => {
      return runDiagramRequest(buildSqlToErdPrompt(sql), undefined, undefined, false, 'sql-import');
    },
    [runDiagramRequest]
  );

  const handleTerraformAnalysis = useCallback(
    async (input: string, format: TerraformInputFormat): Promise<boolean> => {
      return runDiagramRequest(
        buildTerraformToCloudPrompt(input, format),
        undefined,
        undefined,
        false,
        'terraform-import'
      );
    },
    [runDiagramRequest]
  );

  const handleOpenApiAnalysis = useCallback(
    async (spec: string): Promise<boolean> => {
      return runDiagramRequest(
        buildOpenApiToSequencePrompt(spec),
        undefined,
        undefined,
        false,
        'openapi-import'
      );
    },
    [runDiagramRequest]
  );

  const handleCodebaseAnalysis = useCallback(
    async (analysis: CodebaseAnalysis): Promise<boolean> => {
      const nativeDiagram = buildCodebaseNativeDiagram(analysis);

      return runDiagramRequest(
        buildCodebaseToArchitecturePrompt({
          summary: analysis.summary,
          cloudPlatform: analysis.cloudPlatform,
          detectedServices: analysis.detectedServices,
          infraFiles: analysis.infraFiles,
        }) +
          '\n\nUse the provided native repository diagram as the starting point. Preserve useful sections and module structure, then enhance it with platform services, clearer labels, and semantic edges.',
        undefined,
        undefined,
        true,
        'code-import',
        nativeDiagram.dsl,
        buildCodebasePreviewDescriptor(analysis, nativeDiagram)
      );
    },
    [runDiagramRequest]
  );

  return {
    isGenerating,
    streamingText,
    retryCount,
    cancelGeneration,
    pendingDiff: currentPreview ? { ...currentPreview, stale: currentPreview.baselineFingerprint !== canvasFingerprint } : null,
    confirmPendingDiff,
    discardPendingDiff,
    readiness,
    lastError,
    handleAIRequest,
    handleFocusedAIRequest,
    handleCodeAnalysis,
    handleSqlAnalysis,
    handleTerraformAnalysis,
    handleOpenApiAnalysis,
    handleCodebaseAnalysis,
    chatMessages,
    assistantThread,
    clearChat,
    clearLastError,
    canUndoLastChange,
    undoLastChange,
  };
}
