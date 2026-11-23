/** No method/body/path passthrough, no writer, and no Gremlin implementation. */
import type { Json, ReadEdge, ReadVertex, VertexLabel, EdgeLabel, FactoryConfigData } from './types.ts';
import { FACTORY_CONFIG_ID, missingFactoryConfig, invalidFactoryConfig, factoryConfigValue } from './factory-config.ts';
import { edgeTypes, properties, verifySchema } from './schema.ts';
import { GatewayError, requireThat } from './validation.ts';

export interface Connection { baseUrl: string; graph: string; graphSpace?: string; username: string; password: string }
export interface Limits { requestTimeoutMs: number; maxRequests: number; maxScanNodes: number; maxScanEdges: number; maxScanBytes: number }
export const defaultLimits: Limits = { requestTimeoutMs: 10000, maxRequests: 256, maxScanNodes: 2000, maxScanEdges: 5000, maxScanBytes: 8 * 1024 * 1024 };
export interface GraphState { vertices: ReadVertex[]; edges: ReadEdge[] }
export interface ReadTransport { schema(signal: AbortSignal): Promise<void>; scan(signal: AbortSignal, includeVersions?: boolean): Promise<GraphState>; factoryConfig(signal: AbortSignal): Promise<FactoryConfigData>; dispose(): void }

