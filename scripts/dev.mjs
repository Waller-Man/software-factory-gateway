/** Development only: link existing DSH dependencies without modifying the host or profiles. */
import { createRequire } from 'node:module';
import { mkdir, readdir, readFile, realpath, lstat, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const gateway = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const root = resolve(gateway, '../..');
export const host = resolve(process.env.DSH_SOURCE ?? join(root, '../DSH-Softwarefactory'));
export const hostRequire = createRequire(join(host, 'package.json'));
export async function prepare() {
  const hostManifest = JSON.parse(await readFile(join(host, 'package.json'), 'utf8'));
  if (hostManifest.version !== '0.2.1-alpha.2') throw new Error('This build targets DSH 0.2.1-alpha.2; review compatibility before changing the host revision.');
  async function link(name, source) {
    const target = join(root, 'node_modules', name), wanted = await realpath(source);
    await mkdir(dirname(target), { recursive: true });
    try { await lstat(target); if ((await realpath(target)).toLowerCase() !== wanted.toLowerCase()) throw new Error('Dependency target differs; resolve explicitly: ' + name); return; }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    await symlink(wanted, target, process.platform === 'win32' ? 'junction' : 'dir');
  }
  for (const group of await readdir(join(host, 'packages'), { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    for (const entry of await readdir(join(host, 'packages', group.name), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(host, 'packages', group.name, entry.name);
      try { const p = JSON.parse(await readFile(join(path, 'package.json'), 'utf8')); await link(p.name, path); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
  }
  for (const [name, directory] of [['cordis','cordis'], ['schemastery','schemastery'], ['cordis-plugin-loader','loader'], ['cordis-plugin-include','include'], ['cordis-plugin-timer','timer']]) await link('@deepseek-ai/' + name, join(host, 'vendor', directory));
  for (const name of ['typescript', '@types/node', 'zod']) await link(name, dirname(hostRequire.resolve(name + '/package.json')));
  await link('@software-factory/contracts', join(root, 'packages/contracts'));
  await link('@software-factory/gateway', gateway);
}
