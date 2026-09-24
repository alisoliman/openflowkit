import type { FlowEdge } from '@/lib/types';
import { clearStoredRouteData } from '@/lib/edgeRouteData';
import {
    coerceEdgeCurve,
    curveFromLegacyVariant,
    isSmoothCurve,
    type EdgeCurve,
} from '@/components/custom-edge/edgeCurve';

export type EdgeLineStyleId = 'bezier' | 'smoothstep' | 'step' | 'straight';

// Each line style sets the edge type and its curve together, as the canvas settings pair them.
// The renderer reads `data.curve` before the type, so writing only the type would leave the
// drawn path unchanged.
export const EDGE_LINE_STYLES: ReadonlyArray<{
    id: EdgeLineStyleId;
    label: string;
    type: string;
    curve: EdgeCurve;
}> = [
    { id: 'bezier', label: 'Bezier', type: 'bezier', curve: 'basis' },
    { id: 'smoothstep', label: 'Smoothstep', type: 'smoothstep', curve: 'smoothstep' },
    { id: 'step', label: 'Step', type: 'step', curve: 'step' },
    { id: 'straight', label: 'Straight', type: 'straight', curve: 'linear' },
];

function variantForType(type: string | undefined): 'bezier' | 'smoothstep' | 'step' | 'straight' {
    return type === 'smoothstep' || type === 'step' || type === 'straight' ? type : 'bezier';
}

/**
 * The line style the edge is drawn with, resolved as the renderer's live-endpoint path does:
 * the curve (the edge's, else the diagram's, else the type's) decides, except that the
 * rounded smoothstep curve still draws step and straight typed edges as their type.
 */
export function resolveEdgeLineStyle(edge: FlowEdge, diagramCurve: EdgeCurve | undefined): EdgeLineStyleId {
    const variant = variantForType(edge.type);
    const edgeCurve = edge.data?.curve ? coerceEdgeCurve(edge.data.curve) : undefined;
    const curve = edgeCurve ?? diagramCurve ?? curveFromLegacyVariant(variant);
    if (isSmoothCurve(curve)) return 'bezier';
    if (curve === 'linear') return 'straight';
    if (curve === 'step' || curve === 'stepBefore' || curve === 'stepAfter') return 'step';
    return variant === 'bezier' ? 'smoothstep' : variant;
}

export function buildEdgeLineStyleUpdates(edge: FlowEdge, styleId: string): Partial<FlowEdge> {
    const style = EDGE_LINE_STYLES.find((candidate) => candidate.id === styleId);
    if (!style) return {};
    // A stored layout route keeps drawing its own shape, so it gives way to the live endpoints;
    // a route the user bent by hand stays.
    const data = edge.data?.routingMode === 'manual' ? edge.data : clearStoredRouteData(edge);
    return {
        type: style.type,
        data: { ...data, curve: style.curve },
    };
}
