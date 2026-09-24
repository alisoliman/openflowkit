import { describe, expect, it } from 'vitest';
import { buildArchitectureServiceSuggestionPrompt, buildEntityFieldGenerationPrompt } from './nodeActionPrompts';
import type { FlowNode } from '@/lib/types';

function createEntityNode(): FlowNode {
  return {
    id: 'entity-1',
    type: 'er_entity',
    position: { x: 0, y: 0 },
    data: {
      label: 'users',
      erFields: ['id: UUID PK', 'email: VARCHAR UNIQUE'],
    },
  };
}

function createArchitectureNode(): FlowNode {
  return {
    id: 'arch-1',
    type: 'architecture',
    position: { x: 0, y: 0 },
    data: {
      label: 'orders',
      archProvider: 'aws',
      archResourceType: 'service',
      archEnvironment: 'production',
      archZone: 'private',
      archTrustDomain: 'internal',
    },
  };
}

describe('nodeActionPrompts', () => {
  it('builds a focused entity field generation prompt with current field context', () => {
    const prompt = buildEntityFieldGenerationPrompt(createEntityNode());

    expect(prompt).toContain('selected table "users"');
    expect(prompt).toContain('Only update the selected ER entity.');
    expect(prompt).toContain('id: UUID PK');
    expect(prompt).toContain(
      'Preserve all other nodes and edges exactly as they are.\n\nReturn valid OpenFlow DSL for the full updated diagram.\n\nUse concise'
    );
  });

  it('builds a focused architecture suggestion prompt with infrastructure metadata', () => {
    const prompt = buildArchitectureServiceSuggestionPrompt(createArchitectureNode());

    expect(prompt).toContain('Provider: aws');
    expect(prompt).toContain('Resource type: service');
    expect(prompt).toContain('Only update the selected architecture node');
    expect(prompt).toContain('a short subLabel.\n\nReturn valid OpenFlow DSL for the full updated diagram.\n\nSelected architecture node label: orders');
  });

  it('leaves out the DSL instruction for a Copilot agent turn, which edits with tools', () => {
    const entityPrompt = buildEntityFieldGenerationPrompt(createEntityNode(), true);
    const architecturePrompt = buildArchitectureServiceSuggestionPrompt(createArchitectureNode(), true);

    expect(entityPrompt).toContain('Only update the selected ER entity.');
    expect(entityPrompt).not.toContain('OpenFlow DSL');
    expect(architecturePrompt).toContain('Only update the selected architecture node');
    expect(architecturePrompt).not.toContain('OpenFlow DSL');
  });
});
