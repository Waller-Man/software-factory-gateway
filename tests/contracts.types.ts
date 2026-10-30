/** Compile-only check of the distributed, self-contained backend and browser API. */
import type { Context } from '@deepseek-ai/cordis';
import type { HugeGraphReadService, ReadQuery } from '@software-factory/gateway/types';
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol';
import type {} from '@software-factory/gateway/remote';
export async function backend(ctx: Context): Promise<void> {
  const service: HugeGraphReadService = ctx.hugegraphRead;
  const q: ReadQuery = { kind: 'versions', agentId: 'agent:a', detail: 'full' };
  await service.health(); await service.read(q); await service.snapshot({});
}
export async function browser(remote: TypertClientRemote): Promise<void> {
  const result = await remote.hugegraphRead.read({ kind: 'field_groups' });
  if (result.ok && result.value.ok) { const data = result.value.data; void data; }
}
