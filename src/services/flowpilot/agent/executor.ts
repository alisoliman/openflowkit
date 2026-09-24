import { z } from 'zod/v4';
import { getEditableEdgeLabel } from '@/components/properties/edge/edgeLabelModel';
import {
  buildTemplateInsertionResult,
  getLayoutHintsForDiagramType,
} from '@/hooks/flow-editor-actions/layoutHandlers';
import type { NodeBounds } from '@/hooks/node-operations/sectionBounds';
import { matchIcon } from '@/lib/iconMatcher';
import { getNodeParentId } from '@/lib/nodeParent';
import type { EdgeData, FlowEdge, FlowHistoryState, FlowNode } from '@/lib/types';
import { evaluateRules, parseRulesJson } from '@/services/architectureLint/ruleEngine';
import { loadWorkspaceRules } from '@/services/architectureLint/workspaceRules';
import { composeDiagramForDisplay } from '@/services/composeDiagramForDisplay';
import {
  AGENT_MAX_SELECTED_IDS,
  AGENT_MAX_TOOL_ERROR_CHARS,
} from '@/services/copilot/agentProtocol';
import {
  AGENT_TOOLS,
  type AgentToolArgs,
  type AgentToolName,
  type EditCanvasOp,
} from '@/services/copilot/agentTools';
import { getCanvasFingerprint } from '@/services/flowpilot/changeSummary';
import {
  getSmartRoutingOptionsFromViewSettings,
  type SmartRoutingOptions,
} from '@/services/smartEdgeRouting';
import { getFlowTemplates } from '@/services/templates';
import { useFlowStore } from '@/store';
import type { AgentTurnLock, FlowState } from '@/store/types';
import {
  NODE_DATA_FIELDS,
  applyCanvasEdits,
  straightenEdges,
  tidyNodes,
  type CanvasEditDestructiveInfo,
  type CanvasEditResult,
  type CanvasGraph,
} from './canvasOps';
import {
  flowDirection,
  isHorizontal,
  nodeRects,
  nodeSize,
  unionBounds,
  visualRect,
  type FlowDirection,
} from './canvasGeometry';
import { FLOW_NAMES, reviewLayout, type LayoutReview } from './layoutReview';
import { describeEdgeStyle, describeNodeColor, describeNodeStyle } from './canvasStyle';
import { canvasBackground, describeCanvasStyle } from './canvasTheme';

// Keeps get_canvas well inside the tool_result frame and the model's context.
const MAX_NODE_OUTPUT_CHARS = 40_000;
const MAX_EDGE_OUTPUT_CHARS = 20_000;
const MAX_VIOLATION_OUTPUT_CHARS = 20_000;
const MAX_LISTED_REMOVALS = 10;
// One pasted wall of text must not crowd every other node out of get_canvas.
const MAX_TEXT_OUTPUT_CHARS = 2_000;
// Same entry animation as commitGraph; CustomNode's nodeAnimateIn runs for 180ms.
const ENTRY_STAGGER_MS = 20;
const ENTRY_MAX_DELAY_MS = 400;
const ENTRY_ANIMATION_MS = 180;
// How long a call waits for the canvas to measure the nodes it placed, and how far a guessed size may be off.
const MEASURE_TIMEOUT_MS = 600;
const MEASURE_POLL_MS = 16;
const SIZE_TOLERANCE = 2;
// ELK's names for the ways a page can flow.
const ELK_DIRECTIONS: Record<FlowDirection, 'LR' | 'TB' | 'RL' | 'BT'> = {
  right: 'LR',
  down: 'TB',
  left: 'RL',
  up: 'BT',
};
// Style fields get_canvas reports through describeNodeStyle, in the words edit_canvas takes.
const NODE_STYLE_FIELDS: readonly string[] = [
  'color',
  'colorMode',
  'shape',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'fontStyle',
  'align',
  'variant',
];
// Room around what capture_canvas shows, in canvas px, and how far the view may zoom to show it.
const CAPTURE_PADDING = 40;
const VIEW_PADDING = 0.08;
const VIEW_MIN_ZOOM = 0.1;
const VIEW_MAX_ZOOM = 1.25;
const VIEW_DURATION_MS = 250;
// After the view moves, the canvas renders the nodes that came into view.
const VIEW_SETTLE_MS = 80;
const EDGE_DATA_FIELDS = [
  'classRelation',
  'erRelation',
  'seqMessageKind',
  'seqMessageOrder',
] as const satisfies readonly (keyof EdgeData)[];

