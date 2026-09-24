import type { FlowNode } from '@/lib/types';
import { normalizeErFields, stringifyErField } from '@/lib/entityFields';

// A Copilot agent turn edits the node with its tools; the other providers answer with the whole diagram.
const RETURN_FULL_DSL = 'Return valid OpenFlow DSL for the full updated diagram.';

export function buildEntityFieldGenerationPrompt(node: FlowNode, forAgent = false): string {
  const existingFields = normalizeErFields(node.data.erFields)
    .map((field) => stringifyErField(field))
    .filter(Boolean);

  const fieldContext = existingFields.length > 0
    ? `Existing fields:\n- ${existingFields.join('\n- ')}`
    : 'There are no fields yet.';

  return [
    `Generate a realistic ER entity field list for the selected table "${node.data.label || 'Entity'}".`,
    'Only update the selected ER entity.',
    'Preserve all other nodes and edges exactly as they are.',
    ...(forAgent ? [] : [RETURN_FULL_DSL]),
    'Use concise, production-style table fields with types and PK/FK/NN/UNIQUE markers when appropriate.',
    'If there is an obvious created/updated timestamp pattern, include it.',
    fieldContext,
  ].join('\n\n');
}

export function buildArchitectureServiceSuggestionPrompt(node: FlowNode, forAgent = false): string {
  const context = [
    `Selected architecture node label: ${node.data.label || 'New Service'}`,
    `Provider: ${String(node.data.archProviderLabel || node.data.archProvider || 'custom')}`,
    `Resource type: ${String(node.data.archResourceType || 'service')}`,
    `Environment: ${String(node.data.archEnvironment || 'default')}`,
    `Zone: ${String(node.data.archZone || '') || 'none'}`,
    `Trust domain: ${String(node.data.archTrustDomain || '') || 'none'}`,
  ].join('\n');

  return [
    'Refine the selected architecture node into a context-aware service suggestion.',
    'Only update the selected architecture node and, if needed, its direct metadata.',
    'Do not add unrelated nodes or edges.',
    'Choose a more specific label, icon, provider-aligned service metadata, and a short subLabel.',
    ...(forAgent ? [] : [RETURN_FULL_DSL]),
    context,
  ].join('\n\n');
}
