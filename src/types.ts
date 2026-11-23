export type * from '@software-factory/contracts/gateway';
import type { Volatile } from '@deepseek-ai/cordis';
export interface GatewayConfig {
  baseUrl?: string; graphSpace?: string; graph?: string; username?: string; password?: string;
  timeoutMs?: number; requestTimeoutMs?: number; maxConcurrent?: number;
}
export type LiveGatewayConfig = { [K in keyof GatewayConfig]-?: Volatile<GatewayConfig[K]> };
import type { HugeGraphGateway } from './index.ts';
declare module '@deepseek-ai/cordis' { interface Context { hugegraphRead: HugeGraphGateway } }
