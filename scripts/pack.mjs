/** Build first. Generates a runtime-only ZIP; never reads a real .env. */
import { copyFile, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gateway, root } from './dev.mjs';
import { createZip, readTgz } from './archive.mjs';

const artifacts = join(gateway, 'artifacts'); await mkdir(artifacts, { recursive: true });
// One normative source; ship a generated copy with the standalone package.
await mkdir(join(gateway, 'docs'), { recursive: true });
await copyFile(join(root, 'docs/interfaces/gateway.md'), join(gateway, 'docs/gateway-api.md'));
const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd pack --ignore-scripts --json --pack-destination artifacts'] : ['pack', '--ignore-scripts', '--json', '--pack-destination', 'artifacts'];
const result = spawnSync(command, args, { cwd: gateway, encoding: 'utf8', windowsHide: true, env: { ...process.env, npm_config_cache: join(artifacts, 'npm-cache') } });
if (result.status !== 0) { process.stderr.write(result.stderr ?? 'npm pack failed'); process.exit(result.status ?? 1); }
const metadata = JSON.parse(result.stdout)[0], entries = readTgz(await readFile(join(artifacts, metadata.filename)));
const files = entries.map(e => e.name), npmFiles = metadata.files.map(e => e.path);
if (JSON.stringify([...files].sort()) !== JSON.stringify([...npmFiles].sort())) throw new Error('Tar entries differ from npm file list');
for (const path of files) {
  if (/(^|\/)(node_modules|src|tests?|artifacts)(\/|$)|(^|\/)credentials\.json$|\.private\.|\.tsbuildinfo$/.test(path)) throw new Error('Forbidden package content');
  if (/(^|\/)\.env(?:\..*)?$/.test(path) && path !== '.env.example') throw new Error('Private environment file included');
}
const required = ['package.json', 'README.md', 'docs/gateway-api.md', 'THIRD_PARTY_NOTICES.md', '.env.example', 'lib/index.js', 'lib/client.js', 'lib/types.d.ts', 'lib/contracts/gateway.d.ts', 'lib/typert.host.js', 'lib/typert.remote-client.js', 'cordis.patch.yml', 'locale/zh.json', 'locale/en.json', 'icon.svg'];
for (const path of required) if (!files.includes(path)) throw new Error('Package file missing: ' + path);
const example = entries.find(e => e.name === '.env.example').data.toString('utf8');
for (const key of ['HUGEGRAPH_USERNAME', 'HUGEGRAPH_PASSWORD']) if (!new RegExp('^' + key + '=$', 'm').test(example)) throw new Error('Non-empty credential example');
const manifestEntry = entries.find(e => e.name === 'package.json'), manifest = JSON.parse(manifestEntry.data.toString('utf8'));
if (manifest.scripts?.preinstall || manifest.scripts?.install || manifest.scripts?.postinstall) throw new Error('Unexpected install script');
delete manifest.scripts; delete manifest.devDependencies; delete manifest.workspaces;
manifestEntry.data = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
const prefix = 'software-factory-gateway', releaseDir = join(artifacts, 'release', prefix);
for (const name of ['check-env-acl.ps1', 'protect-env.ps1']) await rm(join(releaseDir, 'scripts', name), { force: true });
for (const entry of entries) { const output = join(releaseDir, entry.name); await mkdir(dirname(output), { recursive: true }); await writeFile(output, entry.data); }
// Only verified entries are zipped. User-added release files, especially .env,
// are never enumerated or packaged.
const zipName = prefix + '-' + manifest.version + '.zip';
const zip = createZip(entries.map(entry => ({ ...entry, name: prefix + '/' + entry.name })));
await writeFile(join(artifacts, zipName), zip);
const report = { checkedAt: new Date().toISOString(), version: manifest.version, zip: zipName, zipSha256: createHash('sha256').update(zip).digest('hex'), zipBytes: zip.length, tgz: metadata.filename, tgzIntegrity: metadata.integrity, files, credentialsExcluded: true, sourceAndDevDependenciesExcluded: true, installScripts: false };
await writeFile(join(artifacts, 'package-check.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ zip: zipName, bytes: zip.length, files: files.length, packageCheck: 'passed' }, null, 2));
