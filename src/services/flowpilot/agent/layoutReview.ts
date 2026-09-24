import { getEditableEdgeLabel } from '@/components/properties/edge/edgeLabelModel';
import type { NodeBounds } from '@/hooks/node-operations/sectionBounds';
import { getNodeParentId } from '@/lib/nodeParent';
import type { FlowEdge, FlowNode } from '@/lib/types';
import {
  centerOf,
  edgeDirection,
  flowDirection,
  isHorizontal,
  labelRoom,
  nodeRects,
  sideHandleOffset,
  sideHandleY,
  unionBounds,
  visualRect,
  type FlowDirection,
  type Point,
} from './canvasGeometry';

// Connected nodes closer than this leave their edge and its arrow no room.
const MIN_CONNECTED_GAP = 40;
export const SUGGESTED_CONNECTED_GAP = 60;
// Unconnected nodes closer than this look as if they touch.
const MIN_GAP = 12;
// Connected nodes this far off each other's row or column look misplaced rather than arranged; closer
// than the lower bound, the bend in their edge does not show.
const MIN_MISALIGNMENT = 6;
const MAX_MISALIGNMENT = 30;
// A node placed or moved this far from a node it connects to was parked rather than placed.
const FAR_GAP = 1_200;
// Boxes an edge must avoid shrink by this much, so a line grazing a corner is not reported.
const EDGE_CLEARANCE = 4;
// A stored layout route whose ends are further than this from its nodes is stale, and the canvas draws
// the edge afresh instead (pathUtils.ts).
const STALE_ROUTE_DISTANCE = 60;
// Past this many node and edge pairs, get_canvas skips the checks that compare every edge.
const MAX_EDGE_CHECK_PAIRS = 2_000_000;
const DEFAULT_MAX_ISSUES = 12;
const MAX_LISTED_CROSSINGS = 3;
const MAX_LISTED_DOWNSTREAM = 6;

export const FLOW_NAMES: Record<FlowDirection, string> = {
  right: 'left to right',
  down: 'top to bottom',
  left: 'right to left',
  up: 'bottom to top',
};
const OPPOSITE: Record<FlowDirection, FlowDirection> = {
  right: 'left',
  left: 'right',
  down: 'up',
  up: 'down',
};

export interface LayoutReview {
  /** The way most edges run, when they agree. */
  flow?: FlowDirection;
  bounds?: NodeBounds;
  /** The first issues, most serious first. */
  issues: string[];
  /** Every issue found, including those not listed. */
  issueCount: number;
  /** Checks left out, and why. */
  note?: string;
}

export interface LayoutReviewOptions {
  /** Report only issues involving these nodes, such as the ones a call placed or moved. */
  focusIds?: ReadonlySet<string>;
  maxIssues?: number;
}

interface ReviewedEdge {
  edge: FlowEdge;
  from: Point;
  to: Point;
  /** The line the edge draws along: its layout route when it has one, else straight between centres. */
  path: Point[];
}

function overlapSize(a: NodeBounds, b: NodeBounds): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

// How far apart two boxes are along the axis that separates them; negative when they overlap.
function gapBetween(a: NodeBounds, b: NodeBounds): number {
  const gapX = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
  const gapY = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.max(gapX, gapY);
}

// Liang-Barsky: whether the segment from a to b enters the rect.
function segmentEntersRect(a: Point, b: Point, rect: NodeBounds): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let enter = 0;
  let leave = 1;
  const bounds: Array<[number, number]> = [
    [-dx, a.x - rect.x],
    [dx, rect.x + rect.width - a.x],
    [-dy, a.y - rect.y],
    [dy, rect.y + rect.height - a.y],
  ];
  for (const [p, q] of bounds) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > leave) return false;
      enter = Math.max(enter, t);
    } else {
      if (t < enter) return false;
      leave = Math.min(leave, t);
    }
  }
  return enter <= leave;
}

