export type * from '@software-factory/contracts/gateway';
import type { HugeGraphGateway } from './index.ts';
declare module '@deepseek-ai/cordis' { interface Context { hugegraphRead: HugeGraphGateway } }