export interface AgentToolImage {
  /** Base64 data without the data: prefix. */
  data: string;
  mimeType: 'image/jpeg' | 'image/png';
}

export type AgentToolResult =
  | { ok: true; result: Record<string, unknown>; images?: AgentToolImage[] }
  | { ok: false; error: string; resultType?: 'failure' | 'rejected' };

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** The user's view of the canvas, from React Flow. */
export interface AgentCanvasView {
  setViewport: (viewport: Viewport, options?: { duration?: number }) => unknown;
}

/** What "Undo Copilot's changes" restores: the history entry recorded before the turn's first edit. */
export interface AgentTurnUndo {
  pageId: string;
  snapshot: FlowHistoryState;
  /** The canvas when the turn ended; any later edit disables the undo. */
  fingerprint: string;
}

export interface AgentTurnExecutor {
  /** The page when the turn started, for the change note. */
  startGraph: CanvasGraph;
  execute: (name: AgentToolName, args: unknown) => Promise<AgentToolResult>;
  /** Call when the turn ends. Null when the turn changed nothing. */
  getUndo: () => AgentTurnUndo | null;
}

interface AgentTurnExecutorOptions {
  turn: AgentTurnLock;
  /** Asks the user before a batch removes many of their nodes or clears the page. */
  confirmRemoval: (removal: CanvasEditDestructiveInfo) => Promise<boolean>;
  /** Why the turn is ending early, such as Stop. Calls fail once it is set, so nothing more is committed. */
  endingReason: () => string | undefined;
  /** Moves the user's view; without it, capture_canvas draws only what is already on screen. */
  view?: () => AgentCanvasView | undefined;
}

// Images a handler returns next to its result; a symbol keeps them out of the JSON the model reads.
const TOOL_IMAGES = Symbol('toolImages');
type HandlerOutput = Record<string, unknown> & { [TOOL_IMAGES]?: AgentToolImage[] };

type ToolHandlers = {
  [N in AgentToolName]: (args: AgentToolArgs<N>) => HandlerOutput | Promise<HandlerOutput>;
};

function getActiveHistory(state: FlowState): FlowState['tabs'][number]['history'] | undefined {
  return state.tabs.find((tab) => tab.id === state.activeTabId)?.history;
}

// Like useAIGeneration's undo: only while the turn's snapshot is still the latest history entry and
// nothing else changed the page, so it never takes the user's own edits with it.
export function canUndoAgentTurn(state: FlowState, undo: AgentTurnUndo | null): boolean {
  return Boolean(
    undo &&
    !state.agentTurn &&
    state.activeTabId === undo.pageId &&
    getActiveHistory(state)?.past.at(-1) === undo.snapshot &&
    getCanvasFingerprint(state) === undo.fingerprint
  );
}

export function undoAgentTurn(undo: AgentTurnUndo | null): boolean {
  const state = useFlowStore.getState();
  if (!canUndoAgentTurn(state, undo)) return false;
  state.undoV2();
  return true;
}

// Stops before the item that would go over the budget, so the output is a prefix of the list.
function takeWithin<T>(
  items: readonly T[],
  describe: (item: T) => Record<string, unknown>,
  maxChars: number
): Record<string, unknown>[] {
  const taken: Record<string, unknown>[] = [];
  let used = 0;
  for (const item of items) {
    const entry = describe(item);
    used += JSON.stringify(entry).length + 1;
    if (used > maxChars) break;
    taken.push(entry);
  }
  return taken;
}

function clipText(text: string): string {
  return text.length > MAX_TEXT_OUTPUT_CHARS ? `${text.slice(0, MAX_TEXT_OUTPUT_CHARS)}…` : text;
}

function pickDefined(source: object, keys: readonly string[]): Record<string, unknown> | undefined {
  const picked = Object.fromEntries(
    keys
      .map((key) => [key, (source as Record<string, unknown>)[key]])
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([key, value]) => [key, typeof value === 'string' ? clipText(value) : value])
  );
  return Object.keys(picked).length > 0 ? picked : undefined;
}

function describeBounds(rect: NodeBounds): Record<string, unknown> {
  return {
    position: { x: Math.round(rect.x), y: Math.round(rect.y) },
    size: { width: Math.round(rect.width), height: Math.round(rect.height) },
  };
}

