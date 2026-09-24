import { findIconName } from '@/components/IconMap';
import { resolveNodeSize } from '@/components/nodeHelpers';
import {
  buildEdgeLabelUpdates,
  getEditableEdgeLabel,
} from '@/components/properties/edge/edgeLabelModel';
import { createMindmapEdge } from '@/constants';
import { buildConnectedEdge } from '@/hooks/edge-operations/utils';
import {
  createAnnotationNode,
  createBrowserNode,
  createClassNode,
  createEntityNode,
  createGenericShapeNode,
  createJourneyNode,
  createMobileNode,
  createSectionNode,
  createSequenceParticipantNode,
  createTextNode,
} from '@/hooks/node-operations/nodeFactories';
import {
  SECTION_RENDER_MIN_HEIGHT,
  SECTION_RENDER_MIN_WIDTH,
  SECTION_TITLE_OFFSET,
  ensureParentsBeforeChildren,
  getSectionLayoutMetrics,
  isPointInsideBounds,
  type NodeBounds,
} from '@/hooks/node-operations/sectionBounds';
import { resolveMindmapBranchStyleForNode, syncMindmapEdges } from '@/lib/mindmapLayout';
import { applyMindmapVisibility } from '@/lib/mindmapTree';
import {
  createBuiltInIconData,
  createProviderIconData,
  isKnownProviderIcon,
} from '@/lib/nodeIconState';
import { clearNodeParent, getNodeParentId, setNodeParent } from '@/lib/nodeParent';
import type { EdgeData, FlowEdge, FlowNode, NodeData } from '@/lib/types';
import { AGENT_NODE_TYPES, type EditCanvasOp } from '@/services/copilot/agentTools';
import { isMermaidImportedContainerNode } from '@/services/mermaid/importProvenance';
import {
  buildSequenceMessageEdge,
  getNextSequenceMessageOrder,
  syncSequenceEdgeParticipantKinds,
} from '@/services/sequence/sequenceMessage';
import { NODE_DEFAULTS } from '@/theme';

type AgentNodeType = (typeof AGENT_NODE_TYPES)[number];
type CanvasOp<K extends EditCanvasOp['op']> = Extract<EditCanvasOp, { op: K }>;
type AgentNodeData = NonNullable<CanvasOp<'add_node'>['data']>;
type AgentEdgeData = NonNullable<CanvasOp<'add_edge'>['data']>;
type Point = { x: number; y: number };
type Size = { width: number; height: number };

// Removing this many nodes that were on the canvas when the turn started needs the user's confirmation.
export const DESTRUCTIVE_REMOVAL_THRESHOLD = 3;

const SHAPE_NODE_FIELDS: readonly (keyof AgentNodeData)[] = [
  'subLabel',
  'color',
  'colorMode',
  'shape',
  'icon',
  'archIconPackId',
  'archIconShapeId',
];
// The data each node component renders. Anything else is rejected so the agent learns what applies.
export const NODE_DATA_FIELDS: Record<AgentNodeType, readonly (keyof AgentNodeData)[]> = {
  start: SHAPE_NODE_FIELDS,
  process: SHAPE_NODE_FIELDS,
  decision: SHAPE_NODE_FIELDS,
  end: SHAPE_NODE_FIELDS,
  custom: SHAPE_NODE_FIELDS,
  annotation: ['subLabel', 'color'],
  text: ['color'],
  section: ['subLabel', 'color', 'colorMode', 'icon'],
  class: ['color', 'colorMode', 'classStereotype', 'classAttributes', 'classMethods'],
  er_entity: ['color', 'colorMode', 'erFields'],
  mindmap: ['color', 'colorMode'],
  journey: ['color', 'colorMode', 'journeySection', 'journeyActor', 'journeyScore'],
  sequence_participant: ['color', 'colorMode', 'seqParticipantKind'],
  browser: ['color'],
  mobile: ['color'],
};
// These types carry structure (children, branches, lifelines and messages) a type change would break.
const FIXED_NODE_TYPES: readonly string[] = ['section', 'mindmap', 'sequence_participant'];
// A type change resets these to the new type's look; other supported fields carry over.
const TYPE_STYLE_FIELDS = ['color', 'colorMode', 'shape'];
const ICON_STATE_FIELDS = [
  'customIconUrl',
  'iconAssetId',
  'assetProvider',
  'assetCategory',
  'assetPresentation',
];
// Placement, size and text settings that apply to every type, so a type change keeps them.
const KEPT_DATA_FIELDS = [
  'layerId',
  'pinned',
  'rotation',
  'width',
  'height',
  'align',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'fontStyle',
  'transparency',
];
const KEPT_NODE_FIELDS = ['width', 'height', 'zIndex', 'hidden'] as const;

const PLACEMENT_GAP = 60;
const PLACEMENT_CLEARANCE = 20;
const PLACEMENT_ACROSS_STEPS = [0, 1, -1, 2, -2, 3, -3, 4, -4];
const PLACEMENT_ALONG_STEPS = 4;

export interface CanvasGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface CanvasEditOptions {
  /** Node ids on the canvas when the turn started. Defaults to the nodes of the graph being edited. */
  startNodeIds?: ReadonlySet<string>;
  /** Start-of-turn nodes already removed by earlier batches in this turn. */
  removedStartNodeIds?: readonly string[];
  /** Layer that new nodes join. */
  layerId?: string;
}

export interface CanvasEditDestructiveInfo {
  /** Start-of-turn nodes this batch removes. */
  removedNodes: Array<{ id: string; label: string }>;
  /** Every start-of-turn node removed this turn, this batch included. */
  removedStartNodeIds: string[];
  /** The batch removes the last start-of-turn node or leaves the canvas empty. */
  clearsCanvas: boolean;
  needsConfirmation: boolean;
}

export interface CanvasEditResult extends CanvasGraph {
  ok: true;
  /** Agent-chosen ids that were taken, mapped to the ids actually used. */
  idMap: Record<string, string>;
  addedNodeIds: string[];
  addedEdgeIds: string[];
  summary: string;
  destructive: CanvasEditDestructiveInfo;
}

export type CanvasEditOutcome = CanvasEditResult | { ok: false; error: string };

