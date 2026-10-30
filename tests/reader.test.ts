import test from 'node:test';
import assert from 'node:assert/strict';
import { Reader, readerDefaults } from '../src/reader.ts';
import { ReadClient, defaultLimits } from '../src/transport.ts';
import type { GraphState, ReadTransport } from '../src/transport.ts';
import type { Json, ReadQuery, VertexLabel, GatewayResult } from '../src/types.ts';
import { edgeTypes, properties } from '../src/schema.ts';
import { parseTool } from '../src/validation.ts';

export function fixture(): GraphState {
  const vertices: GraphState['vertices'] = [
    { id: 'root', label: 'Capability', properties: { name: '软件工厂' } },
    { id: 'child', label: 'Capability', properties: { name: '需求' } },
    { id: 'native:a', label: 'Agent', properties: { agent_id: 'agent:a', name: '补全', description: '需求分析' } },
    { id: 'native:b', label: 'Agent', properties: { agent_id: 'agent:b', name: '拆分', description: '需求预处理' } },
    { id: 'v:a', label: 'AgentVersion', properties: { version: 'v2.0', status: 'enabled', developer: '甲、乙', invoke_kind: 'dsh_tool', dsh_ref: 'example_tool', input_schema: '{"description":"需求","x-required":true}', output_schema: '{"description":"文档"}', model_dependencies_json: '[{"vendor":"Example","name":"model-a"}]', object_categories_json: '["DOCX"]', intermediate_artifacts_json: '[{"name":"中间材料","extension":"json"}]' } },
    { id: 'v:b', label: 'AgentVersion', properties: { version: '0.2.0', status: 'able', input_schema: '{}', output_schema: '{}', model_dependencies_json: 'broken JSON' } },
    ...Array.from({ length: 8 }, (_, i) => ({ id: 'g:' + i, label: 'FieldGroup' as VertexLabel, properties: { group_id: 'g' + i, name: '组' + i, display_order: i, fields_json: JSON.stringify(Array.from({ length: i < 3 ? 3 : 2 }, (_, j) => ({ field_id: `f${i}:${j}` }))) } })),
  ];
  const edges: GraphState['edges'] = [
    { id: 'e:child', label: 'HAS_CHILD', outV: 'root', inV: 'child', outVLabel: 'Capability', inVLabel: 'Capability' },
    { id: 'e:a', label: 'HAS_AGENT', outV: 'child', inV: 'native:a', outVLabel: 'Capability', inVLabel: 'Agent' },
    { id: 'e:b', label: 'HAS_AGENT', outV: 'root', inV: 'native:b', outVLabel: 'Capability', inVLabel: 'Agent' },
    { id: 'e:va', label: 'HAS_VERSION', outV: 'native:a', inV: 'v:a', outVLabel: 'Agent', inVLabel: 'AgentVersion' },
    { id: 'e:vb', label: 'HAS_VERSION', outV: 'native:b', inV: 'v:b', outVLabel: 'Agent', inVLabel: 'AgentVersion' },
  ]; return { vertices, edges };
}
export function schema(): unknown {
  return {
    vertexlabels: Object.entries(properties).map(([name, fields]) => ({ name, properties: [...fields, ...(name === 'Capability' ? ['selection_policy_json'] : [])] })),
    propertykeys: [...new Set(Object.values(properties).flat())].map(name => ({ name, data_type: name === 'display_order' ? 'INT' : 'TEXT', cardinality: 'SINGLE' })),
    edgelabels: Object.entries(edgeTypes).map(([name, [source_label, target_label]]) => ({ name, source_label, target_label })),
  };
}
function memory(state = fixture()): ReadTransport { return { schema: async () => {}, scan: async () => structuredClone(state), dispose() {} }; }
function success<T>(r: GatewayResult<T>): Extract<GatewayResult<T>, { ok: true }> { assert.equal(r.ok, true, JSON.stringify(r)); if (!r.ok) throw new Error('expected success'); return r; }

