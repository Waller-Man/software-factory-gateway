/** Exercise the distributed browser factory and native component form, never a real profile. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const gateway = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = resolve(process.env.DSH_SOURCE ?? join(gateway, '../../../DSH-Softwarefactory'));
const hostRequire = createRequire(join(host, 'package.json')), uiRequire = createRequire(join(host, 'packages/client/ui-primitives/package.json'));
test('built Client exposes the exact component entry and saves native fenced edits without displaying or erasing saved passwords', async () => {
  const { JSDOM } = hostRequire('jsdom'), dom = new JSDOM('<!doctype html><div id="mount"></div>');
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[name], writable: true });
  }
  const React = uiRequire('react'), { createRoot } = uiRequire('react-dom/client'), root = createRoot(dom.window.document.getElementById('mount'));
  let client: any, stopped = 0, accept = true, translations: any;
  const rows: any[] = [], writes: any[] = [], effects: Function[] = [];
  try {
    dom.window.__ModuleLoader__ = { load: (definition: any) => { client = definition.factory(uiRequire); } };
    runInNewContext(await readFile(join(gateway, 'lib/client.js'), 'utf8'), { window: dom.window, console });
    const slots = { inject: (name: string, setup: Function) => { assert.equal(name, 'plugins.row.config'); setup(); }, register: (options: any, component: any) => { rows.push({ options, component }); return () => {}; } };
    const remote = { $mount: async () => async () => { stopped++; } };
    const stop = await client.apply({ slots, locale: { register: (_name: string, words: any) => { translations = words; return () => {}; } }, effect: (setup: Function) => { effects.push(setup()); }, get: () => remote });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].options.name, 'plugins.row.config');
    assert.equal(rows[0].options.key, '@software-factory/gateway#sf-hugegraph-read');
    const manifest = JSON.parse(await readFile(join(gateway, 'package.json'), 'utf8'));
    assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-plugin-manager'));
    assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'));
    const form: any = { state: { status: 'ready', value: { username: 'synthetic', password: 'stored-secret-must-not-render' }, revision: 7, writable: true }, mutate: async (ops: any, revision: number) => { writes.push({ ops, revision }); return accept; } };
    const render = async () => React.act(async () => root.render(React.createElement(rows[0].component, { view: 'page', form, t: (key: string) => translations.zh[key] })));
    await render();
    const doc = dom.window.document, password = doc.querySelector('input[name=password]') as HTMLInputElement;
    assert.equal(password.type, 'password'); assert.equal(password.value, '');
    assert.ok(!doc.body.innerHTML.includes('stored-secret-must-not-render'));
    assert.equal(doc.querySelectorAll('input').length, 8);
    assert.equal(doc.querySelector('input[name=dataset_root]'), null); assert.equal(doc.querySelector('input[name=envFile]'), null);
    const edit = async (name: string, value: string) => React.act(async () => {
      const input = doc.querySelector(`input[name=${name}]`)!;
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    const submit = async () => React.act(async () => { doc.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    await edit('username', 'updated-synthetic'); await submit();
    assert.deepEqual(JSON.parse(JSON.stringify(writes[0])), { ops: [{ op: 'set', path: ['username'], value: 'updated-synthetic' }], revision: 7 });
    await edit('password', 'new-synthetic-secret'); await submit();
    assert.equal(writes[1].ops[0].path[0], 'password'); assert.equal(writes[1].ops[0].value, 'new-synthetic-secret'); assert.equal(password.value, '');
    await edit('maxConcurrent', '9'); await submit(); assert.equal(writes.length, 2); assert.ok(doc.body.textContent.includes(translations.zh.invalid));
    await edit('maxConcurrent', '3'); form.state.revision = 8; accept = false; await render(); await submit();
    assert.equal(writes[2].revision, 7); assert.ok(doc.body.textContent.includes(translations.zh.failed));
    assert.equal((doc.querySelector('input[name=maxConcurrent]') as HTMLInputElement).value, '3');
    form.state.writable = false; await render(); await submit(); assert.equal(writes.length, 3);
    assert.ok(doc.body.textContent.includes(translations.zh.readOnly));
    await stop(); for (const dispose of effects) dispose(); assert.equal(stopped, 1);
  } finally {
    await React.act(async () => root.unmount()); dom.window.close();
    for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as any)[name]; }
  }
});