function describeNode(node: FlowNode, rect: NodeBounds, full: boolean): Record<string, unknown> {
  const parentId = getNodeParentId(node);
  const entry: Record<string, unknown> = {
    id: node.id,
    type: node.type,
    label: clipText(node.data.label ?? ''),
  };
  if (parentId) entry.parentId = parentId;
  if (!full) {
    const color = describeNodeColor(node.data);
    if (color) entry.color = color;
    if (node.data.colorMode === 'filled') entry.colorMode = 'filled';
    return { ...entry, ...describeBounds(rect) };
  }
  const allowed = NODE_DATA_FIELDS[node.type as keyof typeof NODE_DATA_FIELDS] ?? [];
  const style = describeNodeStyle(node, allowed);
  const data = pickDefined(node.data, allowed.filter((field) => !NODE_STYLE_FIELDS.includes(field)));
  return {
    ...entry,
    ...(Object.keys(style).length > 0 ? { style } : {}),
    ...(data ? { data } : {}),
    ...describeBounds(rect),
  };
}

function describeLayout(review: LayoutReview, overview: boolean): Record<string, unknown> {
  const more = review.issueCount - review.issues.length;
  return {
    ...(overview && review.flow ? { flow: FLOW_NAMES[review.flow] } : {}),
    ...(overview && review.bounds ? { bounds: describeBounds(review.bounds) } : {}),
    issues: review.issues,
    ...(more > 0 ? { moreIssues: more } : {}),
    ...(review.note ? { note: review.note } : {}),
  };
}

// Where the nodes a call placed or moved ended up, so the agent need not read the canvas again.
function describePlaced(graph: CanvasGraph, ids: readonly string[]): Record<string, unknown>[] {
  const rects = nodeRects(new Map(graph.nodes.map((node) => [node.id, node])));
  const placed = [...new Set(ids)].filter((id) => rects.has(id));
  return takeWithin(
    placed,
    (id) => ({ id, ...describeBounds(rects.get(id)) }),
    MAX_NODE_OUTPUT_CHARS
  );
}

// Resolves once the canvas has measured these nodes, or after a short wait: nodes out of view or on a canvas
// that is not showing are never measured. False when there is no canvas to wait for.
function waitForMeasurement(ids: readonly string[]): Promise<boolean> {
  if (ids.length === 0 || typeof document === 'undefined' || !document.querySelector('.react-flow__renderer')) {
    return Promise.resolve(false);
  }
  const deadline = Date.now() + MEASURE_TIMEOUT_MS;
  return new Promise((resolve) => {
    const check = () => {
      const { nodes } = useFlowStore.getState();
      const measured = ids.every((id) => {
        const node = nodes.find((candidate) => candidate.id === id);
        return !node || node.hidden || Boolean(node.measured?.width && node.measured.height);
      });
      if (measured || Date.now() >= deadline) resolve(true);
      else setTimeout(check, MEASURE_POLL_MS);
    };
    check();
  });
}

// Edges around nodes the agent places follow them the way they follow a drag.
function routingOptions(state: FlowState): SmartRoutingOptions | undefined {
  return state.viewSettings.smartRoutingEnabled
    ? getSmartRoutingOptionsFromViewSettings(state.viewSettings)
    : undefined;
}

function describeEdge(edge: FlowEdge, full: boolean): Record<string, unknown> {
  const label = getEditableEdgeLabel(edge);
  const entry: Record<string, unknown> = { id: edge.id, source: edge.source, target: edge.target };
  if (label) entry.label = clipText(label);
  // Sequence messages draw in the diagram's own style.
  const style = edge.type === 'sequence_message' ? {} : describeEdgeStyle(edge, full);
  const data = full ? pickDefined(edge.data ?? {}, EDGE_DATA_FIELDS) : undefined;
  return {
    ...entry,
    ...(Object.keys(style).length > 0 ? { style } : {}),
    ...(data ? { data } : {}),
  };
}

