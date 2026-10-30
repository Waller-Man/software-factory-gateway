import { createHash } from 'node:crypto';
import type { Candidate, CandidateList, GatewayResult, GraphSnapshot, Health, Json, JsonField, NodeView, Page, ReadData, ReadQuery, ReadVertex, ResultMeta, SnapshotOptions, Warning } from './types.ts';
import type { GraphState, ReadTransport } from './transport.ts';
import { jsonProperties, properties } from './schema.ts';
import { GatewayError, failure, parseRead, parseSnapshot, requireThat } from './validation.ts';

export interface ReaderOptions { timeoutMs: number; healthTimeoutMs: number; maxConcurrent: number; resultBytes: number }
export const readerDefaults: ReaderOptions = { timeoutMs: 30000, healthTimeoutMs: 5000, maxConcurrent: 4, resultBytes: 1024 * 1024 };
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.entries(v).sort(([a], [b]) => compare(a, b)).map(([k, value]) => JSON.stringify(k) + ':' + canonical(value)).join(',') + '}';
  return JSON.stringify(v);
}
function fingerprint(state: GraphState, query: unknown): string {
  const normalized = { ...(query as Record<string, unknown>) };
  for (const k of ['offset', 'limit', 'expectedFingerprint']) delete normalized[k];
  return createHash('sha256').update(canonical({ query: normalized, vertices: [...state.vertices].sort((a, b) => compare(a.id, b.id)), edges: [...state.edges].sort((a, b) => compare(a.id, b.id)) })).digest('hex');
}
function meta(): ResultMeta { return { apiVersion: '1.0', observedAt: new Date().toISOString(), consistency: 'best-effort', fingerprint: '', complete: true, truncated: false, reasons: [], warnings: [], unknownCount: 0 }; }
function jsonField(v: ReadVertex, key: string): JsonField {
  if (!Object.hasOwn(v.properties, key)) return { state: 'missing' };
  try { return { state: 'parsed', value: JSON.parse(v.properties[key] as string) as Json }; }
  catch { return { state: 'invalid', error: 'Invalid JSON TEXT; original property is preserved' }; }
}
function view(v: ReadVertex, detail: 'summary' | 'full', m: ResultMeta): NodeView {
  const summary: Record<string, string[]> = { Capability: ['name'], Agent: ['agent_id', 'name'], AgentVersion: ['version', 'status', 'developer', 'invoke_kind', 'dsh_ref'], FieldGroup: ['group_id', 'name', 'display_order'] };
  const selected = detail === 'full' ? v.properties : Object.fromEntries(Object.entries(v.properties).filter(([key]) => summary[v.label]!.includes(key)));
  if (detail === 'summary') return { vertexId: v.id, label: v.label, detail, properties: selected };
  const fields: Record<string, JsonField> = {};
  for (const key of properties[v.label].filter(k => jsonProperties.includes(k))) {
    const parsed = jsonField(v, key); fields[key] = parsed;
    if (parsed.state === 'invalid') warn(m, { code: 'INVALID_JSON', message: 'Original JSON TEXT could not be parsed', vertexId: v.id, field: key });
  }
  return { vertexId: v.id, label: v.label, detail, properties: { ...selected }, missingFields: properties[v.label].filter(k => !Object.hasOwn(v.properties, k)), jsonFields: fields };
}
function warn(m: ResultMeta, warning: Warning): void {
  if (!m.warnings.some(w => w.code === warning.code && w.vertexId === warning.vertexId && w.field === warning.field)) m.warnings.push(warning);
}
function incomplete(m: ResultMeta, reason: string): void { m.complete = false; m.truncated = true; if (!m.reasons.includes(reason)) m.reasons.push(reason); }
function paginate<T>(rows: T[], query: { limit?: number; offset?: number }, m: ResultMeta): { items: T[]; page: Page } {
  const offset = query.offset ?? 0, limit = query.limit ?? 50, more = offset + limit < rows.length;
  return { items: rows.slice(offset, offset + limit), page: { offset, limit, total: rows.length, totalRelation: m.complete ? 'exact' : 'lower_bound', hasMore: more, nextOffset: more ? offset + limit : null } };
}
function sortNodes(rows: ReadVertex[]): ReadVertex[] {
  const key = (v: ReadVertex): string => String(v.properties.agent_id ?? v.properties.version ?? v.properties.group_id ?? v.properties.name ?? '');
  return rows.sort((a, b) => compare(key(a), key(b)) || compare(a.id, b.id));
}
function subtree(state: GraphState, id: string, descendants: boolean, maxDepth: number, m?: ResultMeta): Set<string> {
  requireThat(state.vertices.some(v => v.id === id && v.label === 'Capability'), 'NOT_FOUND', 'Capability not found', 'capabilityId');
  const ids = new Set([id]); let frontier = [id];
  if (!descendants) return ids;
  for (let depth = 0; frontier.length; depth++) {
    const next = [...new Set(state.edges.filter(e => e.label === 'HAS_CHILD' && frontier.includes(e.outV) && !ids.has(e.inV)).map(e => e.inV))].sort(compare);
    if (depth >= maxDepth && next.length) { if (m) incomplete(m, 'maxDepth'); else throw new GatewayError('LIMIT', 'Capability subtree exceeds maximum depth; filtering not completed'); break; }
    for (const node of next) ids.add(node); frontier = next;
  }
  return ids;
}
function graph(state: GraphState, options: SnapshotOptions, m: ResultMeta, treeOnly: boolean): GraphSnapshot {
  const roots = options.rootCapabilityId ? state.vertices.filter(v => v.id === options.rootCapabilityId && v.label === 'Capability') : state.vertices.filter(v => v.label === 'Capability' && v.properties.name === '软件工厂');
  requireThat(roots.length === 1, roots.length ? 'INVALID_INPUT' : 'NOT_FOUND', 'Specify one existing root capability', 'rootCapabilityId');
  const root = roots[0]!, ids = subtree(state, root.id, true, options.maxDepth ?? 8, m);
  const selected = [...ids].map(id => state.vertices.find(v => v.id === id)!);
  if (!treeOnly) {
    const agentIds = new Set(state.edges.filter(e => e.label === 'HAS_AGENT' && ids.has(e.outV)).map(e => e.inV));
    selected.push(...sortNodes(state.vertices.filter(v => agentIds.has(v.id))));
    if (options.includeVersions) {
      const versions = new Set(state.edges.filter(e => e.label === 'HAS_VERSION' && agentIds.has(e.outV)).map(e => e.inV));
      selected.push(...sortNodes(state.vertices.filter(v => versions.has(v.id))));
    }
  }
  const bounded = selected.slice(0, options.maxNodes ?? 500), visible = new Set(bounded.map(v => v.id));
  if (bounded.length < selected.length) incomplete(m, 'maxNodes');
  const allEdges = state.edges.filter(e => visible.has(e.outV) && visible.has(e.inV) && (!treeOnly || e.label === 'HAS_CHILD')).sort((a, b) => compare(a.id, b.id));
  const edges = allEdges.slice(0, options.maxEdges ?? 1500); if (edges.length < allEdges.length) incomplete(m, 'maxEdges');
  const nodes = bounded.map(v => view(v, options.detail ?? 'summary', m));
  const byLabel: Record<string, number> = {}; for (const v of nodes) byLabel[v.label] = (byLabel[v.label] ?? 0) + 1;
  return { rootCapabilityId: root.id, nodes, edges, stats: { nodes: nodes.length, edges: edges.length, byLabel, scope: 'returned' } };
}
const folded = (s: unknown): string => typeof s === 'string' ? s.trim().toLowerCase() : '';
function modelTokens(v: ReadVertex, m: ResultMeta): { tokens: string[]; models: { name: string; vendor?: string }[]; unknown: boolean } {
  const parsed = jsonField(v, 'model_dependencies_json');
  if (parsed.state === 'missing') return { tokens: [], models: [], unknown: false };
  if (parsed.state === 'parsed' && Array.isArray(parsed.value) && parsed.value.every(x => x && typeof x === 'object' && !Array.isArray(x) && typeof x.name === 'string' && (x.vendor === undefined || typeof x.vendor === 'string'))) {
    const models = parsed.value as { name: string; vendor?: string }[];
    return { models, tokens: models.flatMap(x => [x.name, x.vendor ?? '']), unknown: false };
  }
  warn(m, { code: parsed.state === 'invalid' ? 'INVALID_JSON' : 'JSON_SHAPE', message: 'Model declaration cannot be used for filtering', vertexId: v.id, field: 'model_dependencies_json' });
  return { tokens: [], models: [], unknown: true };
}
function categoryTokens(v: ReadVertex, m: ResultMeta): { tokens: string[]; unknown: boolean } {
  const p = jsonField(v, 'object_categories_json');
  if (p.state === 'missing') return { tokens: [], unknown: false };
  if (p.state === 'parsed' && Array.isArray(p.value) && p.value.every(x => typeof x === 'string')) return { tokens: p.value as string[], unknown: false };
  warn(m, { code: p.state === 'invalid' ? 'INVALID_JSON' : 'JSON_SHAPE', message: 'Object categories cannot be used for keyword filtering', vertexId: v.id, field: 'object_categories_json' });
  return { tokens: [], unknown: true };
}

