import { buildEdgeStrokeUpdates } from '@/components/properties/edge/edgeColorUtils';
import {
  buildEdgeLineStyleUpdates,
  resolveEdgeLineStyle,
  type EdgeLineStyleId,
} from '@/components/properties/edge/edgeLineStyle';
import { buildReversedEdgeUpdates } from '@/components/properties/edge/reverseEdge';
import { EDGE_DASH_PATTERNS, EDGE_STYLE } from '@/constants';
import { handleIdToSide } from '@/lib/nodeHandles';
import { MarkerType } from '@/lib/reactflowCompat';
import type { EdgeData, FlowEdge, FlowNode, GlobalEdgeOptions, NodeData } from '@/lib/types';
import {
  AGENT_COLOR_ALIASES,
  AGENT_EDGE_PATHS,
  AGENT_FONT_WEIGHTS,
  AGENT_NODE_COLORS,
  type EditCanvasOp,
} from '@/services/copilot/agentTools';
import { resolveNodeVisualStyle } from '@/theme';

// How the agent's style words map onto what the canvas stores, and back again for get_canvas.

type AgentEdgeData = NonNullable<Extract<EditCanvasOp, { op: 'add_edge' }>['data']>;
type EdgePath = (typeof AGENT_EDGE_PATHS)[number];
type Arrowheads = NonNullable<AgentEdgeData['arrowheads']>;
type ArrowStyle = NonNullable<AgentEdgeData['arrowStyle']>;
type Marker = FlowEdge['markerEnd'];

// What new edges draw with (DEFAULT_EDGE_OPTIONS).
const DEFAULT_EDGE_STROKE = EDGE_STYLE.stroke;
const DEFAULT_EDGE_WIDTH = EDGE_STYLE.strokeWidth;

// The agent's names for the line styles of the properties panel, as the canvas settings call them.
const EDGE_PATH_LINE_STYLES: Record<Exclude<EdgePath, 'default'>, EdgeLineStyleId> = {
  curved: 'bezier',
  rounded: 'smoothstep',
  sharp: 'step',
  straight: 'straight',
};

/** The agent's name for the line style an edge draws with, given the diagram-wide curve. */
export function edgePathName(edge: Pick<FlowEdge, 'type' | 'data'>, diagramCurve?: GlobalEdgeOptions['curve']): string {
  const lineStyle = resolveEdgeLineStyle(edge as FlowEdge, diagramCurve);
  return Object.entries(EDGE_PATH_LINE_STYLES).find(([, id]) => id === lineStyle)?.[0] ?? 'curved';
}

const FONT_WEIGHT_VALUES: Record<(typeof AGENT_FONT_WEIGHTS)[number], string> = {
  normal: 'normal',
  medium: '500',
  semibold: '600',
  bold: 'bold',
};

function isHexColor(color: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(color);
}

/** A palette key with the usual aliases resolved, or a lowercase hex. */
export function normalizeAgentColor(color: string): string {
  if (isHexColor(color)) return color.toLowerCase();
  return AGENT_COLOR_ALIASES[color as keyof typeof AGENT_COLOR_ALIASES] ?? color;
}

/** The node data for a palette key or a hex, as the color picker stores them. */
export function nodeColorData(color: string): Pick<NodeData, 'color' | 'customColor'> {
  const normalized = normalizeAgentColor(color);
  return isHexColor(normalized)
    ? { color: 'custom', customColor: normalized }
    : { color: normalized, customColor: undefined };
}

/** What a node's color reads as: a palette key, or a hex for a custom color. */
export function describeNodeColor(data: NodeData): string | undefined {
  if (data.color === 'custom') return data.customColor || undefined;
  return data.color || undefined;
}

export function fontWeightValue(weight: (typeof AGENT_FONT_WEIGHTS)[number]): string {
  return FONT_WEIGHT_VALUES[weight];
}

function describeFontWeight(weight: string | undefined): string | undefined {
  if (!weight) return undefined;
  const named = Object.entries(FONT_WEIGHT_VALUES).find(([, value]) => value === weight)?.[0];
  return named ?? (weight === '700' ? 'bold' : weight === '400' ? 'normal' : weight);
}

