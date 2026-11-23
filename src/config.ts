/** Native component configuration. No file or environment-variable fallback. */
import z from '@deepseek-ai/schemastery';
import type { GatewayConfig, LiveGatewayConfig } from './types.ts';
import type { Connection } from './transport.ts';
import { requireThat } from './validation.ts';

const keys = ['baseUrl', 'graphSpace', 'graph', 'username', 'password', 'timeoutMs', 'requestTimeoutMs', 'maxConcurrent'] as const;
export const Config = z.object({
  baseUrl: z.string().default('http://127.0.0.1:18080').description('数据库地址及端口；远程连接使用 HTTPS，不含 REST 路径。').volatile(),
  graphSpace: z.string().default('DEFAULT').description('图空间。').volatile(),
  graph: z.string().default('hugegraph').description('已有软件工厂业务图名称。').volatile(),
  username: z.string().default('').description('数据库用户名。').volatile(),
  password: z.string().role('secret').description('数据库密码；保存后不回显，不从 .env 或系统环境读取。').volatile(),
  timeoutMs: z.number().step(1).min(100).max(60000).default(30000).description('读取总超时（毫秒）。').volatile(),
  requestTimeoutMs: z.number().step(1).min(100).max(20000).default(10000).description('单次数据库请求超时（毫秒）。').volatile(),
  maxConcurrent: z.number().step(1).min(1).max(8).default(4).description('最大并发读取数。').volatile(),
});
export function snapshotConfig(config: LiveGatewayConfig): GatewayConfig {
  return Object.fromEntries(keys.map(key => [key, config[key].get()])) as GatewayConfig;
}
export function connectionConfig(config: GatewayConfig): Connection {
  const values = { baseUrl: config.baseUrl ?? 'http://127.0.0.1:18080', graphSpace: config.graphSpace ?? 'DEFAULT', graph: config.graph ?? 'hugegraph', username: config.username, password: config.password };
  for (const value of Object.values(values)) requireThat(typeof value === 'string' && value.length <= 4096 && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value), 'CONFIG', 'Fill the database connection fields in this component configuration');
  requireThat(!values.username!.includes(':'), 'CONFIG', 'Database username cannot contain a colon');
  return values as Connection;
}
