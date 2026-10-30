import { mkdir, writeFile, readFile, readdir, copyFile, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { root, gateway, host, hostRequire, prepare } from './dev.mjs';
await prepare();
const result = spawnSync(process.execPath, [hostRequire.resolve('typescript/bin/tsc'), '-b', 'packages/contracts', 'packages/gateway'], { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.status !== 0) process.exit(result.status ?? 1);
const { WorkspaceTypertGenerator } = await import('@deepseek-ai/dsh-typert-generator');
// The official analyzer recognizes decorators only from registered workspace
// protocol sources. Stage read-only copies under this repo, never alter DSH.
const stage = join(gateway, 'artifacts/analysis');
for (const name of ['contracts', 'gateway']) {
  const to = join(stage, 'packages', name); await mkdir(to, { recursive: true });
  await cp(join(root, 'packages', name, 'src'), join(to, 'src'), { recursive: true });
  for (const file of ['package.json', 'tsconfig.json']) await copyFile(join(root, 'packages', name, file), join(to, file));
}
const protocol = join(stage, 'packages/protocol'); await mkdir(protocol, { recursive: true });
await cp(join(host, 'packages/typert/protocol/src'), join(protocol, 'src'), { recursive: true });
await copyFile(join(host, 'packages/typert/protocol/package.json'), join(protocol, 'package.json'));
await writeFile(join(protocol, 'tsconfig.json'), JSON.stringify({ include: ['src/**/*.ts'] }));
const aggregate = JSON.parse(await readFile(join(root, 'tsconfig.host.json'), 'utf8'));
aggregate.references.push({ path: 'packages/protocol' });
aggregate.compilerOptions.paths['@deepseek-ai/dsh-typert-protocol'] = ['packages/protocol/src/index.ts'];
await writeFile(join(stage, 'tsconfig.host.json'), JSON.stringify(aggregate));
await writeFile(join(stage, 'tsconfig.client.json'), JSON.stringify({ files: ['packages/gateway/src/client.ts'] }));
const outputs = new WorkspaceTypertGenerator(stage, { checkDiagnostics: false }).generate(['@software-factory/gateway'], ['host']);
if (outputs.length !== 1) throw new Error('Expected one generated Gateway Host artifact');
for (const output of outputs) {
  await writeFile(join(stage, 'typert.host.js'), output.js);
  await writeFile(join(gateway, 'lib/typert.host.d.ts'), output.dts);
  if (!output.remote) throw new Error('Missing generated Remote contribution');
  await writeFile(join(stage, 'typert.remote-client.js'), output.remote.js);
  await writeFile(join(gateway, 'lib/typert.remote-client.d.ts'), output.remote.dts);
}
// Ship self-contained declarations from the shared source, without requiring
// an unpublished contracts package to be installed into third-party profiles.
await mkdir(join(gateway, 'lib/contracts'), { recursive: true });
for (const name of ['gateway.js', 'gateway.d.ts']) await copyFile(join(root, 'packages/contracts/lib', name), join(gateway, 'lib/contracts', name));
async function rewrite(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'contracts') await rewrite(path); continue; }
    if (!e.name.endsWith('.d.ts')) continue;
    const source = await readFile(path, 'utf8');
    await writeFile(path, source.replaceAll('@software-factory/contracts/gateway', './contracts/gateway.js').replace(/(from ['"]\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1.js$2'));
  }
}
await rewrite(join(gateway, 'lib'));
const { build } = await import(pathToFileURL(hostRequire.resolve('tsdown')));
const ts = hostRequire('typescript');
const decorators = { name: 'standard-remote-decorators', transform(code, id) {
  if (!id.endsWith('.ts') || !/^\s*@/m.test(code)) return;
  return { code: ts.transpileModule(code, { fileName: id, compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext } }).outputText, map: null };
} };
for (const entry of ['typert.host', 'typert.remote-client']) await build({ config: false, entry: { [entry]: join(stage, entry + '.js') }, outDir: join(gateway, 'lib'), platform: 'neutral', format: 'esm', clean: false, dts: false, deps: { onlyBundle: ['zod'] }, outputOptions: { entryFileNames: entry + '.js' } });
await build({ config: false, entry: { index: join(gateway, 'src/index.ts') }, outDir: join(gateway, 'lib'), platform: 'node', format: 'esm', clean: false, dts: false, deps: { neverBundle: [/^@deepseek-ai\//] }, plugins: [decorators], outputOptions: { entryFileNames: 'index.js' } });
await build({ config: false, entry: { client: join(gateway, 'src/client.ts') }, outDir: join(gateway, 'lib'), platform: 'browser', format: 'cjs', clean: false, dts: false,
  outputOptions: { entryFileNames: 'client.js', banner: 'window.__ModuleLoader__.load({id:"@software-factory/gateway",factory:(require)=>{', intro: 'var module={exports:{}};var exports=module.exports;', footer: 'return module.exports;}});' } });
console.log('Built Gateway Host, generated strict Remote, browser bridge and self-contained types.');
