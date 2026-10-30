/** No page or DOM: only mount the generated, authenticated Remote namespace. */
import type { Context } from '@deepseek-ai/cordis';
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol';
import remote from '@software-factory/gateway/remote';
export const inject: string[] = ['remote'];
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const client = ctx.get('remote') as TypertClientRemote;
  return client.$mount(remote);
}