function readCanvas(
  state: FlowState,
  { detail = 'summary', nodeIds }: AgentToolArgs<'get_canvas'>
): Record<string, unknown> {
  const full = detail === 'full';
  const requested = nodeIds ? new Set(nodeIds) : undefined;
  const nodes = requested ? state.nodes.filter((node) => requested.has(node.id)) : state.nodes;
  const edges = requested
    ? state.edges.filter((edge) => requested.has(edge.source) && requested.has(edge.target))
    : state.edges;
  const rects = nodeRects(new Map(state.nodes.map((node) => [node.id, node])));
  const nodeEntries = takeWithin(
    nodes,
    (node) => describeNode(node, rects.get(node.id), full),
    MAX_NODE_OUTPUT_CHARS
  );
  const edgeEntries = takeWithin(edges, (edge) => describeEdge(edge, full), MAX_EDGE_OUTPUT_CHARS);
  const notFound = nodeIds?.filter((id) => !nodes.some((node) => node.id === id)) ?? [];
  const truncated = nodeEntries.length < nodes.length || edgeEntries.length < edges.length;
  // The whole selection, even when the lists are truncated or limited to nodeIds.
  const selectedIds = [...state.nodes, ...state.edges]
    .filter((item) => item.selected)
    .map((item) => item.id)
    .slice(0, AGENT_MAX_SELECTED_IDS);

  return {
    page: state.tabs.find((tab) => tab.id === state.activeTabId)?.name ?? '',
    nodeCount: state.nodes.length,
    edgeCount: state.edges.length,
    nodes: nodeEntries,
    edges: edgeEntries,
    ...(selectedIds.length > 0 ? { selectedIds } : {}),
    ...(notFound.length > 0 ? { notFound } : {}),
    layout: describeLayout(reviewLayout(state, { focusIds: requested }), true),
    style: describeCanvasStyle(state),
    ...(truncated
      ? {
          note: `Truncated: showing ${nodeEntries.length} of ${nodes.length} nodes and ${edgeEntries.length} of ${edges.length} edges. Pass nodeIds to read the others.`,
        }
      : {}),
  };
}

function describeRemoval({ removedNodes }: CanvasEditDestructiveInfo): string {
  const labels = removedNodes
    .slice(0, MAX_LISTED_REMOVALS)
    .map((node) => `"${node.label || node.id}"`);
  const more = removedNodes.length - labels.length;
  return more > 0 ? `${labels.join(', ')} and ${more} more` : labels.join(', ');
}

function withoutEntryAnimation(node: FlowNode): FlowNode {
  const { freshlyAdded: _fresh, animateDelay: _delay, ...data } = node.data;
  return { ...node, data };
}

// Only the nodes a commit adds animate; flags left from earlier commits go, so none stick around.
function withEntryAnimation(nodes: FlowNode[], freshIds: ReadonlySet<string>): FlowNode[] {
  let index = 0;
  return nodes.map((node) => {
    if (!freshIds.has(node.id)) return node.data.freshlyAdded ? withoutEntryAnimation(node) : node;
    const animateDelay = Math.min(index++ * ENTRY_STAGGER_MS, ENTRY_MAX_DELAY_MS);
    return { ...node, data: { ...node.data, freshlyAdded: true, animateDelay } };
  });
}

function clearEntryAnimation(nodeIds: ReadonlySet<string>): void {
  const { nodes, setNodes } = useFlowStore.getState();
  if (!nodes.some((node) => nodeIds.has(node.id) && node.data.freshlyAdded)) return;
  setNodes((current) =>
    current.map((node) =>
      nodeIds.has(node.id) && node.data.freshlyAdded ? withoutEntryAnimation(node) : node
    )
  );
}

// The view that fits a region into the canvas, centred, within zoom limits the user can still read.
function viewportFor(region: NodeBounds, container: { width: number; height: number }): Viewport {
  const fit = Math.min(
    container.width / (region.width * (1 + VIEW_PADDING * 2)),
    container.height / (region.height * (1 + VIEW_PADDING * 2))
  );
  const zoom = Math.max(VIEW_MIN_ZOOM, Math.min(VIEW_MAX_ZOOM, fit));
  return {
    x: container.width / 2 - (region.x + region.width / 2) * zoom,
    y: container.height / 2 - (region.y + region.height / 2) * zoom,
    zoom,
  };
}

// Background tabs run no animation frames, so this never waits for more than a moment.
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 50);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      });
    }
  });
}

// Whether the user sees the node: not hidden, on a visible layer and not in a hidden section.
function isShown(state: FlowState, byId: ReadonlyMap<string, FlowNode>, node: FlowNode): boolean {
  if (node.hidden || node.data.sectionHidden) return false;
  if (state.layers.find((layer) => layer.id === node.data.layerId)?.visible === false) return false;
  const parent = byId.get(getNodeParentId(node));
  return !parent || isShown(state, byId, parent);
}

