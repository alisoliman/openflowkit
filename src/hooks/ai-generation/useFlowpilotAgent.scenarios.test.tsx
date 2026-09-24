import { useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAbsoluteNodeBounds, type NodeBounds } from '@/hooks/node-operations/sectionBounds';
import type { DiagramType, FlowEdge, FlowNode } from '@/lib/types';
import { EXAMPLE_LINT_RULES } from '@/services/architectureLint/defaultRules';
import { evaluateRules, parseRulesJson } from '@/services/architectureLint/ruleEngine';
import type { LintViolation } from '@/services/architectureLint/types';
import { composeDiagramForDisplay } from '@/services/composeDiagramForDisplay';
import { parseAgentClientMessage, type AgentClientMessage } from '@/services/copilot/agentProtocol';
import type { AgentToolName } from '@/services/copilot/agentTools';
import { assistantThreadToAgentHistory } from '@/services/flowpilot/thread';
import type { AssistantThreadItem } from '@/services/flowpilot/types';
import { useFlowStore } from '@/store';
import { useFlowpilotAgent } from './useFlowpilotAgent';

// Whole turns without Copilot: a script plays the server side of the agent socket, while the real
// hook, socket client, executor, canvas edits and ELK layout run against the store.

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('@/components/ui/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('@/services/composeDiagramForDisplay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/composeDiagramForDisplay')>();
  return { ...actual, composeDiagramForDisplay: vi.fn(actual.composeDiagramForDisplay) };
});

type ClientFrame<Type extends AgentClientMessage['type']> = Extract<AgentClientMessage, { type?: Type }>;
type Script = (copilot: ScriptedCopilot) => Promise<void>;

interface IconHit {
  packId: string;
  shapeId: string;
  provider: string;
}

/** One agent socket, with a script playing Copilot the way the server relays its session. */
class ScriptedCopilot extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static scripts: Script[] = [];
  static opened: ScriptedCopilot[] = [];
  readyState = ScriptedCopilot.CONNECTING;
  start!: ClientFrame<'start'>;
  /** Settles once the script has ended the turn, rejecting with the script's own failure. */
  readonly finished: Promise<void>;
  private inbox: Array<AgentClientMessage | null> = [];
  private wake?: () => void;
  private calls = 0;
  private reply = '';

  constructor(readonly url: string, readonly protocol: string) {
    super();
    const script = ScriptedCopilot.scripts.shift();
    if (!script) throw new Error('No scripted turn left.');
    ScriptedCopilot.opened.push(this);
    this.finished = this.play(script);
    this.finished.catch(() => undefined);
    setTimeout(() => {
      this.readyState = ScriptedCopilot.OPEN;
      this.dispatchEvent(new Event('open'));
    });
  }

  send(data: string): void {
    this.inbox.push(parseAgentClientMessage(data));
    this.wake?.();
  }

  close(): void {
    if (this.readyState === ScriptedCopilot.CLOSED) return;
    this.readyState = ScriptedCopilot.CLOSED;
    this.dispatchEvent(new Event('close'));
  }

  /** Runs a tool in the browser the way the server relays it, and returns the tool result. */
  async tool(name: AgentToolName, args: unknown): Promise<ClientFrame<'tool_result'>> {
    const callId = `call-${++this.calls}`;
    this.emit({ type: 'step', callId, name, status: 'started' });
    this.emit({ type: 'tool_call', callId, name, args });
    const result = await this.receive('tool_result');
    expect(result.callId).toBe(callId);
    this.emit({ type: 'step', callId, name, status: result.ok ? 'succeeded' : 'failed' });
    return result;
  }

  /** A tool call the script needs to succeed. */
  async call<Result = Record<string, unknown>>(name: AgentToolName, args: unknown): Promise<Result> {
    const result = await this.tool(name, args);
    if (result.ok === false) throw new Error(`${name} failed: ${result.error}`);
    return result.result as Result;
  }

  async ask(question: string, choices: string[]): Promise<ClientFrame<'answer'>> {
    const callId = `call-${++this.calls}`;
    this.emit({ type: 'step', callId, name: 'ask_user', status: 'started' });
    this.emit({ type: 'question', questionId: `question-${this.calls}`, question, choices, allowFreeform: true });
    const answer = await this.receive('answer');
    this.emit({ type: 'step', callId, name: 'ask_user', status: 'succeeded' });
    return answer;
  }

  /** One assistant message; the server puts a blank line between the messages of a reply. */
  say(text: string): void {
    const delta = this.reply ? `\n\n${text}` : text;
    this.reply += delta;
    this.emit({ type: 'reply_delta', text: delta });
  }

  private async play(script: Script): Promise<void> {
    this.start = await this.receive('start');
    this.emit({ type: 'accepted', turnId: this.start.turnId });
    try {
      await script(this);
    } catch (error) {
      this.emit({ type: 'error', code: 'request_failed', message: 'The scripted turn failed.' });
      throw error;
    }
    this.emit({ type: 'done', reply: this.reply });
  }

  private emit(frame: Record<string, unknown>): void {
    if (this.readyState !== ScriptedCopilot.OPEN) return;
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ v: 1, ...frame }) }));
  }

  private async receive<Type extends AgentClientMessage['type']>(type: Type): Promise<ClientFrame<Type>> {
    while (this.inbox.length === 0) await new Promise<void>((resolve) => { this.wake = resolve; });
    const message = this.inbox.shift();
    if (message?.type !== type) {
      throw new Error(`Expected a ${type} frame from the browser, got ${message ? message.type : 'an invalid frame'}.`);
    }
    return message as ClientFrame<Type>;
  }
}

