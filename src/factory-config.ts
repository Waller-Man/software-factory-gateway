/** Public location metadata only: path checks are lexical, never filesystem/network access. */
import { posix, win32 } from 'node:path';
import type { FactoryConfigData } from './types.ts';

export const FACTORY_CONFIG_ID = 'config:software-factory' as const;
const identity = { kind: 'factory_config', vertexId: FACTORY_CONFIG_ID, label: 'FactoryConfig' } as const;
export const missingFactoryConfig = (missing: 'schema' | 'node' | 'dataset_root'): FactoryConfigData => ({ ...identity, state: 'missing', missing });
export const invalidFactoryConfig = (): FactoryConfigData => ({ ...identity, state: 'invalid', diagnostic: { code: 'INVALID_FACTORY_CONFIG', message: 'Public dataset configuration is malformed; inspect FactoryConfig locally' } });
export function factoryConfigValue(value: unknown): FactoryConfigData {
  if (value === undefined || value === null || value === '') return missingFactoryConfig('dataset_root');
  if (typeof value !== 'string' || value.length > 4096 || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return invalidFactoryConfig();
  if (/^https?:/i.test(value)) {
    try {
      const url = new URL(value);
      if (!url.host || url.username || url.password || url.search || url.hash) return invalidFactoryConfig();
      return { ...identity, state: 'configured', datasetRoot: value, locationKind: url.protocol === 'https:' ? 'https' : 'http' };
    } catch { return invalidFactoryConfig(); }
  }
  if (!win32.isAbsolute(value) && !posix.isAbsolute(value)) return invalidFactoryConfig();
  return { ...identity, state: 'configured', datasetRoot: value, locationKind: 'local' };
}
