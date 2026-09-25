import { startTransition, useCallback, useState } from 'react';
import type { ExportResult } from '@/services/export/exportResult';
import type { TFunction } from 'i18next';
import { createLogger } from '@/lib/logger';
import { getAppUrl } from '@/lib/appUrl';
import type { FlowEdge, FlowNode } from '@/lib/types';
import { captureAnalyticsEvent } from '@/services/analytics/analytics';
import type { FlowTemplate } from '@/services/templates';
import type { LayoutAlgorithm } from '@/services/elkLayout';
import type { ExportSerializationMode } from '@/services/canonicalSerialization';
import {
    downloadFigmaToFile,
    downloadMermaidToFile,
    downloadOpenFlowDSLToFile,
    downloadPlantUMLToFile,
    exportFigmaToClipboard,
    exportMermaidToClipboard,
    exportOpenFlowDSLToClipboard,
    exportPlantUMLToClipboard,
} from './flow-editor-actions/exportHandlers';
import { toOpenFlowDSL } from '@/services/openFlowDSLExporter';
import { encodeDslForViewer } from '@/services/viewerUrlCodec';
import {
    buildTemplateInsertionResult,
    getAutoLayoutResult,
    scheduleFitView,
} from './flow-editor-actions/layoutHandlers';
import { recordOnboardingEvent } from '@/services/onboarding/events';
import { useFlowStore } from '@/store';

const logger = createLogger({ scope: 'useFlowEditorActions' });

interface UseFlowEditorActionsParams {
    nodes: FlowNode[];
    edges: FlowEdge[];
    activePageName?: string;
    recordHistory: () => void;
    setNodes: (nodes: FlowNode[] | ((nodes: FlowNode[]) => FlowNode[])) => void;
    setEdges: (edges: FlowEdge[] | ((edges: FlowEdge[]) => FlowEdge[])) => void;
    fitView: (options?: { duration?: number; padding?: number }) => void;
    t: TFunction;
    addToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning', duration?: number) => void;
    exportSerializationMode: ExportSerializationMode;
}

interface UseFlowEditorActionsResult {
    isLayouting: boolean;
    onLayout: (
        direction?: 'TB' | 'LR' | 'RL' | 'BT',
        algorithm?: LayoutAlgorithm,
        spacing?: 'compact' | 'normal' | 'loose',
        diagramType?: string
    ) => Promise<void>;
    handleInsertTemplate: (template: FlowTemplate) => void;
    handleExportMermaid: () => Promise<ExportResult>;
    handleDownloadMermaid: () => ExportResult;
    handleExportPlantUML: () => Promise<ExportResult>;
    handleDownloadPlantUML: () => ExportResult;
    handleExportOpenFlowDSL: () => Promise<ExportResult>;
    handleDownloadOpenFlowDSL: () => ExportResult;
    handleExportFigma: () => Promise<ExportResult>;
    handleDownloadFigma: () => Promise<ExportResult>;
    handleShare: () => void;
    shareViewerUrl: string | null;
    clearShareViewerUrl: () => void;
}

