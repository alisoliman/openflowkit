import React, { useState } from 'react';
import type { FlowEdge } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { getManualWaypoints, withManualWaypoints } from '@/components/custom-edge/edgeWaypointControls';
import { coerceEdgeCurve, curveFromLegacyVariant, isOrthogonalStepCurve } from '@/components/custom-edge/edgeCurve';
import { InspectorField } from '../InspectorPrimitives';
import { SegmentedChoice } from '../SegmentedChoice';
import { readMermaidImportedEdgeMetadata } from '@/services/mermaid/importProvenance';
import { assignSmartHandlesWithOptions, getSmartRoutingOptionsFromViewSettings } from '@/services/smartEdgeRouting';
import { useFlowStore } from '@/store';
import { useIsAgentEditing } from '@/store/selectionHooks';
import { handlePropertyInputKeyDown } from '../propertyInputBehavior';

interface EdgeRouteSectionProps {
    selectedEdge: FlowEdge;
    onChange: (id: string, updates: Partial<FlowEdge>) => void;
}

interface BendCoordinateInputProps {
    axis: 'x' | 'y';
    bendNumber: number;
    value: number;
    onCommit: (value: number) => void;
}

function BendCoordinateInput({ axis, bendNumber, value, onCommit }: BendCoordinateInputProps): React.ReactElement {
    const [draft, setDraft] = useState<string | null>(null);
    const formattedValue = String(Number(value.toFixed(2)));

    return (
        <Input
            type="number"
            step="any"
            label={axis.toUpperCase()}
            aria-label={`Bend ${bendNumber} ${axis.toUpperCase()}`}
            value={draft ?? formattedValue}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => {
                const nextValue = Number(event.target.value);
                if (draft !== null && event.target.value.trim() && Number.isFinite(nextValue) && nextValue !== value) {
                    onCommit(nextValue);
                }
                setDraft(null);
            }}
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    // Restore before blur so cancellation cannot commit the draft.
                    event.currentTarget.value = String(value);
                    setDraft(null);
                }
                handlePropertyInputKeyDown(event, { blurOnEnter: true });
                if (event.key === 'Escape') event.currentTarget.blur();
            }}
        />
    );
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
    const isAgentEditing = useIsAgentEditing();
    const diagramCurve = useFlowStore((state) => state.globalEdgeOptions.curve);
    const legacyVariant = selectedEdge.type === 'step' || selectedEdge.type === 'smoothstep' || selectedEdge.type === 'straight'
        ? selectedEdge.type : 'bezier';
    const resolvedCurve = selectedEdge.data?.curve
        ? coerceEdgeCurve(selectedEdge.data.curve)
        : diagramCurve ?? curveFromLegacyVariant(legacyVariant);
    const isStepRoute = isOrthogonalStepCurve(resolvedCurve);
    const isSelfLoop = selectedEdge.source === selectedEdge.target;
    const stepRouteHint = 'Drag horizontal segments up/down or vertical segments left/right. Right angles stay locked.';
    const selfLoopHint = 'Self-loop routes are automatic; bend handles are not available.';
    const effectiveMode = getEffectiveRoutingMode(selectedEdge);
    const importedEdgeMetadata = readMermaidImportedEdgeMetadata(selectedEdge);
    const connectionType = selectedEdge.data?.connectionType === 'fixed' ? 'fixed' : 'dynamic';
    const waypoints = getManualWaypoints(selectedEdge.data);
    const waypointCount = waypoints.length;
    const hasManualWaypoints = waypointCount > 0;

    const resetRoute = (): void => {
        if (useFlowStore.getState().agentTurn) return;
        onChange(selectedEdge.id, {
            data: withManualWaypoints(selectedEdge.data, []),
        });
    };

    const updateWaypoints = (nextWaypoints: typeof waypoints): void => {
        if (useFlowStore.getState().agentTurn) return;
        onChange(selectedEdge.id, {
            data: withManualWaypoints(selectedEdge.data, nextWaypoints),
        });
    };

    return (
        <fieldset disabled={isAgentEditing} className="min-w-0 space-y-3">
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
                        if (useFlowStore.getState().agentTurn || value === connectionType) return;
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
                        ? `${waypointCount} custom bend${waypointCount !== 1 ? 's' : ''}. Reset to restore the original route.`
                        : isSelfLoop
                            ? selfLoopHint
                            : isStepRoute
                                ? `Connector routing is automatic. ${stepRouteHint}`
                                : 'Connector routing is automatic. Select the arrow and drag its round handles to add or move a bend.'
                }
            >
                {hasManualWaypoints ? (
                    <div className="space-y-3">
                        <p className="text-xs leading-relaxed text-[var(--brand-secondary)]">
                            {isSelfLoop
                                ? selfLoopHint
                                : isStepRoute
                                    ? `${stepRouteHint} You can also enter bend coordinates below. Press Enter or leave a field to apply.`
                                    : 'Drag the arrow’s round handles, or enter bend coordinates below. Press Enter or leave a field to apply.'}
                        </p>
                        {waypoints.map((point, index) => (
                            <fieldset
                                key={`${selectedEdge.id}-${index}`}
                                className="min-w-0 rounded-[var(--radius-md)] border border-[var(--color-brand-border)] p-3"
                            >
                                <legend className="px-1 text-xs font-semibold text-[var(--brand-text)]">Bend {index + 1}</legend>
                                <div className="grid grid-cols-2 gap-2">
                                    {(['x', 'y'] as const).map((axis) => (
                                        <BendCoordinateInput
                                            key={`${axis}-${point[axis]}`}
                                            axis={axis}
                                            bendNumber={index + 1}
                                            value={point[axis]}
                                            onCommit={(value) => updateWaypoints(waypoints.map((waypoint, waypointIndex) => (
                                                waypointIndex === index ? { ...waypoint, [axis]: value } : waypoint
                                            )))}
                                        />
                                    ))}
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="mt-2 w-full"
                                    aria-label={`Remove bend ${index + 1}`}
                                    onClick={() => updateWaypoints(waypoints.filter((_, waypointIndex) => waypointIndex !== index))}
                                >
                                    Remove bend
                                </Button>
                            </fieldset>
                        ))}
                        <Button
                            onClick={resetRoute}
                            variant="secondary"
                            className="w-full"
                        >
                            Reset path
                        </Button>
                    </div>
                ) : (
                    <div className="rounded-[var(--brand-radius)] border border-[var(--color-brand-border)] bg-[var(--brand-background)] px-3 py-2 text-center text-xs text-[var(--brand-secondary)]">
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
        </fieldset>
    );
}
