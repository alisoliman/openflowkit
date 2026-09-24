import { useCallback } from 'react';
import { useFlowStore } from '@/store';
import { buildArchitectureServiceSuggestionPrompt, buildEntityFieldGenerationPrompt } from '@/hooks/ai-generation/nodeActionPrompts';
import type { StudioCodeMode, StudioTab } from '@/hooks/useFlowEditorUIState';
import type { ArchitectureTemplateId } from '@/lib/architectureTemplates';
import type { FlowNode } from '@/lib/types';

interface UseFlowEditorPanelActionsParams {
    handleFocusedAIRequest: (prompt: string, selectedNodeIds?: string[]) => Promise<boolean>;
    setStudioTab: (tab: StudioTab) => void;
    setStudioCodeMode: (mode: StudioCodeMode) => void;
    setStudioMode: () => void;
    handleApplyArchitectureTemplate?: (sourceId: string, templateId: ArchitectureTemplateId) => void;
}

interface UseFlowEditorPanelActionsResult {
    handleGenerateEntityFields: (nodeId: string) => Promise<void>;
    handleSuggestArchitectureNode: (nodeId: string) => Promise<void>;
    handleOpenMermaidCodeEditor: () => void;
    applyArchitectureTemplate: (sourceId: string, templateId: ArchitectureTemplateId) => void;
}

export function useFlowEditorPanelActions({
    handleFocusedAIRequest,
    setStudioTab,
    setStudioCodeMode,
    setStudioMode,
    handleApplyArchitectureTemplate,
}: UseFlowEditorPanelActionsParams): UseFlowEditorPanelActionsResult {
    const runNodeAIRequest = useCallback(async (nodeId: string, buildPrompt: (node: FlowNode, forAgent: boolean) => string) => {
        const { nodes, aiSettings } = useFlowStore.getState();
        const node = nodes.find((candidate) => candidate.id === nodeId);
        if (!node) {
            return;
        }

        const isCopilot = (aiSettings.provider ?? 'copilot') === 'copilot';
        // A Copilot turn locks the editor while it works, so show it in the studio, where it can be stopped.
        if (isCopilot) {
            setStudioTab('ai');
            setStudioMode();
        }
        await handleFocusedAIRequest(buildPrompt(node, isCopilot), [nodeId]);
    }, [handleFocusedAIRequest, setStudioMode, setStudioTab]);

    const handleGenerateEntityFields = useCallback(
        (nodeId: string) => runNodeAIRequest(nodeId, buildEntityFieldGenerationPrompt),
        [runNodeAIRequest]
    );

    const handleSuggestArchitectureNode = useCallback(
        (nodeId: string) => runNodeAIRequest(nodeId, buildArchitectureServiceSuggestionPrompt),
        [runNodeAIRequest]
    );

    const handleOpenMermaidCodeEditor = useCallback(() => {
        setStudioTab('code');
        setStudioCodeMode('mermaid');
        setStudioMode();
    }, [setStudioCodeMode, setStudioMode, setStudioTab]);

    const applyArchitectureTemplate = useCallback((sourceId: string, templateId: ArchitectureTemplateId) => {
        handleApplyArchitectureTemplate?.(sourceId, templateId);
    }, [handleApplyArchitectureTemplate]);

    return {
        handleGenerateEntityFields,
        handleSuggestArchitectureNode,
        handleOpenMermaidCodeEditor,
        applyArchitectureTemplate,
    };
}