// The area around the given nodes, or everything shown on the page, titles of sections included.
function regionOf(state: FlowState, nodeIds: readonly string[] | undefined): { region?: NodeBounds; notFound: string[] } {
  const byId = new Map(state.nodes.map((node) => [node.id, node]));
  const rects = nodeRects(byId);
  const ids = nodeIds ?? state.nodes.filter((node) => isShown(state, byId, node)).map((node) => node.id);
  const notFound = ids.filter((id) => !rects.has(id));
  const boxes = ids.filter((id) => rects.has(id)).map((id) => visualRect(byId.get(id), rects.get(id)));
  if (boxes.length === 0) return { notFound };
  const bounds = unionBounds(boxes);
  return {
    region: {
      x: bounds.x - CAPTURE_PADDING,
      y: bounds.y - CAPTURE_PADDING,
      width: bounds.width + CAPTURE_PADDING * 2,
      height: bounds.height + CAPTURE_PADDING * 2,
    },
    notFound,
  };
}

function selectOnly(nodeIds: ReadonlySet<string>): void {
  const { setNodes, setEdges } = useFlowStore.getState();
  setNodes((nodes) => nodes.map((node) => (Boolean(node.selected) === nodeIds.has(node.id) ? node : { ...node, selected: nodeIds.has(node.id) })));
  setEdges((edges) => edges.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)));
}

/**
 * Runs the agent's tool calls against the live store for one turn. The turn's lock must be held:
 * calls fail once it is released, the page changes or the turn is ending. The first edit records one
 * history entry, so the whole turn undoes in one step.
 */