interface EditState {
  original: Map<string, FlowNode>;
  nodes: Map<string, FlowNode>;
  edges: Map<string, FlowEdge>;
  layerId?: string;
  batchIds: Set<string>;
  nodeRefs: Map<string, string>;
  edgeRefs: Map<string, string>;
  idMap: Record<string, string>;
  addedNodeIds: Set<string>;
  addedEdgeIds: Set<string>;
  updatedNodeIds: Set<string>;
  updatedEdgeIds: Set<string>;
  removedNodes: FlowNode[];
  removedEdgeCount: number;
  /** Edges that went with a node removed earlier in the call. */
  cascadedEdgeIds: Set<string>;
  /** Targets of added and removed edges, so mindmap topics among them hang again. */
  rebranchIds: Set<string>;
}

class CanvasEditError extends Error {}

function fail(message: string): never {
  throw new CanvasEditError(message);
}

/**
 * Validates and applies one edit_canvas batch (ops already parsed with the tool schema) without
 * touching the input. The batch is atomic: the first invalid op fails the whole call. Existing nodes
 * keep their positions; new nodes are placed near the nodes they connect to.
 */
export function applyCanvasEdits(
  graph: CanvasGraph,
  ops: readonly EditCanvasOp[],
  options: CanvasEditOptions = {}
): CanvasEditOutcome {
  const state = createEditState(graph, options.layerId);
  for (const [index, op] of ops.entries()) {
    try {
      applyOp(state, op);
    } catch (error) {
      if (!(error instanceof CanvasEditError)) throw error;
      return { ok: false, error: `ops[${index}] (${op.op}): ${error.message}` };
    }
  }

  placeNodes(state);
  const rebranchedIds = assignMindmapBranches(state);
  const nodes = ensureParentsBeforeChildren([...state.nodes.values()]);
  const edges = finishEdges(state, nodes, rebranchedIds);
  return {
    ok: true,
    // Collapsed topics hide what hangs below them, as when the user inserts a topic.
    ...(rebranchedIds.size > 0 ? applyMindmapVisibility(nodes, edges) : { nodes, edges }),
    idMap: state.idMap,
    addedNodeIds: [...state.addedNodeIds],
    addedEdgeIds: [...state.addedEdgeIds],
    summary: summarize(state),
    destructive: describeRemovals(state, nodes, options),
  };
}

/**
 * Layout scope "new": places the given nodes again as if they were added in one batch, now that all
 * their connections are known. Nodes linked to already placed ones go first so each lands next to
 * its connections. Everything else stays put, and so do nodes with children and the fixed types,
 * whose structure decides where they go.
 */
export function tidyNodes(graph: CanvasGraph, nodeIds: readonly string[]): CanvasGraph {
  const state = createEditState(graph);
  const parentIds = new Set(graph.nodes.map((node) => getNodeParentId(node)));
  const pending = new Set(
    nodeIds.filter(
      (id) =>
        state.nodes.has(id) &&
        !FIXED_NODE_TYPES.includes(state.nodes.get(id).type) &&
        !parentIds.has(id)
    )
  );
  const neighbours = new Map<string, string[]>();
  for (const edge of graph.edges) {
    neighbours.set(edge.source, [...(neighbours.get(edge.source) ?? []), edge.target]);
    neighbours.set(edge.target, [...(neighbours.get(edge.target) ?? []), edge.source]);
  }
  while (pending.size > 0) {
    const ids = [...pending];
    const next =
      ids.find((id) => neighbours.get(id)?.some((otherId) => !pending.has(otherId))) ?? ids[0];
    pending.delete(next);
    state.addedNodeIds.add(next);
  }

  placeNodes(state);
  return { nodes: ensureParentsBeforeChildren([...state.nodes.values()]), edges: graph.edges };
}

function createEditState(graph: CanvasGraph, layerId?: string): EditState {
  return {
    original: new Map(graph.nodes.map((node) => [node.id, node])),
    nodes: new Map(graph.nodes.map((node) => [node.id, node])),
    edges: new Map(graph.edges.map((edge) => [edge.id, edge])),
    layerId,
    batchIds: new Set(),
    nodeRefs: new Map(),
    edgeRefs: new Map(),
    idMap: {},
    addedNodeIds: new Set(),
    addedEdgeIds: new Set(),
    updatedNodeIds: new Set(),
    updatedEdgeIds: new Set(),
    removedNodes: [],
    removedEdgeCount: 0,
    cascadedEdgeIds: new Set(),
    rebranchIds: new Set(),
  };
}

function applyOp(state: EditState, op: EditCanvasOp): void {
  switch (op.op) {
    case 'add_node':
      return addNode(state, op);
    case 'update_node':
      return updateNode(state, op);
    case 'remove_node':
      return removeNode(state, requireNode(state, op.id));
    case 'add_edge':
      return addEdge(state, op);
    case 'update_edge':
      return updateEdge(state, op);
    case 'remove_edge': {
      // Removing a node takes its edges along, so removing one of them afterwards is fine.
      const id = state.edgeRefs.get(op.id) ?? op.id;
      if (!state.edges.has(id) && state.cascadedEdgeIds.has(id)) return;
      return removeEdge(state, requireEdge(state, op.id));
    }
    case 'group':
      return groupNodes(state, op);
  }
}

function isAgentNodeType(type: string | undefined): type is AgentNodeType {
  return (AGENT_NODE_TYPES as readonly string[]).includes(type ?? '');
}

function uniqueId(base: string, isTaken: (id: string) => boolean): string {
  let id = base;
  for (let suffix = 2; isTaken(id); suffix += 1) {
    id = `${base}-${suffix}`;
  }
  return id;
}

// Ids the agent picks for new elements; later ops in the batch refer to the element by that id.
function claimId(
  state: EditState,
  refs: Map<string, string>,
  agentId: string,
  isTaken: (id: string) => boolean
): string {
  if (state.batchIds.has(agentId)) fail(`id "${agentId}" is already used earlier in this call`);
  state.batchIds.add(agentId);
  const id = uniqueId(agentId, isTaken);
  refs.set(agentId, id);
  if (id !== agentId) state.idMap[agentId] = id;
  return id;
}

function requireNode(state: EditState, ref: string): FlowNode {
  const node = state.nodes.get(state.nodeRefs.get(ref) ?? ref);
  if (!node) fail(`node "${ref}" does not exist; call get_canvas for the current ids`);
  return node;
}

function requireSection(state: EditState, ref: string): FlowNode {
  const node = requireNode(state, ref);
  if (node.type !== 'section') fail(`"${ref}" is a ${node.type ?? 'default'} node, not a section`);
  return node;
}

