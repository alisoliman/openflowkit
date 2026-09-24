import type { EdgeData, FlowEdge, FlowNode } from '@/lib/types';
import {
    attachMermaidImportedEdgeMetadata,
    readMermaidImportedEdgeMetadata,
} from '@/services/mermaid/importProvenance';

function reversedPoints<T>(points: T[] | undefined): T[] | undefined {
    return Array.isArray(points) ? [...points].reverse() : points;
}

/** Mindmap branches read their source as the parent topic, so reversing one would flip the tree. */
export function canReverseEdge(edge: Pick<FlowEdge, 'source' | 'target'>, nodes: Pick<FlowNode, 'id' | 'type'>[]): boolean {
    const typeOf = (id: string): string | undefined => nodes.find((node) => node.id === id)?.type;
    return !(typeOf(edge.source) === 'mindmap' && typeOf(edge.target) === 'mindmap');
}

/**
 * Swaps an edge's ends. Arrowheads and an architecture direction are relative to the ends, so
 * they stay as they are and now point at the other node. Stored route points were laid out
 * from the old source, so they are walked the other way, and the label keeps its place on screen.
 */
export function buildReversedEdgeUpdates(edge: FlowEdge): Partial<FlowEdge> {
    const edgeData: EdgeData = edge.data ?? {};
    const data: EdgeData = {
        ...edgeData,
        ...(edgeData.archSourceSide !== undefined || edgeData.archTargetSide !== undefined
            ? { archSourceSide: edgeData.archTargetSide, archTargetSide: edgeData.archSourceSide }
            : {}),
        ...(edgeData.waypoints ? { waypoints: reversedPoints(edgeData.waypoints) } : {}),
        ...(edgeData.elkPoints ? { elkPoints: reversedPoints(edgeData.elkPoints) } : {}),
        ...(edgeData.importRoutePoints ? { importRoutePoints: reversedPoints(edgeData.importRoutePoints) } : {}),
        // A path string cannot be walked backwards; the route points (or live routing) replace it.
        ...(edgeData.importRoutePath !== undefined ? { importRoutePath: undefined } : {}),
        ...(typeof edgeData.labelPosition === 'number' ? { labelPosition: 1 - edgeData.labelPosition } : {}),
    };
    // Smart routing falls back to the handles a Mermaid import preferred, which belong to the old ends.
    const importedEdge = readMermaidImportedEdgeMetadata(edge);
    const reversedData = importedEdge
        ? attachMermaidImportedEdgeMetadata({ ...edge, data }, {
            ...importedEdge,
            preferredSourceHandle: importedEdge.preferredTargetHandle,
            preferredTargetHandle: importedEdge.preferredSourceHandle,
        }).data
        : data;

    return {
        source: edge.target,
        target: edge.source,
        sourceHandle: edge.targetHandle,
        targetHandle: edge.sourceHandle,
        data: reversedData,
    };
}
