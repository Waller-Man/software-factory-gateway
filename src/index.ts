import { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { GatewayResult, GraphSnapshot, Health, ReadData, ReadQuery, SnapshotOptions } from './types.ts';
import { Config, snapshotConfig, connectionConfig } from './config.ts';
import type { LiveGatewayConfig } from './types.ts';
import { ReadClient, defaultLimits } from './transport.ts';
import { Reader, readerDefaults } from './reader.ts';
import { failure, parseTool } from './validation.ts';
export type * from './types.ts';

/** One service owns authenticated Remote methods and the only model Tool. */
export class HugeGraphGateway extends TypertRemoteService {
  static inject: string[] = ['tools', 'typert'];
  static Config = Config;
  readonly apiVersion: '1.0' = '1.0';
  private reader?: Reader;
  private configKey?: string;
  constructor(ctx: Context, private config: LiveGatewayConfig) {
    super(ctx, 'hugegraphRead');
    this.ctx.effect(async () => {
      const unregister = ctx.tools.register(defineTool({
        name: 'hugegraph_read',
        description: 'Read-only software factory graph. action=health, snapshot or read. read.query.kind: capability_tree, node, agents, versions, candidates, field_groups, factory_config. Use detail=full for dataset metadata and independent descriptions; factory_config reads only the fixed public node and never accesses dataset files or URLs. agentId is a business ID; vertexId/capabilityId are native graph IDs. Candidate results are facts, never ranked or verified executable. No URLs, scripts or credential arguments. limit 1..100.',
        parameters: {
          action: { type: 'string', required: true, enum: ['health', 'snapshot', 'read'] },
          options: { type: 'object', properties: {}, additionalProperties: true },
          query: { type: 'object', properties: {
            kind: { type: 'string', required: true, enum: ['capability_tree', 'node', 'agents', 'versions', 'candidates', 'field_groups', 'factory_config'] },
            agentId: { type: 'string' }, vertexId: { type: 'string' }, capabilityId: { type: 'string' }, rootCapabilityId: { type: 'string' }, version: { type: 'string' }, groupId: { type: 'string' },
            keyword: { type: 'string' }, status: { type: 'string' }, developer: { type: 'string' },
            model: { type: 'object', properties: { name: { type: 'string', required: true }, vendor: { type: 'string' } }, additionalProperties: false },
            includeDescendants: { type: 'boolean' }, maxDepth: { type: 'number' }, maxNodes: { type: 'number' }, maxEdges: { type: 'number' },
            limit: { type: 'number' }, offset: { type: 'number' }, expectedFingerprint: { type: 'string' }, detail: { type: 'string', enum: ['summary', 'full'] },
          }, additionalProperties: false },
        },
        output: { schema: { type: 'json' }, render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }] },
        execute: async (args, exec) => {
          try {
            const input = parseTool(args);
            const reader = this.currentReader();
            if (input.action === 'health') return JSON.parse(JSON.stringify(await reader.health(exec.signal)));
            if (input.action === 'snapshot') return JSON.parse(JSON.stringify(await reader.snapshot(input.options, exec.signal)));
            return JSON.parse(JSON.stringify(await reader.read(input.query, exec.signal)));
          } catch (e) { return { ok: false, error: failure(e, exec.signal) }; }
        },
      }));
      return () => { unregister(); this.reader?.dispose(); this.reader = undefined; this.configKey = undefined; };
    }, 'software-factory-gateway: read tool and request lifetime');
  }
  private currentReader(): Reader {
    const config = snapshotConfig(this.config), key = JSON.stringify(config);
    if (this.reader && key === this.configKey) return this.reader;
    this.reader?.dispose(); this.configKey = key;
    try {
      const transport = new ReadClient(connectionConfig(config), { ...defaultLimits, requestTimeoutMs: config.requestTimeoutMs ?? defaultLimits.requestTimeoutMs });
      this.reader = new Reader(transport, undefined, { ...readerDefaults, timeoutMs: config.timeoutMs ?? readerDefaults.timeoutMs, maxConcurrent: config.maxConcurrent ?? readerDefaults.maxConcurrent });
    } catch { this.reader = new Reader(undefined, 'Database configuration is missing or invalid; check this component configuration'); }
    return this.reader;
  }
  /** Connection and schema diagnostics, without credentials, file paths or raw database errors. */
  @Remote
  async health(signal?: AbortSignal): Promise<GatewayResult<Health>> { return this.currentReader().health(signal); }
  /** Bounded capability graph, optionally including registered versions. */
  @Remote
  async snapshot(options: SnapshotOptions, signal?: AbortSignal): Promise<GatewayResult<GraphSnapshot>> {
    // Generated codecs may strip unknown object keys. Revalidate the original
    // wire value as well, so Remote has exactly the same strict boundary.
    const original = this.ctx.invocation?.request.args.options;
    return this.currentReader().snapshot((original ?? options) as SnapshotOptions, signal);
  }
  /** Strict allowlisted query; no caller-supplied transport or database expression. */
  @Remote
  async read(query: ReadQuery, signal?: AbortSignal): Promise<GatewayResult<ReadData>> {
    const original = this.ctx.invocation?.request.args.query;
    return this.currentReader().read((original ?? query) as ReadQuery, signal);
  }
}
export default HugeGraphGateway;