function requireEdge(state: EditState, ref: string): FlowEdge {
  const edge = state.edges.get(state.edgeRefs.get(ref) ?? ref);
  if (!edge) fail(`edge "${ref}" does not exist; call get_canvas for the current ids`);
  return edge;
}

// Map-based getNodeAncestorIds.
function ancestorIds(state: EditState, node: FlowNode): string[] {
  const ids: string[] = [];
  for (let parent = state.nodes.get(getNodeParentId(node)); parent; ) {
    ids.push(parent.id);
    parent = state.nodes.get(getNodeParentId(parent));
  }
  return ids;
}

function createAgentNode(
  state: EditState,
  type: AgentNodeType,
  id: string,
  label: string
): FlowNode {
  const node = createNodeOfType(type, id, label);
  return state.layerId ? { ...node, data: { ...node.data, layerId: state.layerId } } : node;
}

function createNodeOfType(type: AgentNodeType, id: string, label: string): FlowNode {
  const position = { x: 0, y: 0 };
  switch (type) {
    case 'annotation':
      return createAnnotationNode(id, position, { label, subLabel: '' });
    case 'text':
      return createTextNode(id, position, label);
    case 'section':
      return createSectionNode(id, position, label);
    case 'class':
      return createClassNode(id, position, label);
    case 'er_entity':
      return createEntityNode(id, position, label);
    case 'journey':
      return createJourneyNode(id, position, label);
    case 'sequence_participant':
      return createSequenceParticipantNode(id, position, label);
    case 'browser':
      return createBrowserNode(id, position, label);
    case 'mobile':
      return createMobileNode(id, position, label);
    case 'mindmap':
      // The data createMindmapTopicNode gives; depth, parent and side are filled in once it is placed.
      return {
        id,
        type,
        position,
        data: {
          label,
          color: 'slate',
          shape: 'rounded',
          mindmapDepth: 0,
          mindmapBranchStyle: 'curved',
        },
      };
    default: {
      const defaults = NODE_DEFAULTS[type];
      return createGenericShapeNode(id, position, {
        type,
        label,
        color: defaults.color,
        shape: defaults.shape as NodeData['shape'],
      });
    }
  }
}

function withNodeData(node: FlowNode, patch: AgentNodeData | undefined): FlowNode {
  if (!patch) return node;
  const type = node.type as AgentNodeType;
  const allowed: readonly string[] = NODE_DATA_FIELDS[type];
  const unsupported = Object.keys(patch).filter((key) => !allowed.includes(key));
  if (unsupported.length > 0) {
    fail(
      `${type} nodes do not support data.${unsupported.join(', data.')}; supported: ${allowed.join(', ')}`
    );
  }

  const { icon, archIconPackId, archIconShapeId, erFields, journeyActor, ...fields } = patch;
  const data: NodeData = { ...node.data, ...fields };
  if (icon !== undefined && (archIconPackId !== undefined || archIconShapeId !== undefined)) {
    fail('set either data.icon or a provider icon, not both');
  }
  if (icon !== undefined) {
    const iconName = findIconName(icon);
    if (!iconName) fail(`"${icon}" is not a known Lucide icon; use find_icons for provider icons`);
    Object.assign(data, createBuiltInIconData(iconName));
  }
  if (archIconPackId !== undefined || archIconShapeId !== undefined) {
    if (!archIconPackId || !archIconShapeId) {
      fail('set data.archIconPackId and data.archIconShapeId together');
    }
    if (!isKnownProviderIcon(archIconPackId, archIconShapeId)) {
      fail(
        `unknown provider icon ${archIconPackId}/${archIconShapeId}; use the ids find_icons returns`
      );
    }
    Object.assign(
      data,
      createProviderIconData({ packId: archIconPackId, shapeId: archIconShapeId })
    );
    if (type === 'custom') data.assetPresentation = 'icon';
  }
  if (erFields) {
    data.erFields = erFields.map((field) => ({
      isPrimaryKey: false,
      isForeignKey: false,
      ...field,
    }));
  }
  if (journeyActor !== undefined) {
    // Journey cards show the actor as their sub-label.
    data.journeyActor = journeyActor;
    data.subLabel = journeyActor;
  }
  return { ...node, data };
}

function withLabel(node: FlowNode, label: string): FlowNode {
  const journeyTask = node.type === 'journey' ? { journeyTask: label } : {};
  return { ...node, data: { ...node.data, label, ...journeyTask } };
}

function changeNodeType(node: FlowNode, type: AgentNodeType): FlowNode {
  const fixedType = [node.type, type].find((candidate) => FIXED_NODE_TYPES.includes(candidate));
  if (fixedType) {
    fail(`${fixedType} nodes cannot change type; remove the node and add a new one instead`);
  }
  const next = createNodeOfType(type, node.id, node.data.label);
  const fields: readonly string[] = NODE_DATA_FIELDS[type];
  const carried = Object.entries(node.data).filter(
    ([key]) =>
      KEPT_DATA_FIELDS.includes(key) ||
      (fields.includes(key) && !TYPE_STYLE_FIELDS.includes(key)) ||
      (fields.includes('icon') && ICON_STATE_FIELDS.includes(key))
  );
  const parentId = getNodeParentId(node);
  const retyped = {
    ...next,
    // Resizing sets the top-level size; the new type's default size stays in style.
    ...Object.fromEntries(
      KEPT_NODE_FIELDS.filter((key) => node[key] !== undefined).map((key) => [key, node[key]])
    ),
    position: node.position,
    data: { ...next.data, ...Object.fromEntries(carried) },
  };
  return parentId ? setNodeParent(retyped, parentId) : retyped;
}

function withParent(state: EditState, node: FlowNode, parentRef: string | null): FlowNode {
  if (parentRef === null) return clearNodeParent(node);
  const section = requireSection(state, parentRef);
  if (section.id === node.id || ancestorIds(state, section).includes(node.id)) {
    fail('a section cannot go inside itself or one of its own children');
  }
  return setNodeParent(node, section.id);
}

function addNode(state: EditState, op: CanvasOp<'add_node'>): void {
  const parent = op.parentId === undefined ? undefined : requireSection(state, op.parentId);
  const id = claimId(state, state.nodeRefs, op.id, (candidate) => state.nodes.has(candidate));
  const node = withNodeData(createAgentNode(state, op.type, id, op.label), op.data);
  state.nodes.set(id, parent ? setNodeParent(node, parent.id) : node);
  state.addedNodeIds.add(id);
}