test('independent version descriptions survive fixed GET reads, keyword filtering and missing fields; nineteen metadata fields are accepted', async () => {
  const state = fixture(); state.vertices.find(v => v.id === 'v:a')!.properties.description = '仅此版本支持离线批处理';
  let writes = 0;
  const client = new ReadClient({ baseUrl: 'http://127.0.0.1:18080', graph: 'hugegraph', graphSpace: 'DEFAULT', username: 'synthetic', password: 'synthetic' }, defaultLimits, async (input, init) => {
    if (init?.method !== 'GET') writes++;
    const url = new URL(String(input));
    if (url.pathname.endsWith('/schema')) return Response.json(schema());
    if (url.pathname.endsWith('/vertices')) return Response.json({ vertices: state.vertices.filter(v => v.label === url.searchParams.get('label')), page: null });
    const source = JSON.parse(url.searchParams.get('vertex_id')!);
    return Response.json({ edges: state.edges.filter(e => e.label === url.searchParams.get('label') && e.outV === source).map(e => ({ ...e, properties: {} })), page: null });
  });
  const reader = new Reader(client);
  try {
    const result = success(await reader.read({ kind: 'candidates', keyword: '离线批处理', detail: 'full' }));
    assert.ok('kind' in result.data && result.data.kind === 'candidates'); if (!('kind' in result.data) || result.data.kind !== 'candidates') return;
    assert.equal(result.data.items.length, 1);
    assert.equal(result.data.items[0]!.agent.properties.description, '需求分析');
    assert.equal(result.data.items[0]!.version.properties.description, '仅此版本支持离线批处理');
    const missing = success(await reader.read({ kind: 'node', vertexId: 'v:b' }));
    assert.ok('kind' in missing.data && missing.data.kind === 'node'); if (!('kind' in missing.data) || missing.data.kind !== 'node') return;
    assert.ok(!Object.hasOwn(missing.data.node.properties, 'description'));
    assert.ok(missing.data.node.missingFields!.includes('description'));
    const groups = success(await reader.read({ kind: 'field_groups' })); assert.ok(!groups.meta.warnings.some(w => w.code === 'FIELD_METADATA'));
    const summary = success(await reader.read({ kind: 'versions', agentId: 'agent:a' }));
    assert.ok('items' in summary.data && !Object.hasOwn((summary.data.items[0] as any).properties, 'description'));
    const agentSearch = success(await reader.read({ kind: 'agents', keyword: '离线批处理' })); assert.ok('items' in agentSearch.data && agentSearch.data.items.length === 0);
    assert.equal(writes, 0);
  } finally { reader.dispose(); }
});

test('field metadata reads actual arrays without a fixed field-count gate', async () => {
  const state = fixture(), group = state.vertices.find(v => v.label === 'FieldGroup')!;
  group.properties.fields_json = '[]';
  const reader = new Reader(memory(state));
  try {
    const result = success(await reader.read({ kind: 'field_groups' }));
    assert.ok(!result.meta.warnings.some(w => w.code === 'FIELD_METADATA'));
    assert.ok('items' in result.data && result.data.items.length === 8);
  } finally { reader.dispose(); }
});

