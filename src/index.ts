import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { GatewayResult, GraphSnapshot, Health, ReadData, ReadQuery, SnapshotOptions } from './types.ts';
import { readConnectionEnv } from './env.ts';
import { ReadClient, defaultLimits } from './transport.ts';
import { Reader, readerDefaults } from './reader.ts';
import { failure, parseTool } from './validation.ts';
export type * from './types.ts';

/** Non-secret Loader configuration. Database credentials never appear in this object. */
export interface GatewayConfig {
  envFile?: string;
  timeoutMs?: number; requestTimeoutMs?: number; maxConcurrent?: number;
}

/** One service owns authenticated Remote methods and the only model Tool. */
export class HugeGraphGateway extends TypertRemoteService {
  static inject: string[] = ['tools', 'typert'];
  static Config: z<GatewayConfig> = z.object({
    envFile: z.string().default('.env'),
    timeoutMs: z.number().step(1).min(100).max(60000).default(30000),
    requestTimeoutMs: z.number().step(1).min(100).max(20000).default(10000),
    maxConcurrent: z.number().step(1).min(1).max(8).default(4),
  });
  readonly apiVersion: '1.0' = '1.0';
  private readerReady: Promise<Reader>;
  constructor(ctx: Context, config: GatewayConfig) {
    super(ctx, 'hugegraphRead');
    this.readerReady = this.initialize(config);
    this.ctx.effect(async () => {
      const reader = await this.readerReady;
      const unregister = ctx.tools.register(defineTool({
        name: 'hugegraph_read',
        description: 'Read-only software factory graph. action=health, snapshot or read. read.query.kind: capability_tree, node, agents, versions, candidates, field_groups. agentId is a business ID; vertexId/capabilityId are native graph IDs. Candidate results are facts, never ranked or verified executable. No URLs, scripts or credential arguments. limit 1..100.',
        parameters: {
          action: { type: 'string', required: true, enum: ['health', 'snapshot', 'read'] },
          options: { type: 'object', properties: {}, additionalProperties: true },
          query: { type: 'object', properties: {
            kind: { type: 'string', required: true, enum: ['capability_tree', 'node', 'agents', 'versions', 'candidates', 'field_groups'] },
            agentId: { type: 'string' }, vertexId: { type: 'string' }, capabilityId: { type: 'string' }, rootCapabilityId: { type: 'string' }, version: { type: 'string' }, groupId: { type: 'string' },
            keyword: { type: 'string' }, status: { type: 'string' }, developer: { type: 'string' },
            model: { type: 'object', properties: { name: { type: 'string', required: true }, vendor: { type: 'string' } }, additionalProperties: false },
            includeDescendants: { type: 'boolean' }, maxDepth: { type: 'number' }, maxNodes: { type: 'number' }, maxEdges: { type: 'number' },
            limit: { type: 'number' }, offset: { type: 'number' }, expectedFingerprint: { type: 'string' }, detail: { type: 'string', enum: ['summary', 'full'] },
          }, additionalProperties: false },
        },
        output: { schema: { type: 'json' }, render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }] },
        async execute(args, exec) {
          try {
            const input = parseTool(args);
            if (input.action === 'health') return JSON.parse(JSON.stringify(await reader.health(exec.signal)));
            if (input.action === 'snapshot') return JSON.parse(JSON.stringify(await reader.snapshot(input.options, exec.signal)));
            return JSON.parse(JSON.stringify(await reader.read(input.query, exec.signal)));
          } catch (e) { return { ok: false, error: failure(e, exec.signal) }; }
        },
      }));
      return () => { unregister(); reader.dispose(); };
    }, 'software-factory-gateway: read tool and request lifetime');
  }
  private async initialize(config: GatewayConfig): Promise<Reader> {
    try {
      const connection = await readConnectionEnv(config.envFile);
      const transport = new ReadClient(connection, { ...defaultLimits, requestTimeoutMs: config.requestTimeoutMs ?? defaultLimits.requestTimeoutMs });
      return new Reader(transport, undefined, { ...readerDefaults, timeoutMs: config.timeoutMs ?? readerDefaults.timeoutMs, maxConcurrent: config.maxConcurrent ?? readerDefaults.maxConcurrent });
    } catch (e) { return new Reader(undefined, failure(e).message); }
  }
  /** Connection and schema diagnostics, without credentials, file paths or raw database errors. */
  @Remote
  async health(signal?: AbortSignal): Promise<GatewayResult<Health>> { return (await this.readerReady).health(signal); }
  /** Bounded capability graph, optionally including registered versions. */
  @Remote
  async snapshot(options: SnapshotOptions, signal?: AbortSignal): Promise<GatewayResult<GraphSnapshot>> {
    // Generated codecs may strip unknown object keys. Revalidate the original
    // wire value as well, so Remote has exactly the same strict boundary.
    const original = this.ctx.invocation?.request.args.options;
    return (await this.readerReady).snapshot((original ?? options) as SnapshotOptions, signal);
  }
  /** Strict allowlisted query; no caller-supplied transport or database expression. */
  @Remote
  async read(query: ReadQuery, signal?: AbortSignal): Promise<GatewayResult<ReadData>> {
    const original = this.ctx.invocation?.request.args.query;
    return (await this.readerReady).read((original ?? query) as ReadQuery, signal);
  }
}
export default HugeGraphGateway;