function updateNode(state: EditState, op: CanvasOp<'update_node'>): void {
  const current = requireNode(state, op.id);
  if (!isAgentNodeType(current.type) && (op.type !== undefined || op.data !== undefined)) {
    fail(
      `${current.type ?? 'default'} nodes can only be renamed, moved between sections or removed`
    );
  }

  let node = op.type && op.type !== current.type ? changeNodeType(current, op.type) : current;
  if (op.label !== undefined) node = withLabel(node, op.label);
  node = withNodeData(node, op.data);
  if (op.parentId !== undefined) node = withParent(state, node, op.parentId);
  state.nodes.set(node.id, node);
  if (!state.addedNodeIds.has(node.id)) state.updatedNodeIds.add(node.id);
}

// Connected edges go too; children of a removed section move up to its parent and keep their place.
function removeNode(state: EditState, node: FlowNode): void {
  const parentId = getNodeParentId(node);
  state.nodes.delete(node.id);
  for (const child of state.nodes.values()) {
    if (getNodeParentId(child) === node.id) {
      state.nodes.set(child.id, parentId ? setNodeParent(child, parentId) : clearNodeParent(child));
    }
  }
  for (const edge of state.edges.values()) {
    if (edge.source === node.id || edge.target === node.id) {
      removeEdge(state, edge);
      state.cascadedEdgeIds.add(edge.id);
    }
  }

  if (state.addedNodeIds.delete(node.id)) return;
  state.updatedNodeIds.delete(node.id);
  state.removedNodes.push(state.original.get(node.id) ?? node);
}

function createAgentEdge(
  state: EditState,
  id: string,
  source: FlowNode,
  target: FlowNode
): FlowEdge {
  if (source.type === 'sequence_participant' && target.type === 'sequence_participant') {
    const connection = {
      source: source.id,
      target: target.id,
      sourceHandle: null,
      targetHandle: null,
    };
    return {
      ...buildSequenceMessageEdge(connection, source, target, [...state.edges.values()]),
      id,
    };
  }
  if (source.type === 'mindmap' && target.type === 'mindmap') {
    return createMindmapEdge(source, target, undefined, id);
  }
  return { ...buildConnectedEdge(source.id, target.id, null, null), id };
}

// Moves the sequence timeline (other messages, notes, fragments and activations) at `from` or later
// by `delta`. Notes, fragments and activations sit just before the message with their order.
function shiftTimeline(state: EditState, from: number, delta: number, messageId: string): void {
  const moves = (order: unknown): order is number => typeof order === 'number' && order >= from;
  for (const edge of state.edges.values()) {
    const order = edge.data?.seqMessageOrder;
    if (edge.id !== messageId && edge.type === 'sequence_message' && moves(order)) {
      state.edges.set(edge.id, { ...edge, data: { ...edge.data, seqMessageOrder: order + delta } });
    }
  }
  for (const node of state.nodes.values()) {
    const { seqMessageOrder, seqActivations } = node.data;
    const activationsMove = seqActivations?.some((activation) => moves(activation.order));
    if (!moves(seqMessageOrder) && !activationsMove) continue;
    const data = { ...node.data };
    if (moves(seqMessageOrder)) data.seqMessageOrder = seqMessageOrder + delta;
    if (activationsMove) {
      data.seqActivations = seqActivations.map((activation) =>
        moves(activation.order) ? { ...activation, order: activation.order + delta } : activation
      );
    }
    state.nodes.set(node.id, { ...node, data });
  }
}

// Messages form a list: moving one to an order takes it out of its slot and inserts it there,
// clamped to the end. Returns the order it ends up with.
function moveMessage(state: EditState, edge: FlowEdge, requested: number): number {
  const from = edge.data?.seqMessageOrder;
  if (requested === from) return from;
  // New messages start after the last one, so only existing ones leave a slot to close.
  if (state.edges.has(edge.id) && typeof from === 'number') {
    shiftTimeline(state, from + 1, -1, edge.id);
  }
  const others = [...state.edges.values()].filter((other) => other.id !== edge.id);
  const end = getNextSequenceMessageOrder(others);
  const order = Math.min(requested, end);
  if (order < end) shiftTimeline(state, order, 1, edge.id);
  return order;
}

function withEdgeData(
  state: EditState,
  edge: FlowEdge,
  patch: AgentEdgeData | undefined
): FlowEdge {
  if (!patch) return edge;
  const { seqMessageKind, seqMessageOrder, ...fields } = patch;
  const sourceType = state.nodes.get(edge.source)?.type;
  const targetType = state.nodes.get(edge.target)?.type;
  const isMessage = edge.type === 'sequence_message';
  if ((seqMessageKind !== undefined || seqMessageOrder !== undefined) && !isMessage) {
    fail(
      'seqMessageKind and seqMessageOrder only apply to edges between sequence_participant nodes'
    );
  }
  if (fields.classRelation !== undefined && (sourceType !== 'class' || targetType !== 'class')) {
    fail('classRelation only applies to edges between class nodes');
  }
  if (
    fields.erRelation !== undefined &&
    (sourceType !== 'er_entity' || targetType !== 'er_entity')
  ) {
    fail('erRelation only applies to edges between er_entity nodes');
  }

  const data: EdgeData = { ...edge.data, ...fields, ...(seqMessageKind ? { seqMessageKind } : {}) };
  if (seqMessageOrder !== undefined) {
    data.seqMessageOrder = moveMessage(state, edge, seqMessageOrder);
  }
  return { ...edge, data };
}

// Relation edges keep their text in the relation label, like the edge properties panel.
function withEdgeLabel(edge: FlowEdge, label: string | undefined): FlowEdge {
  return { ...edge, ...buildEdgeLabelUpdates(edge, label ?? getEditableEdgeLabel(edge)) };
}

function addEdge(state: EditState, op: CanvasOp<'add_edge'>): void {
  const source = requireNode(state, op.source);
  const target = requireNode(state, op.target);
  const isTaken = (candidate: string) => state.edges.has(candidate);
  const id = op.id
    ? claimId(state, state.edgeRefs, op.id, isTaken)
    : uniqueId(`e-${source.id}-${target.id}`, isTaken);
  const edge = withEdgeData(state, createAgentEdge(state, id, source, target), op.data);
  state.edges.set(id, withEdgeLabel(edge, op.label));
  state.addedEdgeIds.add(id);
  state.rebranchIds.add(target.id);
}