/** All three host entry points delegate to this core. No transport is published. */
export class Reader {
  #lifetime = new AbortController(); #active = 0;
  constructor(private readonly transport: ReadTransport | undefined, private readonly configFailure?: string, private readonly options: ReaderOptions = readerDefaults) {}
  dispose(): void { this.#lifetime.abort(); this.transport?.dispose(); }
  private async run<T>(signal: AbortSignal | undefined, timeout: number, work: (combined: AbortSignal, m: ResultMeta) => Promise<T>): Promise<GatewayResult<T>> {
    const combined = AbortSignal.any([this.#lifetime.signal, ...(signal ? [signal] : []), AbortSignal.timeout(timeout)]);
    if (this.#active >= this.options.maxConcurrent) return { ok: false, error: { code: 'BUSY', message: 'Read concurrency limit reached; try later' } };
    this.#active++;
    try {
      combined.throwIfAborted(); const m = meta(); const data = await work(combined, m); combined.throwIfAborted();
      const result: GatewayResult<T> = { ok: true, data, meta: m };
      requireThat(Buffer.byteLength(JSON.stringify(result)) <= this.options.resultBytes, 'LIMIT', 'Public result exceeds byte limit; request summary or a smaller page');
      return result;
    } catch (e) { return { ok: false, error: failure(e, combined) }; }
    finally { this.#active--; }
  }
  private client(): ReadTransport { requireThat(this.transport, 'CONFIG', this.configFailure ?? 'Fill the plugin .env locally, then re-enable the plugin'); return this.transport; }
  health(signal?: AbortSignal): Promise<GatewayResult<Health>> {
    return this.run(signal, this.options.healthTimeoutMs, async (s, m) => {
      const h: Health = { apiVersion: '1.0', gatewayVersion: '0.1.1', ready: false, connection: 'not_checked', schema: 'unknown' };
      try { await this.client().schema(s); h.ready = true; h.connection = 'reachable'; h.schema = 'compatible'; }
      catch (e) {
        s.throwIfAborted(); const diagnostic = failure(e, s); h.diagnostic = diagnostic;
        if (diagnostic.code === 'SCHEMA') { h.connection = 'reachable'; h.schema = 'incompatible'; }
        else if (diagnostic.code !== 'CONFIG') h.connection = 'unreachable';
      }
      m.fingerprint = fingerprint({ vertices: [], edges: [] }, h); return h;
    });
  }
  snapshot(options: SnapshotOptions, signal?: AbortSignal): Promise<GatewayResult<GraphSnapshot>> {
    return this.run(signal, this.options.timeoutMs, async (s, m) => {
      const parsed = parseSnapshot(options); const state = await this.client().scan(s, parsed.includeVersions ?? false);
      m.fingerprint = fingerprint(state, parsed); return graph(state, parsed, m, false);
    });
  }
  read(query: ReadQuery, signal?: AbortSignal): Promise<GatewayResult<ReadData>> {
    return this.run(signal, this.options.timeoutMs, async (s, m) => {
      const q = parseRead(query), state = await this.client().scan(s, q.kind !== 'capability_tree');
      m.fingerprint = fingerprint(state, q);
      if ('expectedFingerprint' in q && q.expectedFingerprint) requireThat(q.expectedFingerprint === m.fingerprint, 'DATA_CHANGED', 'Data or query changed; restart pagination');
      if (q.kind === 'capability_tree') return graph(state, q, m, true);
      if (q.kind === 'node') {
        const v = state.vertices.find(v => v.id === q.vertexId); requireThat(v, 'NOT_FOUND', 'Vertex not found', 'vertexId');
        const all = [...new Map(state.edges.filter(e => e.outV === v.id || e.inV === v.id).map(e => [e.id, e])).values()].sort((a, b) => compare(a.id, b.id));
        const page = paginate(all, q, m), ids = new Set(page.items.flatMap(e => [e.outV, e.inV])); ids.delete(v.id);
        return { kind: 'node', node: view(v, 'full', m), relations: page.items, neighbors: sortNodes(state.vertices.filter(x => ids.has(x.id))).map(x => view(x, 'summary', m)), page: page.page };
      }
      if (q.kind === 'field_groups') {
        const rows = state.vertices.filter(v => v.label === 'FieldGroup' && (!q.groupId || v.properties.group_id === q.groupId)).sort((a, b) => Number(a.properties.display_order) - Number(b.properties.display_order) || compare(String(a.properties.group_id), String(b.properties.group_id)) || compare(a.id, b.id));
        const p = paginate(rows, q, m); const items = p.items.map(v => view(v, 'full', m));
        if (!q.groupId) {
          const valid = rows.every(v => { const f = jsonField(v, 'fields_json'); return f.state === 'parsed' && Array.isArray(f.value); });
          if (rows.length !== 8 || !valid) warn(m, { code: 'FIELD_METADATA', message: 'Stored field groups are incomplete or malformed; no definitions were invented' });
        }
        return { kind: 'field_groups', items, page: p.page };
      }
      const detail = q.detail ?? 'summary';
      let agents = sortNodes(state.vertices.filter(v => v.label === 'Agent'));
      if ('agentId' in q && q.agentId) agents = agents.filter(a => a.properties.agent_id === q.agentId);
      if ('capabilityId' in q && q.capabilityId) {
        const caps = subtree(state, q.capabilityId, q.includeDescendants ?? true, 16);
        const ids = new Set(state.edges.filter(e => e.label === 'HAS_AGENT' && caps.has(e.outV)).map(e => e.inV)); agents = agents.filter(v => ids.has(v.id));
      }
      if (q.kind === 'agents') {
        if (q.keyword) agents = agents.filter(a => ['agent_id', 'name', 'description'].some(k => folded(a.properties[k]).includes(folded(q.keyword))));
        const p = paginate(agents, q, m); return { kind: 'agents', items: p.items.map(v => view(v, detail, m)), page: p.page };
      }
      if (q.kind === 'versions') {
        requireThat(agents.length === 1, agents.length ? 'DATABASE' : 'NOT_FOUND', 'Agent identity is missing or ambiguous', 'agentId');
        const ids = new Set(state.edges.filter(e => e.label === 'HAS_VERSION' && e.outV === agents[0]!.id).map(e => e.inV));
        const rows = sortNodes(state.vertices.filter(v => ids.has(v.id) && (!q.version || v.properties.version === q.version)));
        const p = paginate(rows, q, m); return { kind: 'versions', items: p.items.map(v => view(v, detail, m)), page: p.page };
      }
      const rows: { agent: ReadVertex; version: ReadVertex }[] = [];
      for (const a of agents) for (const edge of state.edges.filter(e => e.label === 'HAS_VERSION' && e.outV === a.id)) {
        const v = state.vertices.find(v => v.id === edge.inV)!;
        requireThat(state.edges.filter(e => e.label === 'HAS_VERSION' && e.inV === v.id).length === 1, 'DATABASE', 'Version has ambiguous Agent ownership');
        if (q.status && v.properties.status !== q.status) continue;
        if (q.developer && !(String(v.properties.developer ?? '').split('、').map(x => x.trim()).includes(q.developer.trim()))) continue;
        let uncertain = false;
        const models = q.model || q.keyword ? modelTokens(v, m) : { tokens: [], models: [], unknown: false };
        if (q.model) {
          if (models.unknown) uncertain = true;
          else if (!models.models.some(x => folded(x.name) === folded(q.model!.name) && (!q.model!.vendor || folded(x.vendor) === folded(q.model!.vendor)))) continue;
        }
        if (q.keyword) {
          const keyword = folded(q.keyword), categories = categoryTokens(v, m);
          const tokens = [a.properties.agent_id, a.properties.name, a.properties.description, v.properties.description, v.properties.version, v.properties.developer, v.properties.dsh_ref, ...models.tokens, ...categories.tokens];
          if (!tokens.some(x => folded(x).includes(keyword))) { if (models.unknown || categories.unknown) uncertain = true; else continue; }
        }
        if (uncertain) { m.complete = false; m.unknownCount++; if (!m.reasons.includes('filter_unknown')) m.reasons.push('filter_unknown'); continue; }
        rows.push({ agent: a, version: v });
      }
      rows.sort((a, b) => compare(String(a.agent.properties.agent_id), String(b.agent.properties.agent_id)) || compare(String(a.version.properties.version), String(b.version.properties.version)) || compare(a.version.id, b.version.id));
      const p = paginate(rows, q, m), items: Candidate[] = p.items.map(r => ({ agent: view(r.agent, detail, m), version: view(r.version, detail, m) }));
      return { kind: 'candidates', items, page: p.page } satisfies CandidateList;
    });
  }
}