/** The style fields a node sets, in the words edit_canvas takes; only those in `fields` besides stacking. */
export function describeNodeStyle(node: FlowNode, fields: readonly string[]): Record<string, unknown> {
  const { data } = node;
  const style: Record<string, unknown> = {
    color: describeNodeColor(data),
    colorMode: data.colorMode,
    shape: data.shape,
    fontSize: data.fontSize && !isNaN(Number(data.fontSize)) ? Number(data.fontSize) : data.fontSize,
    fontFamily: data.fontFamily,
    fontWeight: describeFontWeight(data.fontWeight),
    fontStyle: data.fontStyle,
    align: data.align,
    variant: data.variant && data.variant !== 'default' ? data.variant : undefined,
    zIndex: typeof node.zIndex === 'number' && node.zIndex !== 0 && node.type !== 'section' ? node.zIndex : undefined,
  };
  return Object.fromEntries(
    Object.entries(style).filter(
      ([key, value]) => value !== undefined && value !== '' && (key === 'zIndex' || fields.includes(key))
    )
  );
}

/** The hex a palette key or hex draws an edge in: the key's border tone, as the edge color picker uses. */
export function edgeStrokeFor(color: string): string {
  const normalized = normalizeAgentColor(color);
  return isHexColor(normalized) ? normalized : resolveNodeVisualStyle(normalized, 'subtle').border;
}

// The palette key an edge stroke came from, when it is one of them.
function paletteKeyForStroke(stroke: string): string | undefined {
  const lower = stroke.toLowerCase();
  return AGENT_NODE_COLORS.find((key) => resolveNodeVisualStyle(key, 'subtle').border.toLowerCase() === lower);
}

function markerType(marker: Marker): string | undefined {
  return marker && typeof marker === 'object' && 'type' in marker ? String(marker.type) : undefined;
}

function arrowheadsOf(edge: FlowEdge): Arrowheads {
  const start = Boolean(edge.markerStart);
  const end = Boolean(edge.markerEnd);
  return start && end ? 'both' : start ? 'start' : end ? 'end' : 'none';
}

function arrowStyleOf(edge: FlowEdge): ArrowStyle {
  const type = markerType(edge.markerEnd) ?? markerType(edge.markerStart);
  return type === MarkerType.Arrow ? 'open' : 'filled';
}

// Only an edge that pins its own curve has a line style of its own; the others follow the diagram's.
function pathOf(edge: FlowEdge): string {
  return edge.data?.curve ? edgePathName(edge) : 'default';
}

// The canvas draws only the dashes in the edge's style, whatever data.dashPattern says.
function dashPatternOf(edge: FlowEdge): string {
  const dash = String(edge.style?.strokeDasharray ?? '').trim();
  if (!dash) return 'solid';
  const [name] = Object.entries(EDGE_DASH_PATTERNS).find(([, pattern]) => pattern.strokeDasharray === dash) ?? [];
  return name ?? 'dashed';
}

/**
 * An edge's styling in the words edit_canvas takes. The summary keeps only what differs from a plain
 * edge, so the agent sees direction, color and dashes at a glance; full lists every field.
 */
export function describeEdgeStyle(edge: FlowEdge, full: boolean): Record<string, unknown> {
  const stroke = typeof edge.style?.stroke === 'string' ? edge.style.stroke : undefined;
  const width = Number(edge.style?.strokeWidth);
  const style: Record<string, unknown> = {
    color: !stroke || stroke.toLowerCase() === DEFAULT_EDGE_STROKE
      ? 'default'
      : (paletteKeyForStroke(stroke) ?? stroke.toLowerCase()),
    arrowheads: arrowheadsOf(edge),
    arrowStyle: arrowStyleOf(edge),
    path: pathOf(edge),
    width: Number.isFinite(width) && width > 0 ? width : DEFAULT_EDGE_WIDTH,
    dashPattern: dashPatternOf(edge),
    animated: Boolean(edge.animated),
    labelPosition: typeof edge.data?.labelPosition === 'number' ? Math.round(edge.data.labelPosition * 100) / 100 : 0.5,
    sourceSide: edge.data?.connectionType === 'fixed' ? (handleIdToSide(edge.sourceHandle) ?? 'auto') : 'auto',
    targetSide: edge.data?.connectionType === 'fixed' ? (handleIdToSide(edge.targetHandle) ?? 'auto') : 'auto',
  };
  if (full) return style;
  const plain: Record<string, unknown> = {
    color: ['default'],
    arrowheads: ['end'],
    arrowStyle: ['filled'],
    path: ['default'],
    width: [DEFAULT_EDGE_WIDTH, 1.5],
    dashPattern: ['solid'],
    animated: [false],
    labelPosition: [0.5],
    sourceSide: ['auto'],
    targetSide: ['auto'],
  };
  return Object.fromEntries(
    Object.entries(style).filter(([key, value]) => !(plain[key] as unknown[]).includes(value))
  );
}

