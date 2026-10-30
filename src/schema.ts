import type { EdgeLabel, VertexLabel } from './types.ts';
import { GatewayError } from './validation.ts';

export const properties: Record<VertexLabel, readonly string[]> = {
  Capability: ['name'], Agent: ['agent_id', 'name', 'description'],
  AgentVersion: ['version', 'status', 'description', 'developer', 'invoke_kind', 'dsh_ref', 'performance_evidence_json', 'constraints_json', 'model_dependencies_json', 'selection_policy_json', 'object_categories_json', 'input_schema', 'output_schema', 'intermediate_artifacts_json', 'cost_json', 'effect_json'],
  FieldGroup: ['group_id', 'name', 'display_order', 'fields_json'],
};
export const edgeTypes: Record<EdgeLabel, readonly [VertexLabel, VertexLabel]> = {
  HAS_CHILD: ['Capability', 'Capability'], HAS_AGENT: ['Capability', 'Agent'], HAS_VERSION: ['Agent', 'AgentVersion'],
};
export const jsonProperties: readonly string[] = [...properties.AgentVersion.filter(k => k.endsWith('_json') || k.endsWith('_schema')), 'fields_json'];
export function verifySchema(raw: unknown): void {
  const bad = (): never => { throw new GatewayError('SCHEMA', 'Required HugeGraph labels, relationships or property storage are incompatible'); };
  if (!raw || typeof raw !== 'object') bad();
  const schema = raw as Record<string, unknown>;
  const list = (k: string): Record<string, unknown>[] => Array.isArray(schema[k]) ? schema[k] as Record<string, unknown>[] : bad();
  const find = (key: string, name: string): Record<string, unknown> => {
    const matches = list(key).filter(v => v && v.name === name);
    return matches.length === 1 ? matches[0]! : bad();
  };
  for (const [label, fields] of Object.entries(properties)) {
    const v = find('vertexlabels', label);
    const stored = v.properties;
    if (!Array.isArray(stored) || !fields.every(p => stored.includes(p))) bad();
    for (const p of fields) {
      const definition = find('propertykeys', p);
      if (definition.data_type !== (p === 'display_order' ? 'INT' : 'TEXT') || definition.cardinality !== 'SINGLE') bad();
    }
  }
  for (const [label, [source, target]] of Object.entries(edgeTypes)) {
    const e = find('edgelabels', label);
    if (e.source_label !== source || e.target_label !== target) bad();
  }
}