function updateEdge(state: EditState, op: CanvasOp<'update_edge'>): void {
  const edge = withEdgeLabel(withEdgeData(state, requireEdge(state, op.id), op.data), op.label);
  state.edges.set(edge.id, edge);
  if (!state.addedEdgeIds.has(edge.id)) state.updatedEdgeIds.add(edge.id);
}

function removeEdge(state: EditState, edge: FlowEdge): void {
  state.edges.delete(edge.id);
  state.rebranchIds.add(edge.target);
  if (state.addedEdgeIds.delete(edge.id)) return;
  state.updatedEdgeIds.delete(edge.id);
  state.removedEdgeCount += 1;
}

function groupNodes(state: EditState, op: CanvasOp<'group'>): void {
  const members = [
    ...new Map(
      op.nodeIds.map((ref) => requireNode(state, ref)).map((node) => [node.id, node])
    ).values(),
  ];
  const memberIds = new Set(members.map((member) => member.id));
  // Members inside another member stay where they are.
  const outerMembers = members.filter(
    (member) => !ancestorIds(state, member).some((ancestorId) => memberIds.has(ancestorId))
  );
  const parentIds = new Set(outerMembers.map((member) => getNodeParentId(member)));
  const [sharedParentId] = parentIds.size === 1 ? parentIds : [''];

  const id = claimId(state, state.nodeRefs, op.id, (candidate) => state.nodes.has(candidate));
  const section = createAgentNode(state, 'section', id, op.label);
  state.nodes.set(id, sharedParentId ? setNodeParent(section, sharedParentId) : section);
  state.addedNodeIds.add(id);
  for (const member of outerMembers) {
    state.nodes.set(member.id, setNodeParent(member, id));
    if (!state.addedNodeIds.has(member.id)) state.updatedNodeIds.add(member.id);
  }
}