export function createAgentTurnExecutor({
  turn,
  confirmRemoval,
  endingReason,
  view,
}: AgentTurnExecutorOptions): AgentTurnExecutor {
  const initial = useFlowStore.getState();
  const startGraph = { nodes: initial.nodes, edges: initial.edges };
  const startNodeIds = new Set(startGraph.nodes.map((node) => node.id));
  const addedNodeIds: string[] = [];
  let removedStartNodeIds: string[] = [];
  let undoSnapshot: FlowHistoryState | undefined;

  const requireTurn = (): FlowState => {
    const state = useFlowStore.getState();
    if (state.agentTurn?.turnId !== turn.turnId || state.activeTabId !== turn.pageId) {
      throw new Error('The Flowpilot turn is no longer active on this page.');
    }
    // A call still running when the turn ends, such as a whole-page layout, must not land afterwards.
    const ending = endingReason();
    if (ending) throw new Error(ending);
    return state;
  };

  // Waiting for the user or for ELK gives the canvas time to change; a stale result is dropped.
  // The fingerprint ignores the entry animation flags, which a timer clears in the meantime.
  const commit = (before: CanvasGraph, after: CanvasGraph, newNodeIds: readonly string[] = []) => {
    const state = requireTurn();
    const moved = state.nodes !== before.nodes || state.edges !== before.edges;
    if (moved && getCanvasFingerprint(state) !== getCanvasFingerprint(before)) {
      throw new Error('The canvas changed while this call ran. Read it again and retry.');
    }
    if (!undoSnapshot) {
      state.recordHistoryV2();
      undoSnapshot = getActiveHistory(useFlowStore.getState())?.past.at(-1);
    }

    const freshIds = new Set(newNodeIds);
    state.setGraph(withEntryAnimation(after.nodes, freshIds), after.edges);
    addedNodeIds.push(...newNodeIds);
    if (freshIds.size > 0) {
      setTimeout(() => clearEntryAnimation(freshIds), ENTRY_MAX_DELAY_MS + ENTRY_ANIMATION_MS);
    }
  };

  // Placement guesses the size of nodes the canvas has not drawn yet. Once they are drawn, nodes placed on a
  // wrong guess are placed again at their real size, so rows line up and gaps come out as intended.
  // Waits for every node the call added, so the result reports real sizes. Nodes it placed are placed again
  // and moves next to other nodes are worked out again; moves to a position stand.
  const settle = async (outcome: CanvasEditResult, ops: readonly EditCanvasOp[]) => {
    if (!(await waitForMeasurement(outcome.addedNodeIds))) return;
    try {
      const state = requireTurn();
      const guessed = new Map(outcome.nodes.map((node) => [node.id, node]));
      const misjudged = outcome.addedNodeIds.some((id) => {
        const measured = state.nodes.find((node) => node.id === id)?.measured;
        const guess = guessed.get(id);
        if (!measured?.width || !measured.height || !guess) return false;
        const size = nodeSize({ ...guess, measured: undefined });
        return (
          Math.abs(size.width - measured.width) > SIZE_TOLERANCE ||
          Math.abs(size.height - measured.height) > SIZE_TOLERANCE
        );
      });
      if (!misjudged) return;
      const before = { nodes: state.nodes, edges: state.edges };
      const routing = routingOptions(state);
      const ownSectionIds = new Set(addedNodeIds);
      let after: CanvasGraph = outcome.placedNodeIds.length > 0
        ? tidyNodes(before, outcome.placedNodeIds, { flow: outcome.placementFlow, routing, ownSectionIds })
        : before;
      const real = (ref: string) => outcome.idMap[ref] ?? ref;
      // Moves next to a node, aligning and spacing out depend on sizes, so the call's moves run again in order.
      const moves = ops.flatMap((op): EditCanvasOp[] => {
        if (op.op === 'move_node') {
          return [{ ...op, id: real(op.id), ...(op.nextTo ? { nextTo: { ...op.nextTo, id: real(op.nextTo.id) } } : {}) }];
        }
        if (op.op === 'align' || op.op === 'distribute') return [{ ...op, nodeIds: op.nodeIds.map(real) }];
        return [];
      });
      if (moves.length > 0) {
        const moved = applyCanvasEdits(after, moves, { routing, ownSectionIds });
        if (moved.ok === true) after = moved;
      }
      commit(before, after);
    } catch {
      // The turn is ending or the page moved on; the first placement stands.
    }
  };

  // Brings a region into the user's view, so the canvas renders what is in it. Says whether it all fits
  // in view; undefined without a canvas.
  const showRegion = async (region: NodeBounds): Promise<{ fits: boolean } | undefined> => {
    const canvasView = view?.();
    const container = typeof document === 'undefined' ? null : document.querySelector('.react-flow');
    const box = container?.getBoundingClientRect();
    if (!canvasView || !box || box.width === 0 || box.height === 0) return undefined;
    const viewport = viewportFor(region, box);
    // The transition's promise never settles if the user pans during it, so this waits for it instead.
    void canvasView.setViewport(viewport, { duration: VIEW_DURATION_MS });
    await new Promise((resolve) => setTimeout(resolve, VIEW_DURATION_MS + VIEW_SETTLE_MS));
    await nextFrame();
    await nextFrame();
    return { fits: region.width * viewport.zoom <= box.width && region.height * viewport.zoom <= box.height };
  };

  const handlers: ToolHandlers = {
    get_canvas: (args) => readCanvas(requireTurn(), args),

    edit_canvas: async ({ ops }) => {
      const state = requireTurn();
      const before = { nodes: state.nodes, edges: state.edges };
      const outcome = applyCanvasEdits(before, ops, {
        startNodeIds,
        removedStartNodeIds,
        layerId: state.activeLayerId,
        routing: routingOptions(state),
        ownSectionIds: new Set(addedNodeIds),
        edgeDefaults: state.globalEdgeOptions,
      });
      if (outcome.ok === false) throw new Error(outcome.error);
      // A plain failure, not a rejected result, so the agent carries on without the removal.
      if (outcome.destructive.needsConfirmation && !(await confirmRemoval(outcome.destructive))) {
        throw new Error(
          `User declined removing ${describeRemoval(outcome.destructive)}. Nothing was changed.`
        );
      }
      commit(before, outcome, outcome.addedNodeIds);
      removedStartNodeIds = outcome.destructive.removedStartNodeIds;
      // Moves put nodes where the agent said, so only the nodes placed automatically are placed again.
      await settle(outcome, ops);
      const after = useFlowStore.getState();
      const changedIds = [...outcome.addedNodeIds, ...outcome.movedNodeIds, ...outcome.resizedNodeIds];
      // New edges between nodes already there count too, as they can cross or run through others.
      const focusIds = new Set([
        ...changedIds,
        ...outcome.edges
          .filter((edge) => outcome.addedEdgeIds.includes(edge.id))
          .flatMap((edge) => [edge.source, edge.target]),
      ]);
      return {
        summary: outcome.summary,
        idMap: outcome.idMap,
        ...(changedIds.length > 0 ? { placed: describePlaced(after, changedIds) } : {}),
        layout: describeLayout(reviewLayout(after, { focusIds }), false),
      };
    },

    capture_canvas: async ({ nodeIds }) => {
      const { region, notFound } = regionOf(requireTurn(), nodeIds);
      if (!region) {
        if (notFound.length > 0) throw new Error(`Nodes ${notFound.map((id) => `"${id}"`).join(', ')} do not exist; call get_canvas for the current ids.`);
        return { note: 'The canvas is empty, so there is nothing to look at.' };
      }
      const shown = await showRegion(region);
      const { captureCanvasRegion } = await import('./canvasCapture');
      const capture = await captureCanvasRegion(region, canvasBackground());
      requireTurn();
      if (!capture) {
        return { note: 'The canvas is not showing, so no picture could be taken. Rely on get_canvas.' };
      }
      const result: HandlerOutput = {
        area: describeBounds(region),
        image: {
          width: capture.width,
          height: capture.height,
          note: `Image px = (canvas px - area.position) x ${Math.round(capture.scale * 1000) / 1000}.`,
        },
        ...(notFound.length > 0 ? { notFound } : {}),
        ...(!shown?.fits
          ? {
              note: shown
                ? 'The area is too large to show at once, so nodes outside the view may be missing; capture fewer nodes.'
                : 'Only what was already on screen could be drawn; nodes outside the view may be missing.',
            }
          : {}),
      };
      result[TOOL_IMAGES] = [{ data: capture.data, mimeType: capture.mimeType }];
      return result;
    },

    focus_canvas: async ({ nodeIds, select }) => {
      const state = requireTurn();
      const { region, notFound } = regionOf(state, nodeIds);
      if (!region && notFound.length > 0) {
        throw new Error(`Nodes ${notFound.map((id) => `"${id}"`).join(', ')} do not exist; call get_canvas for the current ids.`);
      }
      const shown = region ? await showRegion(region) : undefined;
      requireTurn();
      const found = (nodeIds ?? []).filter((id) => !notFound.includes(id));
      if (select !== undefined) selectOnly(new Set(select ? found : []));
      return {
        summary: [
          shown ? `Showing ${nodeIds ? `${found.length} node(s)` : 'the whole page'}.` : 'The view could not be moved.',
          select === true ? `Selected ${found.length} node(s).` : select === false ? 'Cleared the selection.' : '',
        ].filter(Boolean).join(' '),
        ...(notFound.length > 0 ? { notFound } : {}),
      };
    },

    find_icons: ({ query, provider, limit }) => {
      requireTurn();
      const icons = matchIcon(query, provider, limit).map(
        ({ packId, shapeId, label, provider: iconProvider, category }) => ({
          packId,
          shapeId,
          label,
          provider: iconProvider,
          category,
        })
      );
      return icons.length > 0
        ? { icons }
        : { icons, note: 'No icons matched. Try a shorter or more common name, or a Lucide icon.' };
    },

    layout: async ({ scope, direction }) => {
      const state = requireTurn();
      const before = { nodes: state.nodes, edges: state.edges };
      if (scope === 'new') {
        const ids = addedNodeIds.filter((id) => state.nodes.some((node) => node.id === id));
        if (ids.length === 0) {
          return { summary: 'No nodes were added in this turn, so nothing moved.' };
        }
        const after = tidyNodes(before, ids, {
          flow: direction,
          routing: routingOptions(state),
          ownSectionIds: new Set(addedNodeIds),
        });
        commit(before, after);
        return {
          summary: `Tidied ${ids.length} node${ids.length === 1 ? '' : 's'} added in this turn.`,
          layout: describeLayout(reviewLayout(after, { focusIds: new Set(ids) }), false),
        };
      }

      // The layout cache keys on ids and edges only, so it would hand back nodes from before edits.
      const { clearLayoutCache } = await import('@/services/elkLayout');
      clearLayoutCache();
      const diagramType = state.tabs.find((tab) => tab.id === state.activeTabId)?.diagramType;
      const hints = getLayoutHintsForDiagramType(diagramType);
      const byId = new Map(before.nodes.map((node) => [node.id, node]));
      // A page that happens to run backwards is laid out forwards on the same axis.
      const current = flowDirection(byId, before.edges, nodeRects(byId));
      const pageFlow: FlowDirection | undefined = current
        ? isHorizontal(current) ? 'right' : 'down'
        : hints.direction === 'LR' ? 'right' : hints.direction === 'TB' ? 'down' : undefined;
      const flow = direction ?? pageFlow ?? 'down';
      // Layered like the toolbar's auto-layout: left to choose, ELK lays small, dense graphs out by force.
      const laidOut = await composeDiagramForDisplay(before.nodes, before.edges, {
        diagramType,
        algorithm: hints.algorithm ?? 'layered',
        direction: ELK_DIRECTIONS[flow],
      });
      const after = straightenEdges(laidOut, flow, routingOptions(requireTurn()));
      commit(before, after);
      return {
        summary: 'Re-laid out the whole page.',
        layout: describeLayout(reviewLayout(after), false),
      };
    },

    review_architecture: () => {
      const state = requireTurn();
      const sources = [
        { name: 'workspace', ...parseRulesJson(loadWorkspaceRules()) },
        { name: 'diagram', ...parseRulesJson(state.viewSettings.lintRules) },
      ];
      const rules = sources.flatMap((source) => source.rules);
      // Broken rules JSON must not read as a clean review.
      const notes = sources
        .filter((source) => source.error)
        .map((source) => `The ${source.name} lint rules could not be parsed and were skipped.`);
      if (rules.length === 0) {
        notes.push(
          notes.length > 0
            ? 'No other lint rules are set up.'
            : 'No lint rules are set up for this workspace or diagram.'
        );
        return { ruleCount: 0, violations: [], note: notes.join(' ') };
      }
      const violations = evaluateRules(state.nodes, state.edges, rules);
      const shown = takeWithin(
        violations,
        (violation) => ({ ...violation }),
        MAX_VIOLATION_OUTPUT_CHARS
      );
      if (shown.length < violations.length) {
        notes.push(`Truncated: showing ${shown.length} of ${violations.length} violations.`);
      }
      return {
        ruleCount: rules.length,
        violations: shown,
        ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
      };
    },

    list_templates: () => {
      requireTurn();
      return {
        templates: getFlowTemplates().map(({ id, name, description, category }) => ({
          id,
          name,
          description,
          category,
        })),
      };
    },

    use_template: ({ templateId }) => {
      const state = requireTurn();
      const template = getFlowTemplates().find((candidate) => candidate.id === templateId);
      if (!template) {
        throw new Error(`Unknown template "${templateId}". Use an id from list_templates.`);
      }
      if (state.nodes.length > 0) {
        throw new Error(
          'use_template only works on an empty canvas. Build with edit_canvas instead.'
        );
      }
      const before = { nodes: state.nodes, edges: state.edges };
      const { nextNodes, newEdges } = buildTemplateInsertionResult({ template, existingNodes: [] });
      commit(
        before,
        { nodes: nextNodes, edges: newEdges },
        nextNodes.map((node) => node.id)
      );
      return {
        summary: `Loaded the "${template.name}" template.`,
        canvas: readCanvas(useFlowStore.getState(), {}),
      };
    },
  };

  return {
    startGraph,

    execute: async (name, args) => {
      const tool = AGENT_TOOLS[name];
      if (!tool) return { ok: false, error: `Unknown tool "${name}".` };
      const parsed = tool.parameters.safeParse(args);
      if (!parsed.success) {
        const error = `Invalid arguments for ${name}:\n${z.prettifyError(parsed.error)}`;
        return { ok: false, error: error.slice(0, AGENT_MAX_TOOL_ERROR_CHARS) };
      }
      try {
        const handler = handlers[name] as (
          toolArgs: unknown
        ) => ReturnType<ToolHandlers[AgentToolName]>;
        const { [TOOL_IMAGES]: images, ...result } = await handler(parsed.data);
        return { ok: true, result, ...(images?.length ? { images } : {}) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          error: (message || 'The tool call failed.').slice(0, AGENT_MAX_TOOL_ERROR_CHARS),
        };
      }
    },

    getUndo: () =>
      undoSnapshot
        ? {
            pageId: turn.pageId,
            snapshot: undoSnapshot,
            fingerprint: getCanvasFingerprint(useFlowStore.getState()),
          }
        : null,
  };
}
