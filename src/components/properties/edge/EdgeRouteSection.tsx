import React from 'react';
import type { FlowEdge } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { InspectorField } from '../InspectorPrimitives';
import { SegmentedChoice } from '../SegmentedChoice';
import { readMermaidImportedEdgeMetadata } from '@/services/mermaid/importProvenance';
import { assignSmartHandlesWithOptions, getSmartRoutingOptionsFromViewSettings } from '@/services/smartEdgeRouting';
import { useFlowStore } from '@/store';

interface EdgeRouteSectionProps {
    selectedEdge: FlowEdge;
    onChange: (id: string, updates: Partial<FlowEdge>) => void;
}

function getEffectiveRoutingMode(edge: FlowEdge): 'auto' | 'elk' | 'manual' | 'import-fixed' {
    if (edge.data?.routingMode === 'manual') {
        return 'manual';
    }

    if (
        edge.data?.routingMode === 'import-fixed'
        || (edge.data?.importRoutePoints?.length ?? 0) > 0
        || typeof edge.data?.importRoutePath === 'string'
    ) {
        return 'import-fixed';
    }

    if (edge.data?.routingMode === 'elk' || (edge.data?.elkPoints?.length ?? 0) > 0) {
        return 'elk';
    }

    return 'auto';
}

// Left unset, a dynamic edge's handles would fall back to each node's first handle (the top)
// until the next reroute, so it takes its routed handles right away.
function getDynamicHandles(edge: FlowEdge): Pick<FlowEdge, 'sourceHandle' | 'targetHandle'> {
    const { nodes, viewSettings } = useFlowStore.getState();
    const [routedEdge] = assignSmartHandlesWithOptions(
        nodes,
        [edge],
        getSmartRoutingOptionsFromViewSettings(viewSettings)
    );
    return { sourceHandle: routedEdge.sourceHandle ?? null, targetHandle: routedEdge.targetHandle ?? null };
}

export function EdgeRouteSection({
    selectedEdge,
    onChange,
}: EdgeRouteSectionProps): React.ReactElement {
    const effectiveMode = getEffectiveRoutingMode(selectedEdge);
    const importedEdgeMetadata = readMermaidImportedEdgeMetadata(selectedEdge);
    const connectionType = selectedEdge.data?.connectionType === 'fixed' ? 'fixed' : 'dynamic';
    const hasElkRoute = (selectedEdge.data?.elkPoints?.length ?? 0) > 0;
    const hasImportedRoute =
        (selectedEdge.data?.importRoutePoints?.length ?? 0) > 0
        || typeof selectedEdge.data?.importRoutePath === 'string';
    const hasManualWaypoints =
        Boolean(selectedEdge.data?.waypoint) || (selectedEdge.data?.waypoints?.length ?? 0) > 0;
    const waypointCount = selectedEdge.data?.waypoints?.length
        ?? (selectedEdge.data?.waypoint ? 1 : 0);

    const resetRoute = (): void => {
        onChange(selectedEdge.id, {
            data: {
                ...selectedEdge.data,
                routingMode: hasImportedRoute ? 'import-fixed' : hasElkRoute ? 'elk' : 'auto',
                waypoint: undefined,
                waypoints: undefined,
            },
        });
    };

    return (
        <div className="space-y-3">
            <InspectorField
                label="Connector Ownership"
                helper="Dynamic connectors follow automatic handle assignment. Fixed connectors preserve their current endpoints."
            >
                <SegmentedChoice
                    items={[
                        { id: 'dynamic', label: 'Dynamic' },
                        { id: 'fixed', label: 'Fixed' },
                    ]}
                    selectedId={connectionType}
                    onSelect={(value) => {
                        const updates: Partial<FlowEdge> = {
                            sourceHandle: value === 'dynamic' ? null : selectedEdge.sourceHandle,
                            targetHandle: value === 'dynamic' ? null : selectedEdge.targetHandle,
                            data: {
                                ...selectedEdge.data,
                                connectionType: value as 'fixed' | 'dynamic',
                                ...(value === 'dynamic'
                                    ? {
                                        archSourceSide: undefined,
                                        archTargetSide: undefined,
                                    }
                                    : {}),
                            },
                        };
                        onChange(
                            selectedEdge.id,
                            value === 'dynamic'
                                ? { ...updates, ...getDynamicHandles({ ...selectedEdge, ...updates }) }
                                : updates
                        );
                    }}
                    columns={2}
                />
            </InspectorField>

            <InspectorField
                label="Path"
                helper={
                    hasManualWaypoints
                        ? `${waypointCount} custom bend${waypointCount !== 1 ? 's' : ''} stored on this edge · Reset to return to automatic routing`
                        : 'Connector routing is automatic'
                }
            >
                {hasManualWaypoints ? (
                    <Button
                        onClick={resetRoute}
                        variant="secondary"
                        className="w-full"
                    >
                        Reset path
                    </Button>
                ) : (
                    <div className="rounded-[var(--brand-radius)] border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-400 text-center select-none">
                        {effectiveMode === 'import-fixed'
                            ? 'Mermaid fixed route'
                            : importedEdgeMetadata
                                ? 'Mermaid preserved endpoints'
                            : effectiveMode === 'elk'
                                ? 'ELK auto-routed'
                                : 'Auto-routed'}
                    </div>
                )}
            </InspectorField>
        </div>
    );
}
