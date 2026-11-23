import test from 'node:test';
import assert from 'node:assert/strict';
import { Reader } from '../src/reader.ts';
import { ReadClient, defaultLimits } from '../src/transport.ts';
import { factoryConfigValue, missingFactoryConfig } from '../src/factory-config.ts';

const connection = { baseUrl: 'http://127.0.0.1:18080', graphSpace: 'DEFAULT', graph: 'hugegraph', username: 'test', password: 'synthetic-only' };
const configSchema = { vertexlabels: [{ name: 'FactoryConfig', properties: ['dataset_root'] }], propertykeys: [{ name: 'dataset_root', data_type: 'TEXT', cardinality: 'SINGLE' }] };

test('fixed public config uses only schema and exact GET, drops extra properties and never accesses dataset locations', async () => {
  for (const root of ['D:\\datasets', '/srv/datasets', 'https://example.invalid/datasets/', 'http://example.invalid/data/']) {
    const requests: string[] = [];
    const client = new ReadClient(connection, defaultLimits, async (input, init) => {
      const url = new URL(String(input)); requests.push(url.pathname);
      assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined); assert.equal(init?.redirect, 'error');
      assert.equal(url.origin, connection.baseUrl);
      if (url.pathname.endsWith('/schema')) return Response.json(configSchema);
      assert.equal(decodeURIComponent(url.pathname.split('/').at(-1)!), JSON.stringify('config:software-factory'));
      assert.equal(url.search, '');
      return Response.json({ id: 'config:software-factory', label: 'FactoryConfig', properties: { dataset_root: root, private_extra: 'must-not-return' } });
    });
    const reader = new Reader(client);
    const result = await reader.read({ kind: 'factory_config' });
    assert.ok(result.ok && result.data.kind === 'factory_config' && result.data.state === 'configured');
    if (result.ok && result.data.kind === 'factory_config' && result.data.state === 'configured') assert.equal(result.data.datasetRoot, root);
    assert.ok(!JSON.stringify(result).includes('must-not-return')); assert.equal(requests.length, 2);
    const count = requests.length;
    for (const extra of [{ vertexId: 'other' }, { url: 'http://other.invalid' }, { dataset_root: root }, { limit: 1 }, { password: 'secret' }]) {
      const rejected = await reader.read({ kind: 'factory_config', ...extra } as never); assert.ok(!rejected.ok && rejected.error.code === 'INVALID_INPUT');
    }
    assert.equal(requests.length, count); reader.dispose();
  }
});

test('missing public schema/node/property and malformed values are explicit; HTTP failure is not absence', async () => {
  for (const scenario of ['schema', 'node', 'dataset_root', 'invalid', 'database']) {
    const client = new ReadClient(connection, defaultLimits, async input => {
      if (String(input).endsWith('/schema')) return Response.json(scenario === 'schema' ? { vertexlabels: [], propertykeys: [] } : configSchema);
      if (scenario === 'node') return new Response('{}', { status: 404 });
      if (scenario === 'database') return new Response('private-upstream-body', { status: 403 });
      return Response.json({ id: 'config:software-factory', label: 'FactoryConfig', properties: scenario === 'dataset_root' ? {} : { dataset_root: 'relative/path' } });
    });
    const reader = new Reader(client), result = await reader.read({ kind: 'factory_config' });
    if (scenario === 'database') assert.ok(!result.ok && result.error.code === 'DATABASE' && !JSON.stringify(result).includes('private-upstream'));
    else {
      assert.ok(result.ok && result.data.kind === 'factory_config');
      if (result.ok && result.data.kind === 'factory_config') {
        assert.equal(result.data.state, scenario === 'invalid' ? 'invalid' : 'missing');
        if (result.data.state === 'missing') assert.equal(result.data.missing, scenario);
        if (scenario === 'invalid') assert.ok(result.meta.warnings.length > 0);
      }
    }
    reader.dispose();
  }
  for (const value of ['relative/path', 'https://user:password@example.invalid/data', 'https://example.invalid/?token=private', 'ftp://example.invalid', 42, '  ']) assert.equal(factoryConfigValue(value).state, 'invalid');
});

test('optional datasets retain raw/parsed/missing/invalid states and filter only dataset names', async () => {
  const values = [undefined, '[]', 'broken JSON', '{}', '[{"name":"独立测试数据","local_path":"private-folder","source_url":"https://example.invalid/dataset"}]'];
  for (const raw of values) {
    const version = { id: 'version', label: 'AgentVersion' as const, properties: { version: '1', ...(raw === undefined ? {} : { datasets_json: raw }) } };
    const state = { vertices: [{ id: 'agent', label: 'Agent' as const, properties: { agent_id: 'agent:test', name: 'test' } }, version], edges: [{ id: 'edge', label: 'HAS_VERSION' as const, outV: 'agent', inV: 'version', outVLabel: 'Agent' as const, inVLabel: 'AgentVersion' as const }] };
    const reader = new Reader({ schema: async () => {}, factoryConfig: async () => missingFactoryConfig('schema'), scan: async () => state, dispose() {} });
    const result = await reader.read({ kind: 'node', vertexId: 'version' });
    assert.ok(result.ok && result.data.kind === 'node');
    if (result.ok && result.data.kind === 'node') {
      assert.equal(result.data.node.properties.datasets_json, raw);
      assert.equal(result.data.node.jsonFields?.datasets_json?.state, raw === undefined ? 'missing' : raw === 'broken JSON' ? 'invalid' : 'parsed');
      assert.equal(result.meta.warnings.some(w => w.code === 'JSON_SHAPE'), raw === '{}');
    }
    const byName = await reader.read({ kind: 'candidates', keyword: '独立测试数据' });
    assert.ok(byName.ok && 'items' in byName.data);
    if (byName.ok && 'items' in byName.data) assert.equal(byName.data.items.length, raw?.includes('独立测试数据') ? 1 : 0);
    const byPath = await reader.read({ kind: 'candidates', keyword: 'private-folder' });
    assert.ok(byPath.ok && 'items' in byPath.data && byPath.data.items.length === 0);
    reader.dispose();
  }
});
