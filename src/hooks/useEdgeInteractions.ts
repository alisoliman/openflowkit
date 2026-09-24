import { useEffect, useCallback } from 'react';
import { useReactFlow, MarkerType } from '@/lib/reactflowCompat';
import type { FlowEdge } from '@/lib/types';
import { useFlowStore } from '@/store';
import { applyArchitectureDirection } from '@/components/properties/edge/architectureSemantics';
import { buildReversedEdgeUpdates, canReverseEdge } from '@/components/properties/edge/reverseEdge';

/**
 * Edge-specific keyboard shortcuts.
 * Must be used within a ReactFlowProvider.
 *
 * Shortcuts (when an edge is selected):
 *   Delete / Backspace — delete edge
 *   R — reverse direction
 *   B — toggle bidirectional
 */
export function useEdgeInteractions() {
    const { getEdges, getNodes, setEdges } = useReactFlow();

    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        // Skip if user is typing in an input/textarea
        const tag = (event.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        // Browser and app shortcuts such as Cmd+R keep their meaning, and a held key is one edit.
        if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
        // Flowpilot owns the page while a turn runs.
        if (useFlowStore.getState().agentTurn) return;

        const edges = getEdges();
        const selectedEdges = edges.filter((e) => e.selected);
        if (selectedEdges.length === 0) return;

        switch (event.key.toLowerCase()) {
            case 'r': {
                // Reverse direction of selected edges
                const nodes = getNodes();
                const reversibleIds = new Set(
                    selectedEdges.filter((e) => canReverseEdge(e, nodes)).map((e) => e.id)
                );
                if (reversibleIds.size === 0) break;
                event.preventDefault();
                useFlowStore.getState().recordHistoryV2();
                setEdges((eds) =>
                    eds.map((e) => (reversibleIds.has(e.id) ? { ...e, ...buildReversedEdgeUpdates(e as FlowEdge) } : e))
                );
                break;
            }
            case 'b': {
                // Toggle bidirectional
                event.preventDefault();
                useFlowStore.getState().recordHistoryV2();
                setEdges((eds) =>
                    eds.map((e) => {
                        if (!e.selected) return e;
                        const isBidirectional = !!e.markerStart;
                        const nextDirection = isBidirectional ? '-->' : '<-->';
                        const architectureUpdates = applyArchitectureDirection(e, nextDirection);
                        return {
                            ...e,
                            markerStart: isBidirectional
                                ? undefined
                                : { type: MarkerType.ArrowClosed, color: (e.style?.stroke as string) || '#94a3b8' },
                            ...architectureUpdates,
                        };
                    })
                );
                break;
            }
            default:
                break;
        }
    }, [getEdges, getNodes, setEdges]);

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);
}
