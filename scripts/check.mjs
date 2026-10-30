import { spawnSync } from 'node:child_process';
import { root, hostRequire, prepare } from './dev.mjs';
await prepare();
for (const args of [['-b', 'packages/contracts', 'packages/gateway', '--pretty', 'false'], ['-p', 'tsconfig.client.json', '--pretty', 'false']]) {
  const r = spawnSync(process.execPath, [hostRequire.resolve('typescript/bin/tsc'), ...args], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) { process.exitCode = r.status ?? 1; break; }
}