async function findIcon(copilot: ScriptedCopilot, query: string, provider: string) {
  const { icons } = await copilot.call<{ icons: IconHit[] }>('find_icons', { query, provider, limit: 1 });
  expect(icons).toEqual([expect.objectContaining({ provider })]);
  return { archIconPackId: icons[0].packId, archIconShapeId: icons[0].shapeId };
}

const onError = vi.fn();
const fitView = vi.fn();

function useHarness() {
  const [thread, setThread] = useState<AssistantThreadItem[]>([]);
  const pageId = useFlowStore((state) => state.activeTabId);
  const agent = useFlowpilotAgent({ pageId, model: '', thread, updateThread: setThread, blockedReason: null, onError, fitView });
  return { ...agent, thread };
}

function setup() {
  return renderHook(() => useHarness()).result;
}

type Harness = ReturnType<typeof setup>;

function send(result: Harness, prompt: string, script: Script): Promise<boolean> {
  ScriptedCopilot.scripts.push(script);
  let request!: Promise<boolean>;
  act(() => { request = result.current.send(prompt); });
  return request;
}

async function finish(request: Promise<boolean>): Promise<boolean> {
  let ok = false;
  await act(async () => { ok = await request; });
  await copilot().finished;
  return ok;
}

async function waitForPause(result: Harness) {
  await waitFor(() => expect(result.current.liveItem?.agentTurn?.status).toBe('waiting'));
  return result.current.liveItem!.agentTurn!.questions.at(-1)!;
}

function copilot(): ScriptedCopilot {
  const socket = ScriptedCopilot.opened.at(-1);
  if (!socket) throw new Error('No agent socket opened.');
  return socket;
}

function turnItem(result: Harness): AssistantThreadItem {
  const item = result.current.thread.at(-1);
  expect(item?.type).toBe('assistant_agent_turn');
  return item!;
}

function steps(item: AssistantThreadItem): string[] {
  return item.agentTurn!.steps.map((step) => `${step.name} ${step.status}`);
}

function setCanvas(nodes: FlowNode[], edges: FlowEdge[] = []): void {
  useFlowStore.getState().setNodes(nodes);
  useFlowStore.getState().setEdges(edges);
}