function isDefaultSection(node: FlowNode): boolean {
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

function nodeSize(node: FlowNode): Size {
  const { width, height } = node.measured ?? {};
  const size = width && height ? { width, height } : unmeasuredSize(node);
  if (!isDefaultSection(node)) return size;
  return {
    width: Math.max(size.width, SECTION_RENDER_MIN_WIDTH),
    height: Math.max(size.height, SECTION_RENDER_MIN_HEIGHT),
  };
}

// What the node covers on screen: default sections draw their title above the border.
function visualRect(node: FlowNode, rect: NodeBounds): NodeBounds {
  return isDefaultSection(node)
    ? { ...rect, y: rect.y - SECTION_TITLE_OFFSET, height: rect.height + SECTION_TITLE_OFFSET }
    : rect;
}

// Map-based getAbsoluteNodePosition for every node at once.
function absolutePositions(nodes: Map<string, FlowNode>): Map<string, Point> {
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

function unionBounds(rects: NodeBounds[]): NodeBounds {
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function centerOf(rect: NodeBounds): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function overlaps(position: Point, size: Size, rect: NodeBounds): boolean {
  return (
    position.x < rect.x + rect.width + PLACEMENT_CLEARANCE &&
    position.x + size.width + PLACEMENT_CLEARANCE > rect.x &&
    position.y < rect.y + rect.height + PLACEMENT_CLEARANCE &&
    position.y + size.height + PLACEMENT_CLEARANCE > rect.y
  );
}

// Beside a single neighbour along the flow (before it when the new node is the edge source), or
// between two neighbours, like positionNewNodesSmartly but aware of node sizes.
function anchorPosition(
  state: EditState,
  id: string,
  size: Size,
  rects: Map<string, NodeBounds>,
  horizontal: boolean
): Point | undefined {
  const neighbours = new Map<string, { rect: NodeBounds; before: boolean }>();
  for (const edge of state.edges.values()) {
    const otherId = edge.source === id ? edge.target : edge.target === id ? edge.source : undefined;
    const rect = otherId === undefined || otherId === id ? undefined : rects.get(otherId);
    if (rect && !neighbours.has(otherId))
      neighbours.set(otherId, { rect, before: edge.source === id });
  }

  const [first, second] = neighbours.values();
  if (!first) return undefined;
  if (second) {
    const a = centerOf(first.rect);
    const b = centerOf(second.rect);
    return { x: (a.x + b.x - size.width) / 2, y: (a.y + b.y - size.height) / 2 };
  }
  return beside(first.rect, size, horizontal, first.before);
}

// Next to the rect along the flow, before or after it, centred across it.
function beside(rect: NodeBounds, size: Size, horizontal: boolean, before: boolean): Point {
  const center = centerOf(rect);
  return horizontal
    ? {
        x: before ? rect.x - PLACEMENT_GAP - size.width : rect.x + rect.width + PLACEMENT_GAP,
        y: center.y - size.height / 2,
      }
    : {
        x: center.x - size.width / 2,
        y: before ? rect.y - PLACEMENT_GAP - size.height : rect.y + rect.height + PLACEMENT_GAP,
      };
}

// The mindmap topic a topic hangs off: the first one linking to it, skipping the given topics.
function mindmapParentId(
  state: EditState,
  id: string,
  skippedIds: ReadonlySet<string>
): string | undefined {
  return [...state.edges.values()].find(
    (edge) =>
      edge.target === id &&
      !skippedIds.has(edge.source) &&
      state.nodes.get(edge.source)?.type === 'mindmap'
  )?.source;
}

// The placed topic a new mindmap topic hangs off and the side assignMindmapBranches will give it:
// right of a root, as when the user inserts a topic, and otherwise its parent's side.
function mindmapBranch(
  state: EditState,
  node: FlowNode,
  rects: Map<string, NodeBounds>
): { rect: NodeBounds; side: 'left' | 'right' } | undefined {
  if (node.type !== 'mindmap') return undefined;
  const parentId = mindmapParentId(state, node.id, new Set([node.id]));
  const rect = parentId === undefined ? undefined : rects.get(parentId);
  if (!rect) return undefined;
  const grandparentId = mindmapParentId(state, parentId, new Set([node.id, parentId]));
  if (grandparentId === undefined) return { rect, side: 'right' };
  if (!state.addedNodeIds.has(parentId)) {
    return { rect, side: state.nodes.get(parentId).data.mindmapSide ?? 'right' };
  }
  // A new parent has no side yet, so it takes the one it was placed on.
  const grandparentRect = rects.get(grandparentId);
  return { rect, side: grandparentRect && rect.x < grandparentRect.x ? 'left' : 'right' };
}

// Tries the candidate, then steps across the flow (fanning out siblings), then further along it,
// backwards for a flow that runs left. Past that, a node joins its section below or beside what the
// section holds.
function findFreePosition(
  candidate: Point,
  size: Size,
  obstacles: NodeBounds[],
  horizontal: boolean,
  isFree: (position: Point) => boolean,
  content?: NodeBounds,
  backward = false
): Point {
  const alongStep = ((horizontal ? size.width : size.height) + PLACEMENT_GAP) * (backward ? -1 : 1);
  const acrossStep = (horizontal ? size.height : size.width) + PLACEMENT_GAP;
  for (let along = 0; along < PLACEMENT_ALONG_STEPS; along += 1) {
    for (const across of PLACEMENT_ACROSS_STEPS) {
      const position = horizontal
        ? { x: candidate.x + along * alongStep, y: candidate.y + across * acrossStep }
        : { x: candidate.x + across * acrossStep, y: candidate.y + along * alongStep };
      if (isFree(position)) return position;
    }
  }
  if (content) {
    // A full section grows down below what it holds, or right beside it when that would cover what
    // lies below, not out past everything else on the canvas.
    const held = obstacles.filter((rect) => overlaps(content, content, rect));
    const below = {
      x: content.x,
      y: Math.max(content.y, ...held.map((rect) => rect.y + rect.height + PLACEMENT_GAP)),
    };
    const beside = {
      x: Math.max(content.x, ...held.map((rect) => rect.x + rect.width + PLACEMENT_GAP)),
      y: content.y,
    };
    return [below, beside].find(isFree) ?? below;
  }
  if (backward) {
    const left = Math.min(...obstacles.map((rect) => rect.x));
    return { x: left - PLACEMENT_GAP - size.width, y: candidate.y };
  }
  const right = Math.max(...obstacles.map((rect) => rect.x + rect.width));
  return { x: right + PLACEMENT_GAP, y: candidate.y };
}

function contentBounds(section: FlowNode, rect: NodeBounds): NodeBounds {
  const { contentPaddingTop, contentPaddingBottom, contentPaddingX } =
    getSectionLayoutMetrics(section);
  return {
    x: rect.x + contentPaddingX,
    y: rect.y + contentPaddingTop,
    width: Math.max(rect.width - contentPaddingX * 2, 1),
    height: Math.max(rect.height - contentPaddingTop - contentPaddingBottom, 1),
  };
}

// Where a node inside sections may go: the content area of its nearest existing section, less the
// padding and title of each new section in between, which is sized around the node afterwards.
function placementBounds(
  state: EditState,
  ancestors: string[],
  rects: Map<string, NodeBounds>
): NodeBounds | undefined {
  // New sections are sized around their contents afterwards, so only existing ones hold a node in.
  const containerIndex = ancestors.findIndex(
    (ancestorId) => rects.has(ancestorId) && !state.addedNodeIds.has(ancestorId)
  );
  if (containerIndex < 0) return undefined;
  const containerId = ancestors[containerIndex];
  // New sections are default sections, which draw their title above the border.
  return ancestors.slice(0, containerIndex).reduce(
    (bounds, sectionId) =>
      contentBounds(state.nodes.get(sectionId), {
        ...bounds,
        y: bounds.y + SECTION_TITLE_OFFSET,
        height: bounds.height - SECTION_TITLE_OFFSET,
      }),
    contentBounds(state.nodes.get(containerId), rects.get(containerId))
  );
}

function placeNode(
  state: EditState,
  node: FlowNode,
  rects: Map<string, NodeBounds>,
  horizontal: boolean,
  orphanOrigin: Point
): NodeBounds {
  const size = nodeSize(node);
  // Room is found for what the node draws, title strip included.
  const drawn = visualRect(node, { x: 0, y: 0, ...size });
  const ancestors = ancestorIds(state, node);
  const content = placementBounds(state, ancestors, rects);
  const others = [...rects].filter(([id]) => !ancestors.includes(id));
  const obstacles = others.map(([id, rect]) => visualRect(state.nodes.get(id), rect));

  if (node.type === 'sequence_participant' && !content) {
    // Participants line up in a row so their lifelines and messages stay aligned.
    const [lastParticipant] = [...rects]
      .filter(([id]) => state.nodes.get(id)?.type === 'sequence_participant')
      .map(([, rect]) => rect)
      .sort((left, right) => right.x - left.x);
    if (lastParticipant) {
      const y = lastParticipant.y;
      const blockerAt = (x: number) => obstacles.find((rect) => overlaps({ x, y }, size, rect));
      let x = lastParticipant.x + lastParticipant.width + PLACEMENT_GAP;
      for (let blocker = blockerAt(x); blocker; blocker = blockerAt(x)) {
        x = blocker.x + blocker.width + PLACEMENT_GAP;
      }
      return { x, y, ...size };
    }
  }

  // The section the node joins grows around it, so it must stay clear of what it does not hold. A new
  // section draws at least its render minimum, and once it holds a node takes later ones beside it.
  const [sectionId] = ancestors;
  const section = state.nodes.get(sectionId);
  const sectionRect = rects.get(sectionId);
  const outside = others
    .filter(([id]) => !ancestorIds(state, state.nodes.get(id)).includes(sectionId))
    .map(([id, rect]) => visualRect(state.nodes.get(id), rect));
  const isFree = (position: Point) => {
    if (content && (position.x < content.x || position.y < content.y)) return false;
    if (obstacles.some((rect) => overlaps(position, drawn, rect))) return false;
    if (section?.type !== 'section') return true;
    const { contentPaddingTop, contentPaddingBottom, contentPaddingX } =
      getSectionLayoutMetrics(section);
    const around = {
      x: position.x - contentPaddingX,
      y: position.y - contentPaddingTop,
      width: drawn.width + contentPaddingX * 2,
      height: drawn.height + contentPaddingTop + contentPaddingBottom,
    };
    const grown = visualRect(
      section,
      unionBounds([
        sectionRect ?? {
          ...around,
          width: SECTION_RENDER_MIN_WIDTH,
          height: SECTION_RENDER_MIN_HEIGHT,
        },
        around,
      ])
    );
    return !outside.some((rect) => overlaps(grown, grown, rect));
  };
  const home =
    sectionRect && state.addedNodeIds.has(sectionId)
      ? contentBounds(section, sectionRect)
      : content;

  // A mindmap topic grows outward from its parent on its branch side, whatever the page's shape.
  const branch = mindmapBranch(state, node, rects);
  const backward = branch?.side === 'left';
  let candidate = branch
    ? beside(branch.rect, drawn, true, backward)
    : (anchorPosition(state, node.id, drawn, rects, horizontal) ?? orphanOrigin);
  if (content && !isPointInsideBounds(candidate, content)) {
    candidate = { x: content.x, y: content.y };
  }
  const position = findFreePosition(
    candidate,
    drawn,
    obstacles,
    horizontal || branch !== undefined,
    isFree,
    home,
    backward
  );
  return { x: Math.round(position.x), y: Math.round(position.y - drawn.y), ...size };
}

/**
 * Gives new nodes (and existing nodes moved into a section they sit outside of) free spots near
 * their connections, sizes new sections around their contents and grows existing sections that
 * gained children. Works in absolute coordinates and never moves other existing nodes, except
 * members a new section brings into its container or shifts clear of its edge.
 */
function placeNodes(state: EditState): void {
  const { nodes, original, addedNodeIds } = state;
  const childIds = new Map<string, string[]>();
  for (const node of nodes.values()) {
    const parentId = getNodeParentId(node);
    if (parentId) childIds.set(parentId, [...(childIds.get(parentId) ?? []), node.id]);
  }
  // A section removed and added again under the same id is a new parent too.
  const reparentedIds = [...nodes.values()]
    .filter((node) => {
      const parentId = getNodeParentId(node);
      return (
        !addedNodeIds.has(node.id) &&
        (parentId !== getNodeParentId(original.get(node.id)) || addedNodeIds.has(parentId))
      );
    })
    .map((node) => node.id);

  const originalPositions = absolutePositions(original);
  const rects = new Map<string, NodeBounds>();
  for (const node of nodes.values()) {
    if (!addedNodeIds.has(node.id)) {
      rects.set(node.id, { ...originalPositions.get(node.id), ...nodeSize(node) });
    }
  }
  // Outer sections first, so a section moved into another moved one lands inside it.
  const relocatedIds = reparentedIds
    .filter((id) => {
      const parentRect = rects.get(getNodeParentId(nodes.get(id)));
      return parentRect !== undefined && !isPointInsideBounds(centerOf(rects.get(id)), parentRect);
    })
    .sort(
      (left, right) =>
        ancestorIds(state, nodes.get(left)).length - ancestorIds(state, nodes.get(right)).length
    );
  const relocatedFrom = new Map(relocatedIds.map((id) => [id, rects.get(id)]));
  relocatedIds.forEach((id) => rects.delete(id));

  const existing = rects.size > 0 ? unionBounds([...rects.values()]) : undefined;
  const horizontal = !existing || existing.width >= existing.height;
  const orphanOrigin = existing
    ? { x: existing.x + existing.width + PLACEMENT_GAP, y: existing.y }
    : { x: 0, y: 0 };

  // What sits inside a section moves with it. Positions are relative, so only the rects change.
  const shiftContents = (id: string, dx: number, dy: number) => {
    for (const childId of childIds.get(id) ?? []) {
      const rect = rects.get(childId);
      if (!rect) continue;
      rects.set(childId, { ...rect, x: rect.x + dx, y: rect.y + dy });
      shiftContents(childId, dx, dy);
    }
  };

  // New sections wrap their contents like wrapSelectionInSection; existing sections that gained
  // children grow right and down and never move.
  const fitSection = (id: string) => {
    const section = nodes.get(id);
    const children = (childIds.get(id) ?? []).filter((childId) => rects.has(childId));
    if (section.type !== 'section' || children.length === 0) return;
    const { contentPaddingTop, contentPaddingBottom, contentPaddingX } =
      getSectionLayoutMetrics(section);
    let bounds = unionBounds(
      children.map((childId) => visualRect(nodes.get(childId), rects.get(childId)))
    );
    const current = addedNodeIds.has(id) ? undefined : rects.get(id);
    // A new section wrapping nodes at the edge of an existing section would cover its border and
    // title, so they move in first.
    const area = current ? undefined : placementBounds(state, ancestorIds(state, section), rects);
    const outside = area !== undefined && !isPointInsideBounds(centerOf(bounds), area);
    const dx = area ? Math.max(0, area.x + contentPaddingX - bounds.x) : 0;
    const dy = area ? Math.max(0, area.y + SECTION_TITLE_OFFSET + contentPaddingTop - bounds.y) : 0;
    if (dx > 0 || dy > 0) {
      shiftContents(id, dx, dy);
      bounds = { ...bounds, x: bounds.x + dx, y: bounds.y + dy };
    }
    const x = current?.x ?? bounds.x - contentPaddingX;
    const y = current?.y ?? bounds.y - contentPaddingTop;
    // New sections are default sections, which never draw smaller than the render minimum.
    const minimum = current ?? {
      width: SECTION_RENDER_MIN_WIDTH,
      height: SECTION_RENDER_MIN_HEIGHT,
    };
    const width = Math.max(minimum.width, bounds.x + bounds.width + contentPaddingX - x);
    const height = Math.max(minimum.height, bounds.y + bounds.height + contentPaddingBottom - y);
    if (current && width === current.width && height === current.height) return;
    rects.set(id, { x, y, width, height });
    nodes.set(id, {
      ...section,
      // React Flow sizes a section the user resized by its top-level width and height.
      ...(typeof section.width === 'number' ? { width } : {}),
      ...(typeof section.height === 'number' ? { height } : {}),
      style: { ...section.style, width, height },
      ...(section.measured ? { measured: { width, height } } : {}),
    });
    if (outside) {
      // Nodes outside the existing section move in with the new one, like a moved section.
      rects.delete(id);
      const rect = placeNode(state, nodes.get(id), rects, horizontal, orphanOrigin);
      shiftContents(id, rect.x - x, rect.y - y);
      rects.set(id, rect);
    }
  };
  // Innermost first, so each section wraps its already sized child sections.
  const fitAncestors = (id: string) => ancestorIds(state, nodes.get(id)).forEach(fitSection);

  const place = (id: string) => {
    const rect = placeNode(state, nodes.get(id), rects, horizontal, orphanOrigin);
    const from = relocatedFrom.get(id);
    if (from) shiftContents(id, rect.x - from.x, rect.y - from.y);
    rects.set(id, rect);
    fitAncestors(id);
  };
  // A moved section goes first with its contents, so everything else lands around it.
  relocatedIds.filter((id) => childIds.has(id)).forEach(place);
  // Sections are sized as soon as their contents are known, so later nodes keep clear of them.
  reparentedIds.filter((id) => rects.has(id)).forEach(fitAncestors);
  // New sections with contents are sized around them instead of placed.
  [...relocatedIds, ...addedNodeIds].filter((id) => !childIds.has(id)).forEach(place);

  // React Flow positions are relative to the parent section.
  const movedIds = new Set([...addedNodeIds, ...reparentedIds]);
  for (const [id, rect] of rects) {
    if (!movedIds.has(id)) continue;
    const node = nodes.get(id);
    const parentRect = rects.get(getNodeParentId(node));
    nodes.set(id, {
      ...node,
      position: { x: rect.x - (parentRect?.x ?? 0), y: rect.y - (parentRect?.y ?? 0) },
    });
  }
}

// New mindmap topics, topics whose incoming edges changed and everything below them hang off the
// mindmap node that links to them; the others are roots. Returns the topics it placed.
function assignMindmapBranches(state: EditState): Set<string> {
  type Branch = { depth: number; side?: 'left' | 'right' };
  const isTopic = (id: string) => state.nodes.get(id)?.type === 'mindmap';
  const stale = new Set([...state.addedNodeIds, ...state.rebranchIds].filter(isTopic));
  // A set also visits the entries added while iterating it, so this reaches every descendant.
  for (const id of stale) {
    for (const edge of state.edges.values()) {
      if (edge.source === id && isTopic(edge.target)) stale.add(edge.target);
    }
  }
  // Topics in different sections have different position frames.
  const positions = absolutePositions(state.nodes);
  const branches = new Map<string, Branch>();
  const resolving = new Set<string>();
  const branchOf = (node: FlowNode): Branch => {
    if (!stale.has(node.id)) {
      return { depth: node.data.mindmapDepth ?? 0, side: node.data.mindmapSide };
    }
    const known = branches.get(node.id);
    if (known) return known;

    // Edges from topics still being resolved would close a loop.
    resolving.add(node.id);
    const parentId = mindmapParentId(state, node.id, resolving);
    const parent = parentId === undefined ? undefined : state.nodes.get(parentId);
    const parentBranch = parent ? branchOf(parent) : undefined;
    resolving.delete(node.id);
    if (!parent) {
      const data: NodeData = { ...node.data, mindmapDepth: 0 };
      delete data.mindmapParentId;
      delete data.mindmapSide;
      state.nodes.set(node.id, { ...node, data });
      branches.set(node.id, { depth: 0 });
      return { depth: 0 };
    }

    const side =
      parentBranch.depth === 0
        ? positions.get(node.id).x < positions.get(parent.id).x
          ? 'left'
          : 'right'
        : (parentBranch.side ?? 'right');
    const branch = { depth: parentBranch.depth + 1, side };
    branches.set(node.id, branch);
    state.nodes.set(node.id, {
      ...node,
      data: {
        ...node.data,
        mindmapDepth: branch.depth,
        mindmapParentId: parent.id,
        mindmapSide: side,
        // Resolved after the parent got its branch, so the root's style carries down.
        mindmapBranchStyle: resolveMindmapBranchStyleForNode(parent.id, [...state.nodes.values()]),
      },
    });
    return branch;
  };

  for (const id of stale) branchOf(state.nodes.get(id));
  return stale;
}

function finishEdges(state: EditState, nodes: FlowNode[], rebranchedIds: Set<string>): FlowEdge[] {
  const edges = syncSequenceEdgeParticipantKinds(nodes, [...state.edges.values()]);
  // Mindmap edge handles and branch styling depend on where the topics hang.
  const syncedEdges = syncMindmapEdges(
    nodes,
    edges.filter(
      (edge) =>
        state.addedEdgeIds.has(edge.id) ||
        rebranchedIds.has(edge.source) ||
        rebranchedIds.has(edge.target)
    )
  );
  const syncedById = new Map(syncedEdges.map((edge) => [edge.id, edge]));
  return edges.map((edge) => syncedById.get(edge.id) ?? edge);
}

function countOf(count: number, noun: string): string {
  return count === 0 ? '' : `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function describeChange(verb: string, nodeCount: number, edgeCount: number): string[] {
  const counts = [countOf(nodeCount, 'node'), countOf(edgeCount, 'edge')].filter(Boolean);
  return counts.length > 0 ? [`${verb} ${counts.join(' and ')}`] : [];
}

function summarize(state: EditState): string {
  const text = [
    ...describeChange('added', state.addedNodeIds.size, state.addedEdgeIds.size),
    ...describeChange('updated', state.updatedNodeIds.size, state.updatedEdgeIds.size),
    ...describeChange('removed', state.removedNodes.length, state.removedEdgeCount),
  ].join('; ');
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : 'No changes.';
}

function describeRemovals(
  state: EditState,
  nodes: FlowNode[],
  options: CanvasEditOptions
): CanvasEditDestructiveInfo {
  const startNodeIds = options.startNodeIds ?? new Set(state.original.keys());
  const removedNodes = state.removedNodes
    .filter((node) => startNodeIds.has(node.id))
    .map((node) => ({ id: node.id, label: node.data.label }));
  const removedStartNodeIds = [
    ...new Set([...(options.removedStartNodeIds ?? []), ...removedNodes.map((node) => node.id)]),
  ];
  const removedIds = new Set(removedStartNodeIds);
  // Removing everything the user had counts as clearing, even with the agent's nodes left behind.
  const clearsCanvas =
    removedNodes.length > 0 &&
    (nodes.length === 0 || [...startNodeIds].every((id) => removedIds.has(id)));
  return {
    removedNodes,
    removedStartNodeIds,
    clearsCanvas,
    needsConfirmation:
      clearsCanvas ||
      (removedNodes.length > 0 && removedStartNodeIds.length >= DESTRUCTIVE_REMOVAL_THRESHOLD),
  };
}
