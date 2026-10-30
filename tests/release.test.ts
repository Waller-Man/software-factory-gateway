import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { properties, edgeTypes } from '../src/schema.ts';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
test('published ZIP extracts with an independent ZIP reader and loads outside the development package', async () => {
  const report = JSON.parse(await readFile(join(packageRoot, 'artifacts/package-check.json'), 'utf8'));
  assert.equal(report.version, '0.1.1'); assert.ok(report.credentialsExcluded);
  assert.ok(report.files.includes('.env.example') && !report.files.includes('.env'));
  assert.ok(!report.files.some(name => /(?:check-env-acl|protect-env)\.ps1$/.test(name)));
  const root = resolve(packageRoot, '../../test-results'); await mkdir(root, { recursive: true });
  const scratch = await mkdtemp(join(root, 'standalone-')), zip = join(packageRoot, 'artifacts', report.zip);
  if (process.platform === 'win32') execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', join(packageRoot, 'tests/extract-release.ps1'), '-Archive', zip, '-Destination', scratch], { windowsHide: true, stdio: 'pipe' });
  else execFileSync('unzip', ['-q', zip, '-d', scratch]);
  const plugin = join(scratch, 'software-factory-gateway');
  await assert.rejects(access(join(plugin, '.env'))); await assert.rejects(access(join(plugin, 'node_modules'))); await assert.rejects(access(join(plugin, 'src')));
  const manifest = JSON.parse(await readFile(join(plugin, 'package.json'), 'utf8')); assert.equal(manifest.scripts, undefined);
  await writeFile(join(plugin, '.env'), 'HUGEGRAPH_BASE_URL=http://127.0.0.1:18080\nHUGEGRAPH_GRAPHSPACE=DEFAULT\nHUGEGRAPH_GRAPH=hugegraph\nHUGEGRAPH_USERNAME=standalone-mock\nHUGEGRAPH_PASSWORD=synthetic-only\n', { mode: 0o600 });
  const schema = { vertexlabels: Object.entries(properties).map(([name, fields]) => ({ name, properties: fields })), propertykeys: [...new Set(Object.values(properties).flat())].map(name => ({ name, data_type: name === 'display_order' ? 'INT' : 'TEXT', cardinality: 'SINGLE' })), edgelabels: Object.entries(edgeTypes).map(([name, [source_label, target_label]]) => ({ name, source_label, target_label })) };
  await writeFile(join(scratch, 'mock-schema.json'), JSON.stringify(schema));
  const host = resolve(process.env.DSH_SOURCE ?? join(packageRoot, '../../../DSH-Softwarefactory'));
  const output = execFileSync(process.execPath, [join(packageRoot, 'tests/standalone-runner.mjs'), plugin, host], { cwd: scratch, encoding: 'utf8', windowsHide: true, env: { ...process.env, HUGEGRAPH_BASE_URL: 'https://must-not-be-used.invalid', HUGEGRAPH_PASSWORD: 'must-not-be-used' }, timeout: 20000 });
  const result = JSON.parse(output.trim()); assert.equal(result.standalone, 'passed'); assert.equal(result.repositoryDependencies, false); assert.equal(result.profileChanged, false);
});
