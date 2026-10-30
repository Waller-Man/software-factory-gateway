import type { GatewayFailure, ReadQuery, SnapshotOptions, ToolRequest } from './types.ts';

export class GatewayError extends Error {
  constructor(readonly code: string, message: string, readonly field?: string) { super(message); }
}
export function requireThat(value: unknown, code: string, message: string, field?: string): asserts value {
  if (!value) throw new GatewayError(code, message, field);
}
export function object(value: unknown): Record<string, unknown> {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'Expected an object');
  const proto = Object.getPrototypeOf(value);
  requireThat(proto === Object.prototype || proto === null, 'INVALID_INPUT', 'Expected a plain object');
  return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  requireThat(Object.keys(value).every(k => allowed.includes(k)), 'INVALID_INPUT', 'Unknown parameter');
}
export function text(value: unknown, field: string, max = 512): string {
  requireThat(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value), 'INVALID_INPUT', 'Expected a bounded nonempty string', field);
  return value;
}
export function integer(value: unknown, field: string, min: number, max: number): number {
  requireThat(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max, 'INVALID_INPUT', `Expected integer ${min}..${max}`, field);
  return value;
}
function boundedInput(value: unknown): Record<string, unknown> {
  const v = object(value);
  try { requireThat(Buffer.byteLength(JSON.stringify(v)) <= 16384, 'INVALID_INPUT', 'Query exceeds 16 KiB'); }
  catch (e) { if (e instanceof GatewayError) throw e; throw new GatewayError('INVALID_INPUT', 'Expected JSON query'); }
  return v;
}
function validate(v: Record<string, unknown>): void {
  for (const k of ['rootCapabilityId', 'vertexId', 'capabilityId']) if (v[k] !== undefined) text(v[k], k, 4096);
  for (const k of ['agentId', 'version', 'groupId', 'keyword', 'status', 'developer']) if (v[k] !== undefined) text(v[k], k);
  for (const k of ['includeVersions', 'includeDescendants']) if (v[k] !== undefined) requireThat(typeof v[k] === 'boolean', 'INVALID_INPUT', 'Expected boolean', k);
  if (v.detail !== undefined) requireThat(v.detail === 'summary' || v.detail === 'full', 'INVALID_INPUT', 'Expected summary or full', 'detail');
  for (const [k, min, max] of [['limit', 1, 100], ['offset', 0, 2000], ['maxDepth', 0, 16], ['maxNodes', 1, 1000], ['maxEdges', 0, 3000]] as const) if (v[k] !== undefined) integer(v[k], k, min, max);
  if (v.expectedFingerprint !== undefined) requireThat(typeof v.expectedFingerprint === 'string' && /^[a-f0-9]{64}$/.test(v.expectedFingerprint), 'INVALID_INPUT', 'Expected fingerprint', 'expectedFingerprint');
  if (v.model !== undefined) {
    const m = object(v.model); keys(m, ['name', 'vendor']); text(m.name, 'model.name');
    if (m.vendor !== undefined) text(m.vendor, 'model.vendor');
  }
}
export function parseSnapshot(value: unknown): SnapshotOptions {
  const v = boundedInput(value); keys(v, ['rootCapabilityId', 'includeVersions', 'maxDepth', 'maxNodes', 'maxEdges', 'detail']); validate(v);
  return structuredClone(v) as SnapshotOptions;
}
export function parseRead(value: unknown): ReadQuery {
  const v = boundedInput(value);
  const common = ['kind', 'limit', 'offset', 'expectedFingerprint'];
  const allowed: Record<string, string[]> = {
    capability_tree: ['kind', 'rootCapabilityId', 'maxDepth', 'maxNodes', 'maxEdges', 'detail'],
    node: [...common, 'vertexId'], agents: [...common, 'agentId', 'capabilityId', 'includeDescendants', 'keyword', 'detail'],
    versions: [...common, 'agentId', 'version', 'detail'],
    candidates: [...common, 'capabilityId', 'includeDescendants', 'keyword', 'status', 'model', 'developer', 'detail'],
    field_groups: [...common, 'groupId'],
  };
  requireThat(typeof v.kind === 'string' && Object.hasOwn(allowed, v.kind), 'INVALID_INPUT', 'Unknown query kind', 'kind');
  keys(v, allowed[v.kind]!); validate(v);
  if (v.kind === 'node') text(v.vertexId, 'vertexId', 4096);
  if (v.kind === 'versions') text(v.agentId, 'agentId');
  return structuredClone(v) as unknown as ReadQuery;
}
export function parseTool(value: unknown): ToolRequest {
  const v = boundedInput(value);
  if (v.action === 'health') { keys(v, ['action']); return { action: 'health' }; }
  if (v.action === 'snapshot') { keys(v, ['action', 'options']); return { action: 'snapshot', options: parseSnapshot(v.options ?? {}) }; }
  requireThat(v.action === 'read', 'INVALID_INPUT', 'Unknown read action', 'action');
  keys(v, ['action', 'query']); return { action: 'read', query: parseRead(v.query) };
}
export function failure(error: unknown, signal?: AbortSignal): GatewayFailure {
  if (signal?.aborted) return { code: signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED', message: 'Read did not complete' };
  if (error instanceof GatewayError) return { code: error.code, message: error.message, ...(error.field ? { field: error.field } : {}) };
  return { code: 'DATABASE', message: 'Database read failed; check host configuration and database availability' };
}
