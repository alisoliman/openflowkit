import { describe, expect, it } from 'vitest';
import { parseOpenFlowDSL } from '@/lib/openFlowDSLParser';
import { getGeminiSystemInstruction } from './geminiSystemInstruction';
import { STARTER_TEMPLATES } from '../../mcp-server/src/lib/starterTemplates';

describe.each(['create', 'edit'] as const)('Flowpilot %s instruction grammar', (mode) => {
  const instruction = getGeminiSystemInstruction(mode);
  const edgeSection = instruction.split('## Edges')[1].split('## Attributes')[0];
  const edgeSyntax = [...edgeSection.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]);
  const examples = [...instruction.matchAll(/```\n([\s\S]*?)```/g)].map((match) => match[1]);

  it('covers every documented connector and full diagram example', () => {
    expect(edgeSyntax).toHaveLength(5);
    expect(examples.length).toBeGreaterThanOrEqual(3);
  });

  it.each(edgeSyntax)('advertises parseable connector syntax: %s', (syntax) => {
    const result = parseOpenFlowDSL([
      'flow: Connector',
      '[system] provider: OAuth Provider',
      '[system] auth_svc: Authentication Service',
      `provider ${syntax} auth_svc`,
    ].join('\n'));

    expect(result.error).toBeUndefined();
    expect(result.nodes.map((node) => node.id)).toEqual(['provider', 'auth_svc']);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({ source: 'provider', target: 'auth_svc' });
  });

  it.each(examples.map((example, index) => [index + 1, example] as const))(
    'provides parseable diagram example %s',
    (_index, example) => {
      const result = parseOpenFlowDSL(example);
      expect(result.error).toBeUndefined();
      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.edges.length).toBeGreaterThan(0);
    },
  );

  it('uses a complete dashed arrow for note attachments as well', () => {
    expect(instruction.includes('connected with `..>`')).toBe(true);
  });
});

describe('MCP starter template grammar', () => {
  it.each(STARTER_TEMPLATES)('$name parses with the authoritative browser parser', ({ dsl }) => {
    const result = parseOpenFlowDSL(dsl);
    expect(result.error).toBeUndefined();
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.edges.length).toBeGreaterThan(0);
  });
});
