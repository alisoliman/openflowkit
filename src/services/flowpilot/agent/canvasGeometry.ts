import { ICON_ASSET_SIDE_HANDLE_TOP, resolveNodeSize } from '@/components/nodeHelpers';
import {
  SECTION_RENDER_MIN_HEIGHT,
  SECTION_RENDER_MIN_WIDTH,
  SECTION_TITLE_OFFSET,
  type NodeBounds,
} from '@/hooks/node-operations/sectionBounds';
import { getNodeParentId } from '@/lib/nodeParent';
import type { FlowEdge, FlowNode } from '@/lib/types';
import type { AGENT_LAYOUT_DIRECTIONS } from '@/services/copilot/agentTools';
import { isMermaidImportedContainerNode } from '@/services/mermaid/importProvenance';

// What the agent's placement, its layout check and get_canvas take a node to cover, so all three agree.

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type FlowDirection = (typeof AGENT_LAYOUT_DIRECTIONS)[number];

// The share of edges that must run one way for the page to flow that way.
const FLOW_DIRECTION_SHARE = 0.6;
// An edge label draws as a pill about this big, and needs this much room on either side of it.
const LABEL_CHAR_WIDTH = 7;
const LABEL_PADDING = 16;
const LABEL_HEIGHT = 24;
const LABEL_CLEARANCE = 16;

export function isDefaultSection(node: FlowNode): boolean {
  return node.type === 'section' && !isMermaidImportedContainerNode(node);
}

// React Flow has not measured the nodes the agent adds. Class and entity nodes draw at least 220 wide,
// with a header and a row per attribute, method or field, and journey steps at least 220 by 120.
function unmeasuredSize(node: FlowNode): Size {
  const size = resolveNodeSize(node);
  const { classAttributes = [], classMethods = [], erFields = [] } = node.data;
  const drawn =
    node.type === 'class'
      ? {
          width: 220,
          height: Math.max(140, 110 + (classAttributes.length + classMethods.length) * 20),
        }
      : node.type === 'er_entity'
        ? { width: 220, height: Math.max(130, 90 + erFields.length * 20) }
        : node.type === 'journey'
          ? { width: 220, height: 120 }
          : size;
  return { width: Math.max(size.width, drawn.width), height: Math.max(size.height, drawn.height) };
}

export function nodeSize(node: FlowNode): Size {
  const { width, height } = node.measured ?? {};
  const size = width && height ? { width, height } : unmeasuredSize(node);
  if (!isDefaultSection(node)) return size;
  return {
    width: Math.max(size.width, SECTION_RENDER_MIN_WIDTH),
    height: Math.max(size.height, SECTION_RENDER_MIN_HEIGHT),
  };
}

// What the node covers on screen: default sections draw their title above the border.
export function visualRect(node: FlowNode, rect: NodeBounds): NodeBounds {
  return isDefaultSection(node)
    ? { ...rect, y: rect.y - SECTION_TITLE_OFFSET, height: rect.height + SECTION_TITLE_OFFSET }
    : rect;
}

// Map-based getAbsoluteNodePosition for every node at once.
export function absolutePositions(nodes: ReadonlyMap<string, FlowNode>): Map<string, Point> {
  const positions = new Map<string, Point>();
  const resolve = (node: FlowNode): Point => {
    const known = positions.get(node.id);
    if (known) return known;
    const parent = nodes.get(getNodeParentId(node));
    const offset = parent && parent !== node ? resolve(parent) : { x: 0, y: 0 };
    const position = { x: node.position.x + offset.x, y: node.position.y + offset.y };
    positions.set(node.id, position);
    return position;
  };
  nodes.forEach((node) => resolve(node));
  return positions;
}

/**
 * How far below its top a node's left and right handles sit: level with the icon on icon nodes (as
 * CustomNode draws them), halfway down on the others. Edges between handles at one height run straight.
 */
export function sideHandleOffset(node: FlowNode, height: number): number {
  const { assetPresentation, archIconPackId, customIconUrl, iconAssetId, icon } = node.data;
  const iconBody =
    assetPresentation === 'icon' && Boolean(archIconPackId || customIconUrl || iconAssetId || icon);
  return iconBody ? Math.min(ICON_ASSET_SIDE_HANDLE_TOP, height) : height / 2;
}

/** Where a node's left and right handles sit on the canvas. */
export function sideHandleY(node: FlowNode, rect: NodeBounds): number {
  return rect.y + sideHandleOffset(node, rect.height);
}

/** Each node's box in absolute canvas coordinates: its position and size, without a section's title. */
export function nodeRects(nodes: ReadonlyMap<string, FlowNode>): Map<string, NodeBounds> {
  const positions = absolutePositions(nodes);
  return new Map(
    [...nodes.values()].map((node) => [node.id, { ...positions.get(node.id), ...nodeSize(node) }])
  );
}

/** The room an edge label needs between the nodes it connects, along the axis that separates them. */
export function labelRoom(label: string, horizontal: boolean): number {
  if (!label) return 0;
  const length = horizontal ? label.length * LABEL_CHAR_WIDTH + LABEL_PADDING : LABEL_HEIGHT;
  return length + LABEL_CLEARANCE * 2;
}

export function unionBounds(rects: NodeBounds[]): NodeBounds {
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function centerOf(rect: NodeBounds): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Which way an edge from one box to another mostly runs. */
export function edgeDirection(from: NodeBounds, to: NodeBounds): FlowDirection | undefined {
  const start = centerOf(from);
  const end = centerOf(to);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return undefined;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

export function isHorizontal(direction: FlowDirection): boolean {
  return direction === 'right' || direction === 'left';
}

/**
 * The way most edges between placed nodes run, or undefined when there are none or no clear majority.
 * Edges to and from sections are left out: they attach to a boundary, not a step in the flow.
 */
export function flowDirection(
  nodes: ReadonlyMap<string, FlowNode>,
  edges: Iterable<FlowEdge>,
  rects: ReadonlyMap<string, NodeBounds>
): FlowDirection | undefined {
  const counts = new Map<FlowDirection, number>();
  let total = 0;
  for (const edge of edges) {
    const from = rects.get(edge.source);
    const to = rects.get(edge.target);
    if (!from || !to || edge.source === edge.target) continue;
    if (nodes.get(edge.source)?.type === 'section' || nodes.get(edge.target)?.type === 'section') {
      continue;
    }
    const direction = edgeDirection(from, to);
    if (!direction) continue;
    counts.set(direction, (counts.get(direction) ?? 0) + 1);
    total += 1;
  }
  const [top] = [...counts].sort((left, right) => right[1] - left[1]);
  return top && top[1] / total >= FLOW_DIRECTION_SHARE ? top[0] : undefined;
}
