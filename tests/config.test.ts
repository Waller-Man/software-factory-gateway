import test from 'node:test';
import assert from 'node:assert/strict';
import { Config, connectionConfig } from '../src/config.ts';
import { redactSecrets } from '@deepseek-ai/dsh-settings';

test('native component schema has secret password, live connection fields, and no env/dataset settings', () => {
  const schema = Config.toJSON() as any;
  const text = JSON.stringify(schema);
  assert.ok(text.includes('secret')); assert.ok(text.includes('volatile'));
  assert.ok(!text.includes('envFile') && !text.includes('dataset_root'));
  const fields = schema.refs[schema.uid].dict;
  assert.equal(schema.refs[fields.password].meta.role, 'secret');
  assert.ok(Object.values(fields).every((id: any) => schema.refs[id].meta.volatile));
  const redacted = redactSecrets(Config as never, { username: 'test', password: 'synthetic-only' });
  assert.ok(!JSON.stringify(redacted).includes('synthetic-only'));
  assert.deepEqual(redacted.secrets, [{ path: ['password'], set: true }]);
});

test('connection validation requires local component credentials and never returns them in errors', () => {
  for (const config of [{}, { username: 'test' }, { username: 'test', password: '' }, { username: 'test:bad', password: 'private-value' }, { username: 'test', password: 'private\nvalue' }]) {
    assert.throws(() => connectionConfig(config), error => error instanceof Error && !error.message.includes('private'));
  }
  assert.deepEqual(connectionConfig({ username: 'test', password: 'synthetic-only' }), { baseUrl: 'http://127.0.0.1:18080', graphSpace: 'DEFAULT', graph: 'hugegraph', username: 'test', password: 'synthetic-only' });
});