export function useFlowEditorActions({
    nodes,
    edges,
    activePageName,
    recordHistory,
    setNodes,
    setEdges,
    fitView,
    t,
    addToast,
    exportSerializationMode,
}: UseFlowEditorActionsParams): UseFlowEditorActionsResult {
    const [isLayouting, setIsLayouting] = useState(false);

    const onLayout = useCallback(async (
        direction: 'TB' | 'LR' | 'RL' | 'BT' = 'TB',
        algorithm: LayoutAlgorithm = 'layered',
        spacing: 'compact' | 'normal' | 'loose' = 'normal',
        diagramType?: string
    ): Promise<void> => {
        if (nodes.length === 0) return;
        setIsLayouting(true);

        try {
            await new Promise<void>((resolve) => {
                window.requestAnimationFrame(() => resolve());
            });

            const { nodes: layoutedNodes, edges: layoutedEdges } = await getAutoLayoutResult({
                nodes,
                edges,
                direction,
                algorithm,
                spacing,
                diagramType,
            });
            // A Flowpilot turn started meanwhile owns the page, so this layout of the earlier canvas is dropped.
            if (useFlowStore.getState().agentTurn) return;
            recordHistory();
            startTransition(() => {
                setNodes(layoutedNodes);
                setEdges(layoutedEdges);
            });
            scheduleFitView(fitView, 800, 50);
        } catch (error) {
            logger.error('ELK layout failed.', { error });
        } finally {
            setIsLayouting(false);
        }
    }, [nodes, edges, recordHistory, setNodes, setEdges, fitView]);

    const handleInsertTemplate = useCallback((template: FlowTemplate): void => {
        recordHistory();
        recordOnboardingEvent('template_inserted', {
            templateId: template.id,
            category: template.category,
        });
        captureAnalyticsEvent('template_used', {
            template_id: template.id,
            template_category: template.category,
        });
        const { nextNodes, newEdges } = buildTemplateInsertionResult({
            template,
            existingNodes: nodes,
        });

        setNodes(nextNodes);
        setEdges((existingEdges) => [...existingEdges, ...newEdges]);
        scheduleFitView(fitView, 800, 100);
    }, [nodes, recordHistory, setNodes, setEdges, fitView]);

    const handleExportMermaid = useCallback(async (): Promise<ExportResult> => {
        return exportMermaidToClipboard({ nodes, edges, t, addToast });
    }, [nodes, edges, t, addToast]);

    const handleDownloadMermaid = useCallback((): ExportResult => {
        return downloadMermaidToFile({ nodes, edges, addToast, baseFileName: activePageName });
    }, [nodes, edges, addToast, activePageName]);

    const handleExportPlantUML = useCallback(async (): Promise<ExportResult> => {
        return exportPlantUMLToClipboard({ nodes, edges, t, addToast });
    }, [nodes, edges, t, addToast]);

    const handleDownloadPlantUML = useCallback((): ExportResult => {
        return downloadPlantUMLToFile({ nodes, edges, addToast, baseFileName: activePageName });
    }, [nodes, edges, addToast, activePageName]);

    const handleExportOpenFlowDSL = useCallback(async (): Promise<ExportResult> => {
        return exportOpenFlowDSLToClipboard({
            nodes,
            edges,
            addToast,
            t,
            exportSerializationMode,
        });
    }, [nodes, edges, addToast, t, exportSerializationMode]);

    const handleDownloadOpenFlowDSL = useCallback((): ExportResult => {
        return downloadOpenFlowDSLToFile({
            nodes,
            edges,
            exportSerializationMode,
            addToast,
            baseFileName: activePageName,
        });
    }, [nodes, edges, exportSerializationMode, addToast, activePageName]);

    const handleExportFigma = useCallback(async (): Promise<ExportResult> => {
        return exportFigmaToClipboard({ nodes, edges, addToast, t });
    }, [nodes, edges, addToast, t]);

    const handleDownloadFigma = useCallback(async (): Promise<ExportResult> => {
        return downloadFigmaToFile({ nodes, edges, addToast, t, baseFileName: activePageName });
    }, [nodes, edges, addToast, t, activePageName]);

    const [shareViewerUrl, setShareViewerUrl] = useState<string | null>(null);

    const handleShare = useCallback((): void => {
        if (nodes.length === 0) {
            addToast('Add nodes before creating a share link.', 'error');
            return;
        }
        const dsl = toOpenFlowDSL(nodes, edges, { mode: exportSerializationMode });
        const encoded = encodeDslForViewer(dsl);
        const url = `${getAppUrl()}/#/view?flow=${encoded}`;
        setShareViewerUrl(url);
        recordOnboardingEvent('first_share_opened', { surface: 'editor' });
        captureAnalyticsEvent('share_opened', { surface: 'editor' });
    }, [nodes, edges, exportSerializationMode, addToast]);

    const clearShareViewerUrl = useCallback((): void => setShareViewerUrl(null), []);

    return {
        isLayouting,
        onLayout,
        handleInsertTemplate,
        handleExportMermaid,
        handleDownloadMermaid,
        handleExportPlantUML,
        handleDownloadPlantUML,
        handleExportOpenFlowDSL,
        handleDownloadOpenFlowDSL,
        handleExportFigma,
        handleDownloadFigma,
        handleShare,
        shareViewerUrl,
        clearShareViewerUrl,
    };
}
