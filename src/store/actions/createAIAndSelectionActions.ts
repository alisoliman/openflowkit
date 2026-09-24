import { DEFAULT_AI_SETTINGS } from '../defaults';
import { sanitizeAISettings } from '../aiSettings';
import { persistAISettings } from '../aiSettingsPersistence';
import type { SetFlowState } from '../actionFactory';
import type { FlowState } from '../types';

export function createAIAndSelectionActions(set: SetFlowState): Pick<
    FlowState,
    | 'setAISettings'
    | 'setSelectedNodeId'
    | 'setSelectedEdgeId'
    | 'setHoveredSectionId'
    | 'queuePendingNodeLabelEditRequest'
    | 'clearPendingNodeLabelEditRequest'
    | 'setMermaidDiagnostics'
    | 'clearMermaidDiagnostics'
    | 'setAgentTurn'
> {
    return {
        setAISettings: (settings) => set((state) => {
            const nextAISettings = sanitizeAISettings({ ...state.aiSettings, ...settings }, DEFAULT_AI_SETTINGS);
            persistAISettings(nextAISettings);
            return {
                aiSettings: nextAISettings,
            };
        }),

        // The properties panel inspects one node or one edge, so selecting one clears the other.
        setSelectedNodeId: (id) => set(id ? { selectedNodeId: id, selectedEdgeId: null } : { selectedNodeId: null }),
        setSelectedEdgeId: (id) => set(id ? { selectedEdgeId: id, selectedNodeId: null } : { selectedEdgeId: null }),
        setHoveredSectionId: (id) => set({ hoveredSectionId: id }),
        queuePendingNodeLabelEditRequest: (request) => set({ pendingNodeLabelEditRequest: request }),
        clearPendingNodeLabelEditRequest: () => set({ pendingNodeLabelEditRequest: null }),
        setMermaidDiagnostics: (snapshot) => set({ mermaidDiagnostics: snapshot }),
        clearMermaidDiagnostics: () => set({ mermaidDiagnostics: null }),
        setAgentTurn: (turn) => set({ agentTurn: turn }),
    };
}
