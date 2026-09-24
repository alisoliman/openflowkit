import { z } from 'zod/v4';
import { getEditableEdgeLabel } from '@/components/properties/edge/edgeLabelModel';
import {
  buildTemplateInsertionResult,
  getLayoutHintsForDiagramType,
} from '@/hooks/flow-editor-actions/layoutHandlers';
import { getAbsoluteNodeBounds } from '@/hooks/node-operations/sectionBounds';
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
import { AGENT_TOOLS, type AgentToolArgs, type AgentToolName } from '@/services/copilot/agentTools';
import { getCanvasFingerprint } from '@/services/flowpilot/changeSummary';
import { getFlowTemplates } from '@/services/templates';
import { useFlowStore } from '@/store';
import type { AgentTurnLock, FlowState } from '@/store/types';
import {
  NODE_DATA_FIELDS,
  applyCanvasEdits,
  tidyNodes,
  type CanvasEditDestructiveInfo,
  type CanvasGraph,
} from './canvasOps';

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
const EDGE_DATA_FIELDS = [
  'dashPattern',
  'classRelation',
  'erRelation',
  'seqMessageKind',
  'seqMessageOrder',
] as const satisfies readonly (keyof EdgeData)[];

export type AgentToolResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string; resultType?: 'failure' | 'rejected' };

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
}

type ToolHandlers = {
  [N in AgentToolName]: (
    args: AgentToolArgs<N>
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
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

function describeNode(
  node: FlowNode,
  allNodes: FlowNode[],
  full: boolean
): Record<string, unknown> {
  const parentId = getNodeParentId(node);
  const entry: Record<string, unknown> = {
    id: node.id,
    type: node.type,
    label: clipText(node.data.label ?? ''),
  };
  if (parentId) entry.parentId = parentId;
  if (!full) return entry;

  const data = pickDefined(
    node.data,
    NODE_DATA_FIELDS[node.type as keyof typeof NODE_DATA_FIELDS] ?? []
  );
  const bounds = getAbsoluteNodeBounds(node, allNodes);
  return {
    ...entry,
    ...(data ? { data } : {}),
    position: { x: Math.round(bounds.x), y: Math.round(bounds.y) },
    size: { width: Math.round(bounds.width), height: Math.round(bounds.height) },
  };
}

function describeEdge(edge: FlowEdge, full: boolean): Record<string, unknown> {
  const label = getEditableEdgeLabel(edge);
  const entry: Record<string, unknown> = { id: edge.id, source: edge.source, target: edge.target };
  if (label) entry.label = clipText(label);
  const data = full ? pickDefined(edge.data ?? {}, EDGE_DATA_FIELDS) : undefined;
  return data ? { ...entry, data } : entry;
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
  const nodeEntries = takeWithin(
    nodes,
    (node) => describeNode(node, state.nodes, full),
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

/**
 * Runs the agent's tool calls against the live store for one turn. The turn's lock must be held:
 * calls fail once it is released, the page changes or the turn is ending. The first edit records one
 * history entry, so the whole turn undoes in one step.
 */
export function createAgentTurnExecutor({
  turn,
  confirmRemoval,
  endingReason,
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

  const handlers: ToolHandlers = {
    get_canvas: (args) => readCanvas(requireTurn(), args),

    edit_canvas: async ({ ops }) => {
      const state = requireTurn();
      const before = { nodes: state.nodes, edges: state.edges };
      const outcome = applyCanvasEdits(before, ops, {
        startNodeIds,
        removedStartNodeIds,
        layerId: state.activeLayerId,
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
      return { summary: outcome.summary, idMap: outcome.idMap };
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

    layout: async ({ scope }) => {
      const state = requireTurn();
      const before = { nodes: state.nodes, edges: state.edges };
      if (scope === 'new') {
        const ids = addedNodeIds.filter((id) => state.nodes.some((node) => node.id === id));
        if (ids.length === 0) {
          return { summary: 'No nodes were added in this turn, so nothing moved.' };
        }
        commit(before, tidyNodes(before, ids));
        return {
          summary: `Tidied ${ids.length} node${ids.length === 1 ? '' : 's'} added in this turn.`,
        };
      }

      // The layout cache keys on ids and edges only, so it would hand back nodes from before edits.
      const { clearLayoutCache } = await import('@/services/elkLayout');
      clearLayoutCache();
      const diagramType = state.tabs.find((tab) => tab.id === state.activeTabId)?.diagramType;
      const { nodes, edges } = await composeDiagramForDisplay(before.nodes, before.edges, {
        diagramType,
        ...getLayoutHintsForDiagramType(diagramType),
      });
      commit(before, { nodes, edges });
      return { summary: 'Re-laid out the whole page.' };
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
        return { ok: true, result: await handler(parsed.data) };
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