export class ReadClient implements ReadTransport {
  #base: string;
  #authorization: string;
  constructor(config: Connection, private readonly limits: Limits = defaultLimits, private readonly fetcher: typeof fetch = fetch) {
    let origin: URL;
    try { origin = new URL(config.baseUrl); } catch { throw new GatewayError('CONFIG', 'Invalid database origin'); }
    requireThat(['http:', 'https:'].includes(origin.protocol) && !origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash, 'CONFIG', 'Database URL must be an HTTP(S) origin');
    requireThat(origin.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname), 'CONFIG', 'Remote database requires HTTPS');
    for (const v of [config.graph, ...(config.graphSpace ? [config.graphSpace] : [])]) requireThat(/^[A-Za-z0-9_-]+$/.test(v) && !v.startsWith('__'), 'CONFIG', 'Invalid graph or graphspace');
    this.#base = origin.origin + (config.graphSpace ? '/graphspaces/' + encodeURIComponent(config.graphSpace) : '') + '/graphs/' + encodeURIComponent(config.graph);
    this.#authorization = 'Basic ' + Buffer.from(config.username + ':' + config.password).toString('base64');
  }
  dispose(): void { this.#authorization = ''; }
  private async get(path: string, signal: AbortSignal, budget: { requests: number; bytes: number }, allowMissing = false): Promise<Record<string, unknown>> {
    signal.throwIfAborted();
    requireThat(this.#authorization, 'CANCELLED', 'Reader has been disposed');
    requireThat(++budget.requests <= this.limits.maxRequests, 'LIMIT', 'Database request budget exceeded; scan incomplete');
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(this.limits.requestTimeoutMs)]);
    let response: Response;
    try { response = await this.fetcher(this.#base + path, { method: 'GET', headers: { Authorization: this.#authorization }, redirect: 'error', signal: requestSignal }); }
    catch { if (requestSignal.aborted) throw new GatewayError(requestSignal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED', 'Database request did not complete'); throw new GatewayError('DATABASE', 'Cannot connect to configured database'); }
    if (!response.ok) { await response.body?.cancel(); if (allowMissing && response.status === 404) throw new GatewayError('NOT_FOUND', 'Fixed public configuration node is absent'); throw new GatewayError('DATABASE', `Database returned HTTP ${response.status}`); }
    const reader = response.body?.getReader(); requireThat(reader, 'DATABASE', 'Missing database response');
    let bytes = 0; const chunks: Uint8Array[] = [];
    try {
      while (true) {
        requestSignal.throwIfAborted(); const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength; budget.bytes += chunk.value.byteLength;
        requireThat(bytes <= 2 * 1024 * 1024 && budget.bytes <= this.limits.maxScanBytes, 'LIMIT', 'Database response byte budget exceeded; scan incomplete'); chunks.push(chunk.value);
      }
    } catch (e) { if (requestSignal.aborted) throw new GatewayError(requestSignal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED', 'Database response did not complete'); throw e; }
    finally { await reader.cancel().catch(() => {}); }
    let raw: unknown;
    try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new GatewayError('DATABASE', 'Database returned invalid JSON'); }
    requireThat(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'DATABASE', 'Invalid database response');
    return raw as Record<string, unknown>;
  }
  async schema(signal: AbortSignal): Promise<void> { verifySchema(await this.get('/schema', signal, { requests: 0, bytes: 0 })); }
  async factoryConfig(signal: AbortSignal): Promise<FactoryConfigData> {
    const budget = { requests: 0, bytes: 0 }, schema = await this.get('/schema', signal, budget);
    requireThat(Array.isArray(schema.vertexlabels) && Array.isArray(schema.propertykeys), 'SCHEMA', 'Database Schema cannot be read');
    const labels = (schema.vertexlabels as Record<string, unknown>[]).filter(v => v?.name === 'FactoryConfig');
    if (!labels.length) return missingFactoryConfig('schema');
    const keys = (schema.propertykeys as Record<string, unknown>[]).filter(v => v?.name === 'dataset_root');
    if (labels.length !== 1 || !Array.isArray(labels[0]!.properties) || !labels[0]!.properties.includes('dataset_root') || keys.length !== 1 || keys[0]!.data_type !== 'TEXT' || keys[0]!.cardinality !== 'SINGLE') return invalidFactoryConfig();
    let raw: Record<string, unknown>;
    try { raw = await this.get('/graph/vertices/' + encodeURIComponent(JSON.stringify(FACTORY_CONFIG_ID)), signal, budget, true); }
    catch (error) { if (error instanceof GatewayError && error.code === 'NOT_FOUND') return missingFactoryConfig('node'); throw error; }
    if (raw.id !== FACTORY_CONFIG_ID || raw.label !== 'FactoryConfig' || !raw.properties || typeof raw.properties !== 'object' || Array.isArray(raw.properties)) return invalidFactoryConfig();
    return factoryConfigValue((raw.properties as Record<string, unknown>).dataset_root);
  }
  async scan(signal: AbortSignal, includeVersions = true): Promise<GraphState> {
    const budget = { requests: 0, bytes: 0 };
    verifySchema(await this.get('/schema', signal, budget));
    const vertices: ReadVertex[] = [], edges: ReadEdge[] = [];
    const collect = async (resource: 'vertices' | 'edges', label: VertexLabel | EdgeLabel, sourceId?: string): Promise<void> => {
      const seen = new Set<string>(); let page = '';
      do {
        const params = new URLSearchParams({ label, limit: '100', page, ...(sourceId === undefined ? {} : { vertex_id: JSON.stringify(sourceId), direction: 'OUT' }) });
        const result = await this.get('/graph/' + resource + '?' + params, signal, budget);
        requireThat(Array.isArray(result[resource]), 'DATABASE', 'Missing database collection');
        for (const item of result[resource]) {
          const v = item as Record<string, unknown>;
          requireThat(v && typeof v.id === 'string' && v.id.length <= 4096 && v.label === label && v.properties !== null && typeof v.properties === 'object' && !Array.isArray(v.properties), 'DATABASE', 'Invalid graph record');
          if (resource === 'vertices') {
            const allowed = properties[label as VertexLabel]; const raw = v.properties as Record<string, Json>;
            const selected = Object.fromEntries(Object.entries(raw).filter(([key]) => allowed.includes(key)));
            requireThat(Object.entries(selected).every(([key, value]) => key === 'display_order' ? typeof value === 'number' && Number.isSafeInteger(value) : typeof value === 'string'), 'DATABASE', 'Unexpected property storage in graph record');
            vertices.push({ id: v.id, label: label as VertexLabel, properties: selected });
          } else {
            const [from, to] = edgeTypes[label as EdgeLabel];
            requireThat(v.outV === sourceId && v.outVLabel === from && v.inVLabel === to && typeof v.inV === 'string', 'DATABASE', 'Invalid relationship endpoints');
            edges.push({ id: v.id, label: label as EdgeLabel, outV: v.outV as string, inV: v.inV, outVLabel: from, inVLabel: to });
          }
          requireThat(vertices.length <= this.limits.maxScanNodes && edges.length <= this.limits.maxScanEdges, 'LIMIT', 'Graph scan budget exceeded; no complete query result available');
        }
        requireThat(result.page === undefined || result.page === null || typeof result.page === 'string', 'DATABASE', 'Invalid database page token');
        page = typeof result.page === 'string' ? result.page : '';
        requireThat(page.length <= 8192 && (!page || !seen.has(page)), 'DATABASE', 'Invalid or repeated database page token'); seen.add(page);
      } while (page);
    };
    for (const label of Object.keys(properties) as VertexLabel[]) if (includeVersions || label !== 'AgentVersion') await collect('vertices', label);
    for (const [label, [source]] of Object.entries(edgeTypes) as [EdgeLabel, readonly [VertexLabel, VertexLabel]][]) {
      if (!includeVersions && label === 'HAS_VERSION') continue;
      for (const v of vertices.filter(v => v.label === source)) await collect('edges', label, v.id);
    }
    const byId = new Map(vertices.map(v => [v.id, v]));
    requireThat(byId.size === vertices.length && new Set(edges.map(e => e.id)).size === edges.length, 'DATABASE', 'Duplicate graph identity');
    requireThat(edges.every(e => byId.get(e.outV)?.label === e.outVLabel && byId.get(e.inV)?.label === e.inVLabel), 'DATABASE', 'Relationship endpoint missing; graph may have changed during read');
    signal.throwIfAborted(); return { vertices, edges };
  }
}
