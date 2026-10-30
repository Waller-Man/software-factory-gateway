/** Isolated child: the unpacked plugin may resolve only its own files and DSH.
 * Host module mapping models DSH-provided runtime libraries, never repo links. */
import { registerHooks, createRequire } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const [plugin, host] = process.argv.slice(2);
const providers = new Map();
for (const base of [join(host, 'packages'), join(host, 'vendor')]) {
  for (const group of await readdir(base, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    const top = join(base, group.name);
    const dirs = base.endsWith('vendor') ? [top] : (await readdir(top, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => join(top, e.name));
    for (const dir of dirs) {
      try {
        const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
        if (manifest.name) {
          const req = createRequire(join(dir, 'package.json'));
          for (const subpath of Object.keys(manifest.exports ?? { '.': manifest.main })) {
            if (!subpath.startsWith('.') || subpath.includes('*')) continue;
            const specifier = manifest.name + (subpath === '.' ? '' : subpath.slice(1));
            try { providers.set(specifier, pathToFileURL(req.resolve(specifier)).href); } catch { /* Unbuilt optional exports are irrelevant to this fixture. */ }
          }
        }
      }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
  }
}
const insidePlugin = url => url?.startsWith('file:') && (fileURLToPath(url) === plugin || fileURLToPath(url).startsWith(plugin + sep));
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@deepseek-ai/')) {
    const url = providers.get(specifier);
    if (!url) throw new Error('DSH host package unavailable: ' + specifier);
    return { url, shortCircuit: true };
  }
  if (insidePlugin(context.parentURL)) {
    if (!specifier.startsWith('node:') && !specifier.startsWith('.') && !specifier.startsWith('file:')) throw new Error('Unpacked plugin requested a non-host external dependency: ' + specifier);
    const result = next(specifier, context);
    if (result.url.startsWith('file:') && !insidePlugin(result.url)) throw new Error('Plugin escaped its unpacked directory');
    return result;
  }
  return next(specifier, context);
} });
const { Context } = await import('@deepseek-ai/cordis');
const { default: SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt');
const { default: Tools } = await import('@deepseek-ai/dsh-tools');
const { default: Registry } = await import('@deepseek-ai/dsh-typert-registry');
const { default: ApiGateway } = await import('@deepseek-ai/dsh-api-gateway');
const { default: Gateway } = await import(pathToFileURL(join(plugin, 'lib/index.js')));
const { TYPERT } = await import(pathToFileURL(join(plugin, 'lib/typert.host.js')));
const { default: remote } = await import(pathToFileURL(join(plugin, 'lib/typert.remote-client.js')));
const schema = JSON.parse(await readFile(join(dirname(plugin), 'mock-schema.json'), 'utf8'));
let requests = 0;
globalThis.fetch = async (input, init) => {
  assert.equal(init.method, 'GET'); assert.equal(new URL(String(input)).origin, 'http://127.0.0.1:18080'); requests++;
  if (String(input).endsWith('/schema')) return Response.json(schema);
  const url = new URL(String(input)), resource = url.pathname.endsWith('/vertices') ? 'vertices' : 'edges';
  return Response.json({ [resource]: [], page: null });
};
const ctx = new Context();
try {
  await ctx.plugin(SystemPrompt); await ctx.plugin(Tools); await ctx.plugin(Registry); await ctx.plugin(ApiGateway, {});
  const unregister = ctx.typert.register(TYPERT);
  const fiber = await ctx.plugin(Gateway, {});
  const h = await ctx.hugegraphRead.health(); assert.ok(h.ok && h.data.ready, JSON.stringify(h)); assert.equal(h.data.gatewayVersion, '0.1.1');
  assert.deepEqual(ctx.tools.schemas().map(x => x.name), ['hugegraph_read']);
  const data = await ctx.tools.execute({ callId: 'standalone', name: 'hugegraph_read', arguments: { action: 'read', query: { kind: 'agents' } }, signal: new AbortController().signal });
  assert.equal(data.isError, false); assert.ok(data.value.ok); assert.equal(data.value.data.items.length, 0);
  const fromRemote = await ctx.typertGateway.invoke({ namespace: 'hugegraphRead', method: 'health', args: {} }); assert.ok(fromRemote.ok && fromRemote.data.ready);
  assert.equal(remote.descriptors.length, 3);
  await fiber.dispose(); assert.equal(ctx.get('hugegraphRead'), undefined); unregister();
  console.log(JSON.stringify({ standalone: 'passed', database: 'synthetic', requests, repositoryDependencies: false, compiledAtUserSide: false, profileChanged: false }));
} finally { await ctx.fiber.dispose(); }