test('agents, descendants, pagination, fingerprint change and business/native identities', async () => {
  const state = fixture(), reader = new Reader(memory(state));
  const first = success(await reader.read({ kind: 'agents', capabilityId: 'root', limit: 1 }));
  assert.ok('items' in first.data); if (!('items' in first.data)) return;
  assert.equal(first.data.items.length, 1); assert.equal(first.data.page.total, 2); assert.equal(first.data.page.nextOffset, 1); assert.equal(first.meta.truncated, false);
  const next = success(await reader.read({ kind: 'agents', capabilityId: 'root', limit: 1, offset: 1, expectedFingerprint: first.meta.fingerprint }));
  assert.ok('items' in next.data); if (!('items' in next.data)) return;
  assert.equal(next.data.items[0] && 'vertexId' in next.data.items[0] ? next.data.items[0].vertexId : '', 'native:b');
  const direct = success(await reader.read({ kind: 'agents', capabilityId: 'root', includeDescendants: false })); assert.ok('items' in direct.data && direct.data.items.length === 1);
  state.vertices[2]!.properties.name = '已修改';
  const changed = await reader.read({ kind: 'agents', capabilityId: 'root', expectedFingerprint: first.meta.fingerprint }); assert.ok(!changed.ok && changed.error.code === 'DATA_CHANGED');
  const versions = success(await reader.read({ kind: 'versions', agentId: 'agent:a', version: 'v2.0' })); assert.ok('items' in versions.data && versions.data.items.length === 1);
  const wrong = await reader.read({ kind: 'versions', agentId: 'native:a' }); assert.ok(!wrong.ok && wrong.error.code === 'NOT_FOUND');
});
test('candidate filters are version facts, ANDed, literal keyword and exact developer/model', async () => {
  const reader = new Reader(memory());
  const r = success(await reader.read({ kind: 'candidates', capabilityId: 'root', keyword: 'docx', status: 'enabled', model: { name: 'MODEL-A', vendor: 'example' }, developer: '乙' }));
  assert.ok('items' in r.data && r.data.items.length === 1);
  const no = success(await reader.read({ kind: 'candidates', developer: '甲、乙' })); assert.ok('items' in no.data && no.data.items.length === 0);
  const partial = success(await reader.read({ kind: 'candidates', model: { name: 'does-not-exist' } }));
  assert.equal(partial.meta.complete, false); assert.equal(partial.meta.unknownCount, 1); assert.equal(partial.meta.truncated, false);
  assert.ok('page' in partial.data && partial.data.page.totalRelation === 'lower_bound');
  const literal = success(await reader.read({ kind: 'agents', keyword: '.*' })); assert.ok('items' in literal.data && literal.data.items.length === 0);
});
test('full node preserves raw declarations and JSON errors/missing, summary is distinct', async () => {
  const reader = new Reader(memory());
  const good = success(await reader.read({ kind: 'node', vertexId: 'v:a' })); assert.ok('node' in good.data); if (!('node' in good.data)) return;
  assert.equal(good.data.node.properties.input_schema, fixture().vertices[4]!.properties.input_schema);
  assert.equal(good.data.node.jsonFields?.input_schema?.state, 'parsed');
  assert.ok(good.data.node.missingFields?.includes('performance_evidence_json'));
  assert.ok(good.data.node.properties.developer); assert.ok(good.data.node.properties.intermediate_artifacts_json);
  const bad = success(await reader.read({ kind: 'node', vertexId: 'v:b' })); assert.ok('node' in bad.data && bad.data.node.jsonFields?.model_dependencies_json?.state === 'invalid');
  assert.ok(bad.meta.warnings.some(w => w.code === 'INVALID_JSON'));
  const summary = success(await reader.read({ kind: 'versions', agentId: 'agent:a' }));
  assert.ok('items' in summary.data && !('missingFields' in summary.data.items[0]!));
});
test('node relations paginate together; snapshot/tree limits are explicit with no dangling edges', async () => {
  const reader = new Reader(memory());
  const node = success(await reader.read({ kind: 'node', vertexId: 'native:a', limit: 1 })); assert.ok('relations' in node.data && node.data.relations.length === 1 && node.data.neighbors.length === 1 && node.data.page.total === 2);
  const tree = success(await reader.read({ kind: 'capability_tree', maxDepth: 0 }));
  assert.ok('nodes' in tree.data && tree.data.nodes.length === 1); assert.ok(tree.meta.truncated && tree.meta.reasons.includes('maxDepth'));
  const snap = success(await reader.snapshot({ includeVersions: true, maxNodes: 4, maxEdges: 1 }));
  const ids = new Set(snap.data.nodes.map(v => v.vertexId)); assert.ok(snap.data.edges.every(e => ids.has(e.inV) && ids.has(e.outV)));
  assert.ok(snap.meta.truncated && snap.meta.reasons.includes('maxNodes') && snap.meta.reasons.includes('maxEdges'));
  const noVersions = success(await reader.snapshot({})); assert.ok(noVersions.data.nodes.every(v => v.label !== 'AgentVersion' && v.label !== 'FieldGroup'));
  const groups = success(await reader.read({ kind: 'field_groups' })); assert.ok('items' in groups.data && groups.data.items.length === 8); assert.equal(groups.meta.warnings.length, 0);
});
test('all service and Tool parsers reject transport/writes/invalid pagination before DB calls', async () => {
  let reads = 0; const transport = memory(); transport.scan = async () => { reads++; return fixture(); }; const reader = new Reader(transport);
  for (const input of [{ kind: 'gremlin', script: 'g.V().drop()' }, { kind: 'agents', url: 'http://example.invalid' }, { kind: 'node' }, { kind: 'agents', limit: 101 }, { kind: 'agents', offset: -1 }, { kind: 'candidates', model: { name: 'x', password: 'x' } }, { kind: 'agents', write: true }, { kind: 'agents', credentials: {} }]) assert.equal((await reader.read(input as ReadQuery)).ok, false);
  assert.equal(reads, 0);
  assert.throws(() => parseTool({ action: 'write' })); assert.throws(() => parseTool({ action: 'health', password: 'x' }));
  assert.equal((await reader.snapshot({ baseUrl: 'http://example.invalid' } as never)).ok, false);
  assert.equal(reads, 0);
});
test('cancellation, timeout, disposal, BUSY and public byte limit', async () => {
  const block: ReadTransport = { schema: async () => {}, scan: signal => new Promise((_, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }), dispose() {} };
  const reader = new Reader(block, undefined, { ...readerDefaults, timeoutMs: 25, maxConcurrent: 1 });
  const waiting = reader.read({ kind: 'agents' });
  const busy = await reader.read({ kind: 'agents' }); assert.ok(!busy.ok && busy.error.code === 'BUSY');
  // Keep Node alive while an unref'd AbortSignal timeout is being tested.
  const keepAlive = setInterval(() => {}, 1000);
  try { const timeout = await waiting; assert.ok(!timeout.ok && timeout.error.code === 'TIMEOUT'); } finally { clearInterval(keepAlive); }
  const controller = new AbortController(); const cancelled = reader.read({ kind: 'agents' }, controller.signal); controller.abort();
  const c = await cancelled; assert.ok(!c.ok && c.error.code === 'CANCELLED');
  const pending = reader.read({ kind: 'agents' }); reader.dispose(); const disposed = await pending; assert.ok(!disposed.ok && disposed.error.code === 'CANCELLED');
  const large = await new Reader(memory(), undefined, { ...readerDefaults, resultBytes: 100 }).snapshot({ includeVersions: true, detail: 'full' }); assert.ok(!large.ok && large.error.code === 'LIMIT');
});
test('missing credentials keeps explicit health available; Schema failure is separate', async () => {
  const health = success(await new Reader(undefined).health()); assert.equal(health.data.ready, false); assert.equal(health.data.connection, 'not_checked');
  const absent = await new Reader(undefined).read({ kind: 'agents' }); assert.ok(!absent.ok && absent.error.code === 'CONFIG');
});
test('fixed GET transport follows database pages, adjacency and rejects repeats/scan limits', async () => {
  const state = fixture(), requests: URL[] = [], methods: string[] = [];
  let repeated = false;
  const fake: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); requests.push(url); methods.push(init?.method ?? '');
    assert.equal(init?.redirect, 'error'); assert.equal(init?.body, undefined);
    if (url.pathname.endsWith('/schema')) return Response.json(schema());
    const resource = url.pathname.endsWith('/vertices') ? 'vertices' : 'edges';
    const rows = state[resource].filter(v => v.label === url.searchParams.get('label') && (resource === 'vertices' || ('outV' in v && v.outV === JSON.parse(url.searchParams.get('vertex_id')!))));
    const offset = Number(url.searchParams.get('page') || 0), next = offset + 1 < rows.length ? String(offset + 1) : null;
    return Response.json({ [resource]: rows.slice(offset, offset + 1).map(v => ({ ...v, properties: 'properties' in v ? v.properties : {} })), page: repeated ? 'repeat' : next });
  };
  const connection = { baseUrl: 'http://127.0.0.1:18080', graphSpace: 'DEFAULT', graph: 'hugegraph', username: 'mock', password: 'mock-secret' };
  const client = new ReadClient(connection, defaultLimits, fake);
  const actual = await client.scan(new AbortController().signal); assert.equal(actual.vertices.length, state.vertices.length); assert.equal(actual.edges.length, state.edges.length);
  assert.ok(methods.every(m => m === 'GET')); assert.ok(requests.every(u => /^\/graphspaces\/DEFAULT\/graphs\/hugegraph\/(schema|graph\/(vertices|edges))$/.test(u.pathname)));
  assert.ok(requests.filter(u => u.pathname.endsWith('/edges')).every(u => u.searchParams.has('vertex_id') && u.searchParams.get('direction') === 'OUT'));
  repeated = true; await assert.rejects(client.scan(new AbortController().signal), /page token/); repeated = false;
  await assert.rejects(new ReadClient(connection, { ...defaultLimits, maxScanNodes: 2 }, fake).scan(new AbortController().signal), /budget/);
  client.dispose(); await assert.rejects(client.schema(new AbortController().signal), /disposed/);
  assert.throws(() => new ReadClient({ ...connection, baseUrl: 'http://example.invalid' }), /HTTPS/);
  assert.throws(() => new ReadClient({ ...connection, baseUrl: 'http://127.0.0.1:18080/gremlin' }), /origin/);
});
test('HTTP errors never echo upstream secrets and storage ignores retired properties', async () => {
  const config = { baseUrl: 'http://127.0.0.1:18080', graph: 'hugegraph', username: 'mock', password: 'private' };
  const client = new ReadClient(config, defaultLimits, async () => new Response('private credentials fragment', { status: 401 }));
  await assert.rejects(client.schema(new AbortController().signal), e => e instanceof Error && e.message.includes('401') && !e.message.includes('private'));
  const state = fixture(); state.vertices[0]!.properties.selection_policy_json = '{"legacy":true}';
  const fake: typeof fetch = async input => {
    const u = new URL(String(input)); if (u.pathname.endsWith('/schema')) return Response.json(schema());
    const key = u.pathname.endsWith('/vertices') ? 'vertices' : 'edges';
    return Response.json({ [key]: state[key].filter(v => v.label === u.searchParams.get('label') && (key === 'vertices' || ('outV' in v && v.outV === JSON.parse(u.searchParams.get('vertex_id')!)))).map(v => ({ ...v, properties: 'properties' in v ? v.properties : {} })), page: null });
  };
  const scanned = await new ReadClient(config, defaultLimits, fake).scan(new AbortController().signal);
  assert.equal(Object.hasOwn(scanned.vertices.find(v => v.id === 'root')!.properties, 'selection_policy_json'), false);
});