function node(id: string): FlowNode {
  const found = useFlowStore.getState().nodes.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No node "${id}" on the canvas.`);
  return found;
}

function labels(): string[] {
  return useFlowStore.getState().nodes.map((candidate) => String(candidate.data.label));
}

function positions(): Record<string, { x: number; y: number }> {
  return Object.fromEntries(useFlowStore.getState().nodes.map((candidate) => [candidate.id, candidate.position]));
}

function bounds(id: string): NodeBounds {
  return getAbsoluteNodeBounds(node(id), useFlowStore.getState().nodes);
}

function centerX(id: string): number {
  const { x, width } = bounds(id);
  return x + width / 2;
}

function overlaps(a: NodeBounds, b: NodeBounds): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function contains(outer: NodeBounds, inner: NodeBounds): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

/** No two nodes overlap, except a section and its own children. */
function expectNoOverlaps(): void {
  const { nodes } = useFlowStore.getState();
  for (const [index, first] of nodes.entries()) {
    for (const second of nodes.slice(index + 1)) {
      if (first.parentId === second.id || second.parentId === first.id) continue;
      expect(overlaps(bounds(first.id), bounds(second.id)), `${first.id} overlaps ${second.id}`).toBe(false);
    }
  }
}

function setDiagramType(diagramType: DiagramType): void {
  const { activeTabId, updateTab } = useFlowStore.getState();
  updateTab(activeTabId, { diagramType });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  ScriptedCopilot.scripts = [];
  ScriptedCopilot.opened = [];
  vi.stubGlobal('WebSocket', ScriptedCopilot);
  useFlowStore.setState({ documents: [], tabs: [], nodes: [], edges: [], agentTurn: null });
  useFlowStore.getState().createDocument();
  useFlowStore.getState().setViewSettings({ lintRules: '' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Flowpilot agent scenarios', () => {
  it('builds an Azure AKS architecture on an empty canvas with provider icons and a full layout', async () => {
    setDiagramType('architecture');
    const result = setup();
    const request = send(result, 'Design an AKS platform on Azure for our orders service.', async (copilot) => {
      expect(await copilot.call('get_canvas', {})).toMatchObject({ nodeCount: 0, edgeCount: 0, nodes: [] });
      const icon = (query: string) => findIcon(copilot, query, 'azure');
      const frontDoor = await icon('front door');
      const gateway = await icon('application gateway');
      const aks = await icon('kubernetes service');
      const sql = await icon('azure sql database');
      const vault = await icon('key vault');
      copilot.say('Starting with the edge and the cluster.');
      await copilot.call('edit_canvas', {
        ops: [
          { op: 'add_node', id: 'users', type: 'custom', label: 'Customers', data: { icon: 'Users' } },
          { op: 'add_node', id: 'front-door', type: 'custom', label: 'Azure Front Door', data: frontDoor },
          { op: 'add_node', id: 'vnet', type: 'section', label: 'Production VNet' },
          { op: 'add_node', id: 'app-gateway', type: 'custom', label: 'Application Gateway', parentId: 'vnet', data: gateway },
          { op: 'add_node', id: 'aks', type: 'custom', label: 'AKS cluster', parentId: 'vnet', data: aks },
          { op: 'add_edge', source: 'users', target: 'front-door', label: 'HTTPS' },
          { op: 'add_edge', source: 'front-door', target: 'app-gateway' },
          { op: 'add_edge', source: 'app-gateway', target: 'aks', label: 'ingress' },
        ],
      });
      await copilot.call('edit_canvas', {
        ops: [
          { op: 'add_node', id: 'orders-db', type: 'custom', label: 'Azure SQL Database', data: sql },
          { op: 'add_node', id: 'key-vault', type: 'custom', label: 'Key Vault', data: vault },
          { op: 'add_edge', source: 'aks', target: 'orders-db', label: 'orders' },
          { op: 'add_edge', source: 'aks', target: 'key-vault', label: 'secrets', data: { dashPattern: 'dashed' } },
        ],
      });
      expect(await copilot.call('layout', { scope: 'all' })).toEqual({ summary: 'Re-laid out the whole page.' });
      copilot.say('Front Door terminates TLS, the Application Gateway routes into AKS, and the cluster reads secrets from Key Vault.');
    });

    expect(await finish(request)).toBe(true);
    expect(copilot().start).toMatchObject({
      prompt: 'Design an AKS platform on Azure for our orders service.',
      model: 'auto',
      history: [],
      canvas: { nodeCount: 0, edgeCount: 0, selectedIds: [] },
    });

    // Provider icons from find_icons, a Lucide icon for the people, and the AKS resources in the VNet.
    for (const id of ['front-door', 'app-gateway', 'aks', 'orders-db', 'key-vault']) {
      expect(node(id).data).toMatchObject({ archIconPackId: 'azure-official-icons-v20', assetPresentation: 'icon' });
    }
    expect(node('aks').data.archIconShapeId).toMatch(/kubernetes/);
    expect(node('key-vault').data.archIconShapeId).toMatch(/key-vault/);
    expect(node('users').data.icon).toBe('Users');
    expect(node('vnet').type).toBe('section');
    expect([node('app-gateway').parentId, node('aks').parentId]).toEqual(['vnet', 'vnet']);
    expect(useFlowStore.getState().edges).toHaveLength(5);

    // The whole-page layout ran ELK with the architecture direction: left to right, nothing overlapping.
    expect(composeDiagramForDisplay).toHaveBeenCalledOnce();
    expect(composeDiagramForDisplay).toHaveBeenCalledWith(expect.any(Array), expect.any(Array), expect.objectContaining({
      diagramType: 'architecture',
      direction: 'LR',
    }));
    expect(centerX('users')).toBeLessThan(centerX('front-door'));
    expect(centerX('front-door')).toBeLessThan(centerX('app-gateway'));
    expect(centerX('app-gateway')).toBeLessThan(centerX('aks'));
    expect(centerX('aks')).toBeLessThan(centerX('orders-db'));
    expect(centerX('aks')).toBeLessThan(centerX('key-vault'));
    expect(contains(bounds('vnet'), bounds('aks'))).toBe(true);
    expectNoOverlaps();
    await waitFor(() => expect(fitView).toHaveBeenCalledWith({ duration: 600, padding: 0.2 }));

    const item = turnItem(result);
    expect(result.current.thread.map((entry) => entry.type)).toEqual(['user_message', 'assistant_agent_turn']);
    expect(item.content).toBe('Starting with the edge and the cluster.\n\nFront Door terminates TLS, the Application Gateway routes into AKS, and the cluster reads secrets from Key Vault.');
    expect(steps(item)).toEqual([
      'get_canvas succeeded',
      ...Array(5).fill('find_icons succeeded'),
      'edit_canvas succeeded',
      'edit_canvas succeeded',
      'layout succeeded',
    ]);
    expect(item.agentTurn).toMatchObject({ status: 'done', questions: [] });
    expect(item.changes).toMatchObject({ addedCount: 7, addedEdgeCount: 5, removedCount: 0, updatedCount: 0 });
    // The whole turn is one history entry that the thread offers to undo.
    const history = useFlowStore.getState().tabs[0].history;
    expect(history.past).toHaveLength(1);
    expect(history.past[0].nodes).toEqual([]);
    expect(result.current.controls.undoItemId).toBe(item.id);
    expect(result.current.isRunning).toBe(false);
    expect(useFlowStore.getState().agentTurn).toBeNull();
    // The next turn replays what changed.
    expect(assistantThreadToAgentHistory(result.current.thread).at(-1)?.content)
      .toContain('[Canvas changes this turn: added node "Customers"; added node "Azure Front Door"; added node "Production VNet";');
  });

  it('adds a cache to an existing diagram next to the selected node without moving anything else', async () => {
    const shop: FlowNode[] = [
      { id: 'web', type: 'process', data: { label: 'Storefront' }, position: { x: 0, y: 0 } },
      { id: 'api', type: 'process', data: { label: 'Orders API' }, position: { x: 320, y: 0 }, selected: true },
      { id: 'db', type: 'process', data: { label: 'Orders DB' }, position: { x: 640, y: 0 } },
    ];
    const edges: FlowEdge[] = [
      { id: 'web-api', source: 'web', target: 'api', label: 'REST' },
      { id: 'api-db', source: 'api', target: 'db', label: 'SQL' },
    ];
    setDiagramType('architecture');
    setCanvas(shop, edges);
    const before = positions();
    const result = setup();
    const request = send(result, 'Add a cache in front of the database for this.', async (copilot) => {
      const [selectedId] = copilot.start.canvas.selectedIds;
      const canvas = await copilot.call<{ nodes: Array<{ id: string; label: string; position: unknown }> }>('get_canvas', { detail: 'full' });
      expect(canvas.nodes.find((entry) => entry.id === selectedId)).toMatchObject({ label: 'Orders API', position: { x: 320, y: 0 } });
      const redis = await findIcon(copilot, 'redis', 'developer');
      await copilot.call('edit_canvas', {
        ops: [
          { op: 'add_node', id: 'cache', type: 'custom', label: 'Redis cache', data: redis },
          { op: 'add_edge', source: selectedId, target: 'cache', label: 'cache-aside reads' },
        ],
      });
      expect(await copilot.call('layout', { scope: 'new' })).toEqual({ summary: 'Tidied 1 node added in this turn.' });
      copilot.say('Added a Redis cache next to the Orders API for cache-aside reads.');
    });

    expect(await finish(request)).toBe(true);
    expect(copilot().start.canvas).toMatchObject({ nodeCount: 3, edgeCount: 2, selectedIds: ['api'] });

    // The user's nodes and edges are exactly as they were; only the cache is new, placed beside the API.
    expect(positions()).toMatchObject(before);
    for (const original of shop) expect(node(original.id).data).toEqual(original.data);
    expect(useFlowStore.getState().edges.slice(0, 2)).toEqual(edges);
    expect(useFlowStore.getState().edges[2]).toMatchObject({ source: 'api', target: 'cache', label: 'cache-aside reads' });
    expect(node('cache').data).toMatchObject({ label: 'Redis cache', archIconPackId: 'developer-icons-v1', assetPresentation: 'icon' });
    expectNoOverlaps();
    const distance = (id: string) => Math.hypot(bounds('cache').x - bounds(id).x, bounds('cache').y - bounds(id).y);
    expect(distance('api')).toBeLessThan(distance('web'));
    expect(composeDiagramForDisplay).not.toHaveBeenCalled();
    // Only a whole-page layout brings the result into view, 100 ms after it lands.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(fitView).not.toHaveBeenCalled();

    const item = turnItem(result);
    expect(steps(item)).toEqual(['get_canvas succeeded', 'find_icons succeeded', 'edit_canvas succeeded', 'layout succeeded']);
    expect(item.changes).toMatchObject({
      addedCount: 1, updatedCount: 0, removedCount: 0, addedEdgeCount: 1, updatedEdgeCount: 0, removedEdgeCount: 0,
    });
    expect(assistantThreadToAgentHistory(result.current.thread).at(-1)?.content).toBe(
      'Added a Redis cache next to the Orders API for cache-aside reads.\n'
      + '[Canvas changes this turn: added node "Redis cache"; added edge "Orders API -> Redis cache (cache-aside reads)"]'
    );
  });

  it('reviews the architecture against the lint rules, fixes the findings and reviews again', async () => {
    const orders: FlowNode[] = [
      { id: 'gateway', type: 'process', data: { label: 'API Gateway' }, position: { x: 0, y: 0 } },
      { id: 'orders', type: 'process', data: { label: 'Orders Service' }, position: { x: 300, y: 0 } },
      { id: 'db', type: 'process', data: { label: 'Orders Database' }, position: { x: 600, y: 0 } },
    ];
    setCanvas(orders, [
      { id: 'gateway-orders', source: 'gateway', target: 'orders' },
      { id: 'orders-db', source: 'orders', target: 'db' },
    ]);
    useFlowStore.getState().setViewSettings({ lintRules: EXAMPLE_LINT_RULES });
    const before = positions();
    const result = setup();
    const request = send(result, 'Review this against our rules and fix what you find.', async (copilot) => {
      const review = await copilot.call<{ ruleCount: number; violations: LintViolation[] }>('review_architecture', {});
      expect(review.ruleCount).toBe(3);
      expect(review.violations.map((violation) => violation.ruleId)).toEqual(['no-direct-db-call', 'api-must-reach-auth']);
      const direct = review.violations.find((violation) => violation.ruleId === 'no-direct-db-call')!;
      await copilot.call('edit_canvas', {
        ops: [
          ...direct.edgeIds.map((id) => ({ op: 'remove_edge', id })),
          { op: 'add_node', id: 'orders-repo', type: 'process', label: 'Orders Repository' },
          { op: 'add_edge', source: 'orders', target: 'orders-repo' },
          { op: 'add_edge', source: 'orders-repo', target: 'db', label: 'SQL' },
          { op: 'add_node', id: 'auth', type: 'process', label: 'Auth Service' },
          { op: 'add_edge', source: 'gateway', target: 'auth', label: 'validates tokens' },
        ],
      });
      expect(await copilot.call('review_architecture', {})).toEqual({ ruleCount: 3, violations: [] });
      copilot.say('Fixed both findings: the service now reaches the database through a repository, and the gateway validates tokens with an Auth Service.');
    });

    expect(await finish(request)).toBe(true);
    const { nodes, edges } = useFlowStore.getState();
    expect(evaluateRules(nodes, edges, parseRulesJson(EXAMPLE_LINT_RULES).rules)).toEqual([]);
    expect(edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
      'gateway->orders', 'orders->orders-repo', 'orders-repo->db', 'gateway->auth',
    ]);
    expect(positions()).toMatchObject(before);
    expectNoOverlaps();

    const item = turnItem(result);
    expect(steps(item)).toEqual(['review_architecture succeeded', 'edit_canvas succeeded', 'review_architecture succeeded']);
    expect(item.changes).toMatchObject({ addedCount: 2, removedCount: 0, updatedCount: 0, addedEdgeCount: 3, removedEdgeCount: 1 });
    expect(item.content).toContain('Fixed both findings');
  });

  describe('a rebuild that removes the whole diagram', () => {
    const flow: FlowNode[] = [
      { id: 'received', type: 'start', data: { label: 'Order received' }, position: { x: 0, y: 0 } },
      { id: 'validate', type: 'process', data: { label: 'Validate order' }, position: { x: 0, y: 140 } },
      { id: 'charge', type: 'process', data: { label: 'Charge card' }, position: { x: 0, y: 280 } },
      { id: 'shipped', type: 'end', data: { label: 'Order shipped' }, position: { x: 0, y: 420 } },
    ];
    const flowEdges: FlowEdge[] = [
      { id: 'received-validate', source: 'received', target: 'validate' },
      { id: 'validate-charge', source: 'validate', target: 'charge' },
      { id: 'charge-shipped', source: 'charge', target: 'shipped' },
    ];
    const eventFlow = [
      { op: 'add_node', id: 'checkout', type: 'process', label: 'Checkout service' },
      { op: 'add_node', id: 'bus', type: 'process', label: 'Order events' },
      { op: 'add_node', id: 'payments', type: 'process', label: 'Payments consumer' },
      { op: 'add_edge', source: 'checkout', target: 'bus', label: 'OrderPlaced' },
      { op: 'add_edge', source: 'bus', target: 'payments' },
    ];

    const rebuildAsEvents: Script = async (copilot) => {
      const canvas = await copilot.call<{ nodes: Array<{ id: string }> }>('get_canvas', {});
      const rebuilt = await copilot.tool('edit_canvas', {
        ops: [...canvas.nodes.map(({ id }) => ({ op: 'remove_node', id })), ...eventFlow],
      });
      if (rebuilt.ok) {
        await copilot.call('layout', { scope: 'all' });
        copilot.say('Rebuilt the flow around order events.');
        return;
      }
      expect(rebuilt).toEqual({
        v: 1,
        type: 'tool_result',
        callId: expect.any(String),
        ok: false,
        error: 'User declined removing "Order received", "Validate order", "Charge card", "Order shipped". Nothing was changed.',
      });
      await copilot.call('edit_canvas', {
        ops: [...eventFlow, { op: 'add_edge', source: 'charge', target: 'bus', label: 'PaymentCaptured' }],
      });
      copilot.say('Kept your steps and added the event flow next to them.');
    };

    async function startRebuild(result: Harness) {
      const request = send(result, 'Rebuild this as an event-driven flow.', rebuildAsEvents);
      const question = await waitForPause(result);
      expect(question).toMatchObject({
        kind: 'confirm',
        status: 'waiting',
        removedLabels: ['Order received', 'Validate order', 'Charge card', 'Order shipped'],
        removedCount: 4,
        clearsCanvas: true,
      });
      // Nothing is removed while the card waits, and the paused turn is already in the thread.
      expect(labels()).toEqual(['Order received', 'Validate order', 'Charge card', 'Order shipped']);
      expect(turnItem(result).agentTurn).toMatchObject({ status: 'waiting', questions: [{ id: question.id, status: 'waiting' }] });
      return { request, question };
    }

    beforeEach(() => {
      setCanvas(flow, flowEdges);
    });

    it('replaces the canvas once the user approves, and undoes as one step', async () => {
      const before = { nodes: useFlowStore.getState().nodes, edges: useFlowStore.getState().edges };
      const result = setup();
      const { request, question } = await startRebuild(result);
      await act(() => result.current.controls.confirm(question.id, true, ''));
      expect(await finish(request)).toBe(true);

      expect(labels()).toEqual(['Checkout service', 'Order events', 'Payments consumer']);
      expect(useFlowStore.getState().edges).toHaveLength(2);
      expectNoOverlaps();
      const item = turnItem(result);
      expect(item.agentTurn).toMatchObject({
        status: 'done',
        questions: [{ kind: 'confirm', status: 'answered', approved: true }],
      });
      expect(steps(item)).toEqual(['get_canvas succeeded', 'edit_canvas succeeded', 'layout succeeded']);
      expect(item.changes).toMatchObject({ addedCount: 3, removedCount: 4, addedEdgeCount: 2, removedEdgeCount: 3 });
      expect(item.content).toBe('Rebuilt the flow around order events.');

      act(() => result.current.controls.undo());
      expect(useFlowStore.getState().nodes).toEqual(before.nodes);
      expect(useFlowStore.getState().edges).toEqual(before.edges);
      expect(turnItem(result).agentTurn?.undone).toBe(true);
      expect(result.current.controls.undoItemId).toBeNull();
      expect(assistantThreadToAgentHistory(result.current.thread).at(-1)?.content)
        .toContain('; the user has since undone these changes]');
    });

    it('keeps the diagram when the user declines, and the agent works around it', async () => {
      const before = positions();
      const result = setup();
      const { request, question } = await startRebuild(result);
      await act(() => result.current.controls.confirm(question.id, false, ''));
      expect(await finish(request)).toBe(true);

      expect(labels()).toEqual([
        'Order received', 'Validate order', 'Charge card', 'Order shipped', 'Checkout service', 'Order events', 'Payments consumer',
      ]);
      expect(positions()).toMatchObject(before);
      expect(useFlowStore.getState().edges.slice(0, 3)).toEqual(flowEdges);
      expect(useFlowStore.getState().edges).toHaveLength(6);
      expectNoOverlaps();
      const item = turnItem(result);
      expect(item.agentTurn).toMatchObject({
        status: 'done',
        questions: [{ kind: 'confirm', status: 'answered', approved: false }],
      });
      expect(steps(item)).toEqual(['get_canvas succeeded', 'edit_canvas failed', 'edit_canvas succeeded']);
      expect(item.changes).toMatchObject({ addedCount: 3, removedCount: 0, updatedCount: 0, addedEdgeCount: 3, removedEdgeCount: 0 });
      expect(item.content).toBe('Kept your steps and added the event flow next to them.');
    });
  });

  it('asks which cloud to use, then builds on the chosen one', async () => {
    setDiagramType('architecture');
    const result = setup();
    const request = send(result, 'Design a serverless backend for photo uploads.', async (copilot) => {
      const { answer, wasFreeform } = await copilot.ask('Which cloud should this run on?', ['AWS', 'Azure', 'Google Cloud']);
      expect({ answer, wasFreeform }).toEqual({ answer: 'AWS', wasFreeform: false });
      const provider = { AWS: 'aws', Azure: 'azure', 'Google Cloud': 'gcp' }[answer];
      const icon = (query: string) => findIcon(copilot, query, provider);
      const gateway = await icon('api gateway');
      const lambda = await icon('aws lambda');
      const bucket = await icon('simple storage service');
      const table = await icon('dynamodb');
      await copilot.call('edit_canvas', {
        ops: [
          { op: 'add_node', id: 'app', type: 'custom', label: 'Mobile app', data: { icon: 'Smartphone' } },
          { op: 'add_node', id: 'gateway', type: 'custom', label: 'API Gateway', data: gateway },
          { op: 'add_node', id: 'upload', type: 'custom', label: 'Upload function', data: lambda },
          { op: 'add_node', id: 'photos', type: 'custom', label: 'Photo bucket', data: bucket },
          { op: 'add_node', id: 'metadata', type: 'custom', label: 'Photo metadata', data: table },
          { op: 'add_edge', source: 'app', target: 'gateway', label: 'POST /photos' },
          { op: 'add_edge', source: 'gateway', target: 'upload' },
          { op: 'add_edge', source: 'upload', target: 'photos', label: 'put object' },
          { op: 'add_edge', source: 'upload', target: 'metadata' },
        ],
      });
      await copilot.call('layout', { scope: 'all' });
      copilot.say('Built it on AWS: API Gateway invokes a Lambda that stores photos in S3 and metadata in DynamoDB.');
    });

    const question = await waitForPause(result);
    expect(question).toMatchObject({
      kind: 'question',
      status: 'waiting',
      question: 'Which cloud should this run on?',
      choices: ['AWS', 'Azure', 'Google Cloud'],
      allowFreeform: true,
    });
    // The question is saved with the thread, and the page stays locked and untouched while it waits.
    expect(turnItem(result).agentTurn).toMatchObject({ status: 'waiting', steps: [{ name: 'ask_user', status: 'started' }] });
    expect(useFlowStore.getState().agentTurn).not.toBeNull();
    expect(useFlowStore.getState().nodes).toEqual([]);

    await act(() => result.current.controls.answer(question.id, 'AWS', false));
    expect(await finish(request)).toBe(true);

    for (const id of ['gateway', 'upload', 'photos', 'metadata']) {
      expect(node(id).data).toMatchObject({ archIconPackId: 'aws-official-starter-v1', assetPresentation: 'icon' });
    }
    expect(node('upload').data.archIconShapeId).toBe('compute-lambda');
    expect(node('metadata').data.archIconShapeId).toBe('databases-dynamodb');
    expect(node('app').data.icon).toBe('Smartphone');
    expect(centerX('app')).toBeLessThan(centerX('gateway'));
    expect(centerX('gateway')).toBeLessThan(centerX('upload'));
    expectNoOverlaps();

    const item = turnItem(result);
    expect(item.agentTurn).toMatchObject({
      status: 'done',
      questions: [{ kind: 'question', status: 'answered', answer: 'AWS' }],
    });
    expect(steps(item)).toEqual([
      'ask_user succeeded',
      ...Array(4).fill('find_icons succeeded'),
      'edit_canvas succeeded',
      'layout succeeded',
    ]);
    expect(item.changes).toMatchObject({ addedCount: 5, addedEdgeCount: 4 });
    expect(item.content).toBe('Built it on AWS: API Gateway invokes a Lambda that stores photos in S3 and metadata in DynamoDB.');
    // Later turns still know which cloud the user picked.
    expect(assistantThreadToAgentHistory(result.current.thread).at(-1)?.content)
      .toMatch(/\n\[Questions this turn: asked "Which cloud should this run on\?" and the user answered "AWS"\]$/);
  });
});