function turn(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

// Proper crossings only: segments that merely touch or run along each other do not count.
function segmentsCross(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  return turn(b1, b2, a1) * turn(b1, b2, a2) < 0 && turn(a1, a2, b1) * turn(a1, a2, b2) < 0;
}

function segmentsOf(path: Point[]): Array<[Point, Point]> {
  return path.slice(1).map((point, index) => [path[index], point]);
}

function pathsCross(a: ReviewedEdge, b: ReviewedEdge): boolean {
  const other = segmentsOf(b.path);
  return segmentsOf(a.path).some(([a1, a2]) => other.some(([b1, b2]) => segmentsCross(a1, a2, b1, b2)));
}

function distanceToRect(point: Point, rect: NodeBounds): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

// Where an edge laid out by ELK draws: along its stored route, unless the route is stale or manual.
function routeOf(edge: FlowEdge, source: NodeBounds, target: NodeBounds): Point[] {
  const points = edge.data?.routingMode === 'manual' ? undefined : edge.data?.elkPoints;
  if (!points || points.length === 0) return [];
  const fresh =
    distanceToRect(points[0], source) <= STALE_ROUTE_DISTANCE &&
    distanceToRect(points[points.length - 1], target) <= STALE_ROUTE_DISTANCE;
  return fresh ? points : [];
}

function px(value: number): string {
  return `${Math.round(value)} px`;
}

/**
 * Finds what makes a diagram look broken or careless: overlapping or cramped nodes, edges through
 * other nodes or against the page's flow, connected nodes slightly out of line, parked nodes and edge
 * crossings. Edges are taken as straight lines between node centres, which is close to how they draw.
 */
export function reviewLayout(
  graph: { nodes: readonly FlowNode[]; edges: readonly FlowEdge[] },
  { focusIds, maxIssues = DEFAULT_MAX_ISSUES }: LayoutReviewOptions = {}
): LayoutReview {
  const all = new Map(graph.nodes.map((node) => [node.id, node]));
  const boxes = nodeRects(all);
  const visible = graph.nodes.filter((node) => !node.hidden);
  if (visible.length === 0) return { issues: [], issueCount: 0 };
  const drawn = new Map(visible.map((node) => [node.id, visualRect(node, boxes.get(node.id))]));
  const isSection = (id: string) => all.get(id)?.type === 'section';
  const edges = graph.edges.filter(
    (edge) => !edge.hidden && edge.source !== edge.target && drawn.has(edge.source) && drawn.has(edge.target)
  );
  const flow = flowDirection(all, edges, boxes);
  const involves = (...ids: string[]) => !focusIds || ids.some((id) => focusIds.has(id));

  const ancestors = new Map<string, Set<string>>();
  const ancestorsOf = (id: string): Set<string> => {
    const known = ancestors.get(id);
    if (known) return known;
    const found = new Set<string>();
    for (let parent = all.get(getNodeParentId(all.get(id))); parent && !found.has(parent.id); ) {
      found.add(parent.id);
      parent = all.get(getNodeParentId(parent));
    }
    ancestors.set(id, found);
    return found;
  };
  const nested = (a: string, b: string) => ancestorsOf(a).has(b) || ancestorsOf(b).has(a);
  // The longest label on the edges between each connected pair, keyed both ways round.
  const links = new Map<string, string>();
  for (const edge of edges) {
    const label = getEditableEdgeLabel(edge).trim();
    for (const key of [`${edge.source} ${edge.target}`, `${edge.target} ${edge.source}`]) {
      const known = links.get(key);
      if (known === undefined || label.length > known.length) links.set(key, label);
    }
  }
  // The room a connection needs between its nodes, along the axis that separates them.
  const neededGap = (label: string, horizontal: boolean) =>
    Math.max(MIN_CONNECTED_GAP, labelRoom(label, horizontal));
  const widestGap = Math.max(MIN_CONNECTED_GAP, ...[...links.values()].map((label) => neededGap(label, true)));
  const neighbours = new Map<string, Set<string>>();
  for (const edge of edges) {
    neighbours.set(edge.source, (neighbours.get(edge.source) ?? new Set()).add(edge.target));
    neighbours.set(edge.target, (neighbours.get(edge.target) ?? new Set()).add(edge.source));
  }
  // Whether an edge from the node runs into the section to reach something inside it.
  const crossesInto = (id: string, sectionId: string) =>
    [...(neighbours.get(id) ?? [])].some((other) => ancestorsOf(other).has(sectionId));

  const overlaps: string[] = [];
  const crowded: string[] = [];
  // Sweep along x, so only boxes near each other are compared.
  const sorted = [...drawn].sort((left, right) => left[1].x - right[1].x);
  for (let i = 0; i < sorted.length; i += 1) {
    const [aId, a] = sorted[i];
    for (let j = i + 1; j < sorted.length; j += 1) {
      const [bId, b] = sorted[j];
      if (b.x > a.x + a.width + widestGap) break;
      if (!involves(aId, bId) || nested(aId, bId)) continue;
      const gap = gapBetween(a, b);
      const label = links.get(`${aId} ${bId}`);
      const linked = label !== undefined;
      const sideways = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width)) === gap;
      const section = [aId, bId].find(isSection);
      const other = section === aId ? bId : aId;
      const crossed = Boolean(section) && !linked && !isSection(other) && crossesInto(other, section);
      const needed = linked ? neededGap(label, sideways) : crossed ? MIN_CONNECTED_GAP : MIN_GAP;
      if (gap < 0) {
        const size = overlapSize(a, b);
        overlaps.push(
          isSection(aId) && isSection(bId)
            ? `Sections "${aId}" and "${bId}" overlap.`
            : section
              ? `"${other}" overlaps section "${section}" but is not in it; move it clear, or into the section with update_node parentId.`
              : `"${aId}" and "${bId}" overlap by ${px(size.width)} x ${px(size.height)}.`
        );
      } else if (gap < needed) {
        crowded.push(
          crossed
            ? `"${other}" is only ${px(gap)} from section "${section}", which its edge crosses; leave at least ${px(SUGGESTED_CONNECTED_GAP)}.`
            : !linked
            ? `"${aId}" and "${bId}" are only ${px(gap)} apart.`
            : label
              ? `"${aId}" and "${bId}" are connected but only ${px(gap)} apart; leave at least ${px(needed)} so the edge and its label "${label}" show.`
              : `"${aId}" and "${bId}" are connected but only ${px(gap)} apart; leave at least ${px(SUGGESTED_CONNECTED_GAP)} so the edge shows.`
        );
      }
    }
  }

  // Edges to and from sections attach to a border, and sequence messages and mindmap branches are drawn
  // by their own layouts, so only ordinary edges between nodes count.
  const lines: ReviewedEdge[] = edges
    .filter(
      (edge) =>
        !isSection(edge.source) &&
        !isSection(edge.target) &&
        edge.type !== 'sequence_message' &&
        !(all.get(edge.source)?.type === 'mindmap' && all.get(edge.target)?.type === 'mindmap')
    )
    .map((edge) => {
      const source = boxes.get(edge.source);
      const target = boxes.get(edge.target);
      const from = centerOf(source);
      const to = centerOf(target);
      return { edge, from, to, path: [from, ...routeOf(edge, source, target), to] };
    });
  const leaves = [...drawn].filter(([id]) => !isSection(id));
  const edgeChecks = Boolean(focusIds) || lines.length * Math.max(leaves.length, lines.length) <= MAX_EDGE_CHECK_PAIRS;

  const blocked: string[] = [];
  const far: string[] = [];
  const againstFlow: string[] = [];
  const misaligned: string[] = [];
  for (const { edge, from, to, path } of lines) {
    const source = boxes.get(edge.source);
    const target = boxes.get(edge.target);
    const name = `Edge "${edge.id}" (${edge.source} -> ${edge.target})`;
    if (edgeChecks) {
      for (const [id, rect] of leaves) {
        if (id === edge.source || id === edge.target || !involves(edge.source, edge.target, id)) continue;
        const inner = {
          x: rect.x + EDGE_CLEARANCE,
          y: rect.y + EDGE_CLEARANCE,
          width: rect.width - EDGE_CLEARANCE * 2,
          height: rect.height - EDGE_CLEARANCE * 2,
        };
        const hit = segmentsOf(path).some(([start, end]) => segmentEntersRect(start, end, inner));
        if (inner.width > 0 && inner.height > 0 && hit) {
          blocked.push(`${name} runs through "${id}".`);
        }
      }
    }
    if (!involves(edge.source, edge.target)) continue;

    const gap = gapBetween(source, target);
    if (focusIds && gap > FAR_GAP) {
      far.push(`"${edge.source}" and "${edge.target}" are connected but ${px(gap)} apart.`);
    }
    const direction = edgeDirection(source, target);
    if (flow && direction === OPPOSITE[flow]) {
      againstFlow.push(`${name} runs ${FLOW_NAMES[direction]}, against the page's ${FLOW_NAMES[flow]} flow.`);
    }
    // Along its own axis: an edge that mostly runs sideways lines up by its side handles, otherwise by the
    // centres of the top and bottom sides.
    const horizontal = direction ? isHorizontal(direction) : true;
    const offset = horizontal
      ? sideHandleY(all.get(edge.target), target) - sideHandleY(all.get(edge.source), source)
      : to.x - from.x;
    if (Math.abs(offset) > MIN_MISALIGNMENT && Math.abs(offset) <= MAX_MISALIGNMENT) {
      // Suggest moving the node the call changed, or else the target.
      const movesSource = Boolean(focusIds?.has(edge.source) && !focusIds.has(edge.target));
      const [moved, rect, shift] = movesSource
        ? [edge.source, source, offset]
        : [edge.target, target, -offset];
      const axis = horizontal ? 'y' : 'x';
      const value = (horizontal ? rect.y : rect.x) + shift;
      misaligned.push(
        `"${edge.source}" and "${edge.target}" are ${px(Math.abs(offset))} out of line; for a straight edge, move "${moved}" to ${axis} = ${Math.round(value)} (or the other node to match).`
      );
    }
  }

  // A node that is one step of a chain whose other steps line up, but that sits off their row or column,
  // makes the edges bend around it: usually a node inserted where there was no room. The steps around it
  // set the direction, as the detour itself can leave the page without a clear flow.
  function findDetours(): string[] {
    const into = new Map<string, FlowEdge[]>();
    const outOf = new Map<string, FlowEdge[]>();
    for (const { edge } of lines) {
      into.set(edge.target, [...(into.get(edge.target) ?? []), edge]);
      outOf.set(edge.source, [...(outOf.get(edge.source) ?? []), edge]);
    }
    const labelOf = (edge: FlowEdge) => getEditableEdgeLabel(edge).trim();
    const found: string[] = [];
    for (const [id, incoming] of into) {
      const rect = boxes.get(id);
      for (const inEdge of incoming) {
        for (const outEdge of outOf.get(id) ?? []) {
          const before = inEdge.source;
          const after = outEdge.target;
          if (before === after || before === id || after === id || !involves(id, before, after)) continue;
          const a = boxes.get(before);
          const b = boxes.get(after);
          const direction = edgeDirection(a, b);
          if (!direction) continue;
          const sideways = isHorizontal(direction);
          const forward = direction === 'right' || direction === 'down';
          const start = (box: NodeBounds) => (sideways ? box.x : box.y);
          const length = (box: NodeBounds) => (sideways ? box.width : box.height);
          // Where edges attach across the flow: side handles when it runs sideways, the middle otherwise.
          const across = (nodeId: string, box: NodeBounds) =>
            sideways ? sideHandleY(all.get(nodeId), box) : box.x + box.width / 2;
          const room = forward ? start(b) - (start(a) + length(a)) : start(a) - (start(b) + length(b));
          if (room < 0 || Math.abs(across(after, b) - across(before, a)) > MAX_MISALIGNMENT) continue;
          if (Math.abs(across(id, rect) - across(before, a)) <= MAX_MISALIGNMENT) continue;

          const gapIn = Math.max(SUGGESTED_CONNECTED_GAP, labelRoom(labelOf(inEdge), sideways));
          const gapOut = Math.max(SUGGESTED_CONNECTED_GAP, labelRoom(labelOf(outEdge), sideways));
          const shift = Math.ceil(gapIn + length(rect) + gapOut - room);
          const along = forward ? start(a) + length(a) + gapIn : start(a) - gapIn - length(rect);
          // Halfway between the two steps' lines, so it lines up with both when they differ a little.
          const line = (across(before, a) + across(after, b)) / 2;
          const target = sideways
            ? { x: along, y: line - sideHandleOffset(all.get(id), rect.height) }
            : { x: line - rect.width / 2, y: along };
          const place = `move "${id}" to x = ${Math.round(target.x)}, y = ${Math.round(target.y)}`;
          const lineName = sideways ? 'row' : 'column';
          if (shift <= 0) {
            found.push(`"${id}" is a step between "${before}" and "${after}" but sits off their ${lineName}; ${place} to put it in line.`);
            continue;
          }
          // What comes after the step moves along with it, so the rest of the flow keeps its spacing.
          const downstream = new Set<string>([after]);
          for (const next of downstream) {
            for (const edge of outOf.get(next) ?? []) {
              const nextRect = boxes.get(edge.target);
              const ahead = forward ? start(nextRect) >= start(b) : start(nextRect) <= start(b);
              if (edge.target !== id && edge.target !== before && ahead) downstream.add(edge.target);
            }
          }
          const moved = [...downstream].map((nodeId) => `"${nodeId}"`);
          const listed = moved.length > MAX_LISTED_DOWNSTREAM
            ? `${moved.slice(0, MAX_LISTED_DOWNSTREAM).join(', ')} and ${moved.length - MAX_LISTED_DOWNSTREAM} more`
            : moved.join(', ');
          found.push(
            `"${id}" is a step between "${before}" and "${after}" but sits off their ${lineName}; to make room, move ${listed} ${shift} px ${direction}, then ${place}.`
          );
        }
      }
    }
    return found;
  }

  const detours = findDetours();

  const crossings: string[] = [];
  if (edgeChecks) {
    for (let i = 0; i < lines.length; i += 1) {
      const a = lines[i];
      for (let j = i + 1; j < lines.length; j += 1) {
        const b = lines[j];
        const shared = [a.edge.source, a.edge.target].some((id) => id === b.edge.source || id === b.edge.target);
        if (shared || !involves(a.edge.source, a.edge.target, b.edge.source, b.edge.target)) continue;
        if (pathsCross(a, b)) crossings.push(`"${a.edge.id}" x "${b.edge.id}"`);
      }
    }
  }
  const crossingIssue = crossings.length > 0
    ? [
        `${crossings.length} edge crossing${crossings.length === 1 ? '' : 's'}: ${crossings.slice(0, MAX_LISTED_CROSSINGS).join(', ')}${crossings.length > MAX_LISTED_CROSSINGS ? ', ...' : ''}.`,
      ]
    : [];

  const found = [
    ...overlaps,
    ...blocked,
    ...detours,
    ...crowded,
    ...far,
    ...againstFlow,
    ...misaligned,
    ...crossingIssue,
  ];
  return {
    ...(flow ? { flow } : {}),
    bounds: unionBounds([...drawn.values()]),
    issues: found.slice(0, maxIssues),
    issueCount: found.length,
    ...(edgeChecks ? {} : { note: 'The canvas is too large to check edges; only node spacing was checked.' }),
  };
}
