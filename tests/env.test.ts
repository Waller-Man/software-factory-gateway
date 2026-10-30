import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseConnectionEnv, readConnectionEnv } from '../src/env.ts';
import { ReadClient } from '../src/transport.ts';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const base = 'HUGEGRAPH_BASE_URL=http://127.0.0.1:18080\nHUGEGRAPH_GRAPHSPACE=DEFAULT\nHUGEGRAPH_GRAPH=hugegraph\nHUGEGRAPH_USERNAME=test-user\n';
test('.env parser supports comments, CRLF, BOM, quotes and literal dollars without global environment changes', () => {
  const previous = process.env.HUGEGRAPH_PASSWORD;
  const parsed = parseConnectionEnv('\uFEFF# configuration\r\n' + base.replaceAll('\n', '\r\n') + 'HUGEGRAPH_PASSWORD=\'local#${HOME}\\path\' # comment\r\n');
  assert.equal(parsed.password, 'local#${HOME}\\path'); assert.equal(parsed.graphSpace, 'DEFAULT'); assert.equal(parsed.username, 'test-user');
  assert.equal(process.env.HUGEGRAPH_PASSWORD, previous);
  assert.equal(parseConnectionEnv(base + 'HUGEGRAPH_PASSWORD="a\\"b\\\\c"').password, 'a"b\\c');
  assert.equal(parseConnectionEnv(base + 'HUGEGRAPH_PASSWORD=" with spaces "').password, ' with spaces ');
  assert.equal(parseConnectionEnv(base + 'HUGEGRAPH_PASSWORD=value # comment').password, 'value');
});
test('.env rejects missing/blank, unknown, duplicate, malformed and multiline/oversized values without echoing secrets', () => {
  for (const text of [base, base + 'HUGEGRAPH_PASSWORD=', base + 'HUGEGRAPH_PASSWORD=" "', base + 'HUGEGRAPH_PASSWORD=secret\nOTHER=secret', base + 'HUGEGRAPH_PASSWORD=secret\nHUGEGRAPH_PASSWORD=secret', base + 'HUGEGRAPH_PASSWORD="secret', base + 'HUGEGRAPH_PASSWORD="secret" trailing', base + 'HUGEGRAPH_PASSWORD="secret\nsecond"', base + 'HUGEGRAPH_PASSWORD=x\nnot an assignment', 'x'.repeat(16385)]) {
    assert.throws(() => parseConnectionEnv(text), error => error instanceof Error && !error.message.includes('secret'));
  }
  const connection = parseConnectionEnv(base + 'HUGEGRAPH_PASSWORD=synthetic');
  assert.throws(() => new ReadClient({ ...connection, baseUrl: 'http://127.0.0.1:18080/gremlin' }), /origin/);
  assert.throws(() => new ReadClient({ ...connection, baseUrl: 'http://remote.example' }), /HTTPS/);
});
test('.env local file accepts ordinary permissions and validates absence, encoding and size', async () => {
  const root = resolve(packageRoot, '../../test-results'); await mkdir(root, { recursive: true });
  const scratch = await mkdtemp(join(root, 'env-')), path = join(scratch, '.env');
  await assert.rejects(readConnectionEnv(path), /Missing .env/);
  await writeFile(path, base + 'HUGEGRAPH_PASSWORD=synthetic-local-value\n', { mode: 0o644 });
  // No preparation script is needed for a readable file or its parent directory.
  const loaded = await readConnectionEnv(path); assert.equal(loaded.password, 'synthetic-local-value');
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', join(packageRoot, 'tests/unsafe-fixture.ps1'), '-Path', path], { windowsHide: true, stdio: 'pipe' });
    assert.equal((await readConnectionEnv(path)).password, 'synthetic-local-value');
  }
  else { await chmod(scratch, 0o777); await chmod(path, 0o644); assert.equal((await readConnectionEnv(path)).password, 'synthetic-local-value'); }
  await writeFile(path, Buffer.from([0xff, 0xfe, 0x00])); await assert.rejects(readConnectionEnv(path), /UTF-8/);
  await writeFile(path, 'x'.repeat(16385)); await assert.rejects(readConnectionEnv(path), /16 KiB/);
});