export interface EdgeStyleContext {
  /** The diagram-wide edge style, which `path: default` returns to. */
  edgeDefaults?: Pick<GlobalEdgeOptions, 'type'>;
}

function withMarkers(edge: FlowEdge, arrowheads: Arrowheads, arrowStyle: ArrowStyle): FlowEdge {
  const type = arrowStyle === 'open' ? MarkerType.Arrow : MarkerType.ArrowClosed;
  // Filled arrows follow the line's color by themselves; open ones are drawn by React Flow, which leaves a
  // marker without a color unstroked.
  const stroke = typeof edge.style?.stroke === 'string' ? edge.style.stroke : undefined;
  const color = stroke ?? (arrowStyle === 'open' ? DEFAULT_EDGE_STROKE : undefined);
  const marker = color ? { type, color } : { type };
  const start = arrowheads === 'start' || arrowheads === 'both' ? marker : undefined;
  const end = arrowheads === 'end' || arrowheads === 'both' ? marker : undefined;
  const archDirection = { end: '-->', start: '<--', both: '<-->', none: undefined }[arrowheads];
  return {
    ...edge,
    markerStart: start,
    markerEnd: end,
    // Architecture edges state their direction too, for Mermaid export.
    ...(typeof edge.data?.archDirection === 'string'
      ? { data: { ...edge.data, archDirection: archDirection as EdgeData['archDirection'] } }
      : {}),
  };
}

/**
 * Applies the style fields of an edge patch, as the edge properties panel does: a new stroke recolors
 * the arrowheads, a dash pattern sets the dashes the edge draws, and a line shape pins the edge's curve
 * so it wins over the diagram-wide one.
 */
export function withEdgeStyle(edge: FlowEdge, patch: AgentEdgeData, context: EdgeStyleContext = {}): FlowEdge {
  const { color, arrowheads, arrowStyle, path, width, dashPattern, animated, labelPosition } = patch;
  let next: FlowEdge = { ...edge, style: { ...edge.style }, data: { ...edge.data } };
  if (color !== undefined) {
    if (color === 'default') {
      const { stroke: _stroke, ...style } = next.style ?? {};
      const uncolor = (marker: Marker): Marker => {
        if (!marker || typeof marker !== 'object') return marker;
        const { color: _color, ...rest } = marker;
        // Open arrows need a color, so they keep the neutral one.
        return rest.type === MarkerType.Arrow ? { ...rest, color: DEFAULT_EDGE_STROKE } : rest;
      };
      next = { ...next, style, markerStart: uncolor(next.markerStart), markerEnd: uncolor(next.markerEnd) };
    } else {
      next = { ...next, ...buildEdgeStrokeUpdates(next, edgeStrokeFor(color)) };
    }
  }
  if (arrowheads !== undefined || arrowStyle !== undefined) {
    next = withMarkers(next, arrowheads ?? arrowheadsOf(next), arrowStyle ?? arrowStyleOf(next));
  }
  if (path !== undefined) {
    if (path === 'default') {
      const { curve: _curve, ...data } = next.data ?? {};
      const type = context.edgeDefaults?.type;
      next = { ...next, type: type && type !== 'default' ? type : undefined, data };
    } else {
      next = { ...next, ...buildEdgeLineStyleUpdates(next, EDGE_PATH_LINE_STYLES[path]) };
    }
  }
  if (width !== undefined) next = { ...next, style: { ...next.style, strokeWidth: width } };
  if (dashPattern !== undefined) {
    next = {
      ...next,
      style: { ...next.style, strokeDasharray: EDGE_DASH_PATTERNS[dashPattern].strokeDasharray },
      data: { ...next.data, dashPattern },
    };
  }
  if (animated !== undefined) next = { ...next, animated };
  if (labelPosition !== undefined) {
    next = { ...next, data: { ...next.data, labelPosition, labelOffsetX: 0, labelOffsetY: 0 } };
  }
  return next;
}

/** Swaps an edge's ends, as the Swap button does, so its flow and arrowheads run the other way. */
export function reversedEdge(edge: FlowEdge): FlowEdge {
  return { ...edge, ...buildReversedEdgeUpdates(edge) };
}
