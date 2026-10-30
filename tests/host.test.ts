/** Real Cordis, Tool pipeline and strict Typert dispatcher; mock database only.
 * No actual profile, browser cookie store, old plugin or business algorithm is touched. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import Tools from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Registry from '@deepseek-ai/dsh-typert-registry';
import ApiGateway from '@deepseek-ai/dsh-api-gateway';
import Gateway from '../lib/index.js';
import { TYPERT } from '../lib/typert.host.js';
import remote from '../lib/typert.remote-client.js';
import { bundlePatchPaths, loadOverlayPatches, composeEntries, evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot';
import { properties, edgeTypes } from '../src/schema.ts';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
test('Bundle manifest and patch are accepted by the real DSH composition helpers', async () => {
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(evaluatePluginCompatibility(manifest), undefined);
  const patches = bundlePatchPaths(packageRoot, manifest.dsh.bundle).flatMap(path => loadOverlayPatches('gateway-test', path));
  const rows = composeEntries([patches]);
  assert.equal(rows.length, 1); assert.equal(rows[0]!.name, manifest.name); assert.equal(rows[0]!.id, 'sf-hugegraph-read');
  assert.equal((rows[0]!.config as any).envFile, '.env');
  assert.ok(!Object.hasOwn(rows[0]!.config!, 'baseUrl'));
  assert.ok(!Object.hasOwn(rows[0]!.config!, 'password'));
  for (const lang of ['en', 'zh']) { const locale = JSON.parse(await readFile(join(packageRoot, 'locale/' + lang + '.json'), 'utf8')); assert.ok(locale.meta.title && locale.meta.description); }
});
test('compiled standard plugin registers exactly one Tool and three strict Remotes; unload and re-enable', async () => {
  const ctx = new Context(); const originalFetch = globalThis.fetch;
  const resultRoot = resolve(packageRoot, '../../test-results'); await mkdir(resultRoot, { recursive: true });
  const scratch = await mkdtemp(join(resultRoot, 'gateway-host-')), envFile = join(scratch, '.env');
  const mockCredentials = { username: 'integration-user', password: 'synthetic-integration-password' };
  const envText = (): string => `HUGEGRAPH_BASE_URL=http://127.0.0.1:18080\nHUGEGRAPH_GRAPHSPACE=DEFAULT\nHUGEGRAPH_GRAPH=hugegraph\nHUGEGRAPH_USERNAME=${mockCredentials.username}\nHUGEGRAPH_PASSWORD=${mockCredentials.password}\n`;
  await writeFile(envFile, envText(), { mode: 0o600 });
  let gets = 0, writes = 0;
  const rows = [{ id: 'root', label: 'Capability', properties: { name: '软件工厂' } }, { id: 'agent-native', label: 'Agent', properties: { agent_id: 'agent:integration', name: 'integration', description: 'synthetic data' } }];
  const schema = { vertexlabels: Object.entries(properties).map(([name, fields]) => ({ name, properties: fields })), propertykeys: [...new Set(Object.values(properties).flat())].map(name => ({ name, data_type: name === 'display_order' ? 'INT' : 'TEXT', cardinality: 'SINGLE' })), edgelabels: Object.entries(edgeTypes).map(([name, [source_label, target_label]]) => ({ name, source_label, target_label })) };
  globalThis.fetch = async (input, init) => {
    if (init?.method !== 'GET') { writes++; return new Response('{}', { status: 405 }); } gets++;
    const u = new URL(String(input)); assert.equal(u.origin, 'http://127.0.0.1:18080');
    assert.equal((init!.headers as Record<string, string>).Authorization, 'Basic ' + Buffer.from(mockCredentials.username + ':' + mockCredentials.password).toString('base64'));
    if (u.pathname.endsWith('/schema')) return Response.json(schema);
    const resource = u.pathname.endsWith('/vertices') ? 'vertices' : 'edges';
    return Response.json({ [resource]: resource === 'vertices' ? rows.filter(v => v.label === u.searchParams.get('label')) : [], page: null });
  };
  try {
    await ctx.plugin(SystemPrompt); await ctx.plugin(Tools); await ctx.plugin(Registry); await ctx.plugin(ApiGateway, {});
    const definitions = ctx.typert.register(TYPERT as never);
    assert.deepEqual(remote.descriptors.map(d => d.namespace + '/' + d.method).sort(), ['hugegraphRead/health', 'hugegraphRead/read', 'hugegraphRead/snapshot']);
    assert.ok(remote.descriptors.every(d => d.cancellation?.parameter === 'signal'));
    for (let iteration = 0; iteration < 2; iteration++) {
      if (iteration) { mockCredentials.password = 'rotated-synthetic-password'; await writeFile(envFile, envText()); }
      const fiber = await ctx.plugin(Gateway, { envFile });
      const health = await ctx.hugegraphRead.health(); assert.ok(health.ok && health.data.ready, JSON.stringify(health));
      assert.deepEqual(ctx.tools.schemas().map(t => t.name), ['hugegraph_read']);
      const read = await ctx.tools.execute({ callId: 'read-' + iteration, name: 'hugegraph_read', arguments: { action: 'read', query: { kind: 'agents' } }, signal: new AbortController().signal });
      assert.equal(read.isError, false, JSON.stringify(read)); assert.equal((read as any).value.data.items.length, 1);
      const fromRemote: any = await ctx.typertGateway.invoke({ namespace: 'hugegraphRead', method: 'read', args: { query: { kind: 'agents' } } });
      assert.ok(fromRemote.ok && fromRemote.data.items.length === 1, JSON.stringify(fromRemote));
      for (const query of [{ kind: 'capability_tree' }, { kind: 'node', vertexId: 'root' }, { kind: 'versions', agentId: 'agent:integration' }, { kind: 'candidates' }, { kind: 'field_groups' }]) {
        const response: any = await ctx.typertGateway.invoke({ namespace: 'hugegraphRead', method: 'read', args: { query } });
        assert.ok(response.ok, JSON.stringify(response));
        const tool = await ctx.tools.execute({ callId: 'all-' + query.kind, name: 'hugegraph_read', arguments: { action: 'read', query }, signal: new AbortController().signal });
        assert.equal(tool.isError, false); assert.ok((tool as any).value.ok);
      }
      const remoteSnapshot: any = await ctx.typertGateway.invoke({ namespace: 'hugegraphRead', method: 'snapshot', args: { options: { includeVersions: true } } }); assert.ok(remoteSnapshot.ok);
      const remoteHealth: any = await ctx.typertGateway.invoke({ namespace: 'hugegraphRead', method: 'health', args: {} }); assert.ok(remoteHealth.ok && remoteHealth.data.ready);
      const cancelled = new AbortController(); cancelled.abort();
      const cancelledRead: any = await ctx.typertGateway.invoke({ namespace: 'hugegraphRead', method: 'read', args: { query: { kind: 'agents' } }, signal: cancelled.signal });
      assert.ok(!cancelledRead.ok && cancelledRead.error.code === 'CANCELLED');
      const before = gets;
      const malformed: any = await ctx.typertGateway.invoke({ namespace: 'hugegraphRead', method: 'read', args: { query: { kind: 'agents', url: 'https://invalid.example' } } });
      assert.ok(!malformed.ok && malformed.error.code === 'INVALID_INPUT'); assert.equal(gets, before);
      await assert.rejects(ctx.typertGateway.invoke({ namespace: 'hugegraphRead', method: 'read', args: { query: { kind: 'gremlin' } } }));
      assert.equal(gets, before);
      const badTool = await ctx.tools.execute({ callId: 'bad-transport', name: 'hugegraph_read', arguments: { action: 'snapshot', options: { url: 'https://invalid.example' } }, signal: new AbortController().signal });
      assert.ok(badTool.isError || !(badTool as any).value.ok); assert.equal(gets, before);
      const output = JSON.stringify([health, read, fromRemote]); assert.ok(!output.includes(mockCredentials.password) && !output.includes(envFile));
      await fiber.dispose(); assert.equal(ctx.get('hugegraphRead'), undefined); assert.deepEqual(ctx.tools.schemas().map(t => t.name), []);
      await assert.rejects(ctx.typertGateway.invoke({ namespace: 'hugegraphRead', method: 'health', args: {} }));
    }
    definitions(); assert.equal(writes, 0); assert.ok(gets > 0);
    const code = await readFile(join(packageRoot, 'lib/client.js'), 'utf8');
    assert.ok(code.includes('__ModuleLoader__.load') && !code.includes('require("@software-factory/gateway/remote")'));
  } finally { globalThis.fetch = originalFetch; await ctx.fiber.dispose(); }
});
