/** Authenticated Remote bridge and the component-owned native configuration form. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol';
import { createElement as h, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import remote from '@software-factory/gateway/remote';
const words = {
  zh: { intro: '配置只读网关的数据库连接。数据集根位置从数据库读取，无需在此填写。',
    baseUrl: '数据库地址及端口', graphSpace: '图空间', graph: '图名', username: '数据库用户名', password: '数据库密码',
    timeoutMs: '总超时（毫秒）', requestTimeoutMs: '单次请求超时（毫秒）', maxConcurrent: '最大并发数',
    passwordHint: '不填写则保留已保存密码', save: '保存配置', discard: '放弃修改', saving: '保存中…',
    unavailable: '组件配置尚未就绪，请检查DSH设置服务并启用本组件。', readOnly: '当前连接没有保存配置的权限。',
    invalid: '请检查必填字段与数值范围。', saved: '已保存，下一次读取使用新配置；如未自动重载，请重启DSH。',
    failed: '配置未保存，请检查连接；若其他页面已修改配置，请放弃修改后重新填写。' },
  en: { intro: 'Configure the read gateway connection. The dataset root is read from the database.',
    baseUrl: 'Database address and port', graphSpace: 'Graph space', graph: 'Graph', username: 'Database username', password: 'Database password',
    timeoutMs: 'Total timeout (ms)', requestTimeoutMs: 'Request timeout (ms)', maxConcurrent: 'Maximum concurrent reads',
    passwordHint: 'Leave blank to keep the saved password', save: 'Save configuration', discard: 'Discard changes', saving: 'Saving…',
    unavailable: 'Enable this component and check the DSH settings service.', readOnly: 'This connection cannot save configuration.',
    invalid: 'Check required fields and numeric ranges.', saved: 'Saved. The next read uses the new configuration; restart DSH if live reload is unavailable.',
    failed: 'Could not save. Check the connection; if another page changed the configuration, discard and edit again.' },
};
type Key = keyof typeof words.zh;
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'softwareFactoryGatewayConfig': Key } }
const fields = [
  ['baseUrl', 'http://127.0.0.1:18080'], ['graphSpace', 'DEFAULT'], ['graph', 'hugegraph'], ['username', ''], ['password', ''],
  ['timeoutMs', '30000', 100, 60000], ['requestTimeoutMs', '10000', 100, 20000], ['maxConcurrent', '4', 1, 8],
] as const;

export function GatewayConnectionForm({ view, form, t }: PropsRuntime<'plugins.row.config'> & { t: (key: Key) => string }) {
  const [edits, setEdits] = useState<Record<string, string>>({}), [saving, setSaving] = useState(false), [notice, setNotice] = useState<Key>();
  const revision = useRef<number>();
  const dirty = Object.keys(edits).length > 0;
  if (view === 'summary') return h('span', null, t('intro'));
  if (!form || form.state.status !== 'ready') return h('p', { role: 'status' }, t('unavailable'));
  const disabled = saving || !form.state.writable;
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (disabled || !dirty) return;
    const ops = Object.entries(edits).filter(([key, value]) => key !== 'password' || value !== '').map(([key, value]) => ({ op: 'set' as const, path: [key], value: ['timeoutMs', 'requestTimeoutMs', 'maxConcurrent'].includes(key) ? Number(value) : value }));
    if (ops.some(op => {
      const field = fields.find(field => field[0] === op.path[0]);
      return typeof op.value === 'number' ? !Number.isInteger(op.value) || !field || field.length < 4 || op.value < field[2]! || op.value > field[3]! : !op.value.trim();
    })) { setNotice('invalid'); return; }
    if (!ops.length) { setEdits({}); return; }
    setSaving(true); setNotice(undefined);
    try {
      if (await form.mutate(ops, revision.current)) { setEdits({}); setNotice('saved'); }
      else setNotice('failed');
    } catch { setNotice('failed'); }
    finally { setSaving(false); }
  };
  return h('form', { className: 'sf-gateway-config', 'aria-label': t('intro'), onSubmit: (event: FormEvent) => { void save(event); } },
    h('style', null, '.sf-gateway-config{max-width:640px;display:grid;gap:16px;color:var(--dsw-alias-label-primary)}.sf-gateway-config label{display:grid;gap:8px}.sf-gateway-config input{padding:10px 12px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:inherit;font:inherit}.sf-gateway-config footer{display:flex;gap:12px}.sf-gateway-config button{padding:8px 16px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:transparent;color:inherit;font:inherit;cursor:pointer}.sf-gateway-config button:disabled{opacity:.4;cursor:default}'),
    h('p', null, t('intro')), !form.state.writable && h('p', { role: 'status' }, t('readOnly')),
    ...fields.map(field => {
      const [key, fallback] = field, numeric = field.length === 4;
      return h('label', { key }, t(key), h('input', { name: key, type: key === 'password' ? 'password' : numeric ? 'number' : 'text',
        value: edits[key] ?? (key === 'password' ? '' : String(form.state.value?.[key] ?? fallback)),
        placeholder: key === 'password' ? t('passwordHint') : undefined, required: key !== 'password', disabled,
        ...(numeric ? { min: field[2], max: field[3], step: 1 } : {}), autoComplete: key === 'password' ? 'new-password' : 'off',
        onChange: (event: ChangeEvent<HTMLInputElement>) => { if (!dirty) revision.current = form.state.revision; setEdits(old => ({ ...old, [key]: event.target.value })); setNotice(undefined); },
      }));
    }),
    h('footer', null, h('button', { type: 'submit', disabled: disabled || !dirty }, t(saving ? 'saving' : 'save')),
      h('button', { type: 'button', disabled: saving || !dirty, onClick: () => { setEdits({}); setNotice(undefined); } }, t('discard'))),
    h('p', { role: 'status' }, notice ? t(notice) : ''),
  );
}
export const inject: string[] = ['remote', 'slots', 'locale'];
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const client = ctx.get('remote') as TypertClientRemote;
  const unmount = await client.$mount(remote);
  ctx.effect(() => ctx.locale.register('softwareFactoryGatewayConfig', words));
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({ name: 'plugins.row.config', key: '@software-factory/gateway#sf-hugegraph-read', locale: 'softwareFactoryGatewayConfig' }, GatewayConnectionForm));
  return unmount;
}
