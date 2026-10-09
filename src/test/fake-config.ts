import { ConfigService } from '../configs/config.service';
import { Configs } from '../configs/configs';

/** A `ConfigService` stand-in that reads from `values` with the same conversions as the real one. */
export function fakeConfig(values: Partial<Record<keyof Configs, string>>): ConfigService {
  return {
    get: (key: keyof Configs) => values[key],
    getNumber: (key: keyof Configs) => Number(values[key]),
    getBoolean: (key: keyof Configs) => values[key] === 'true',
  } as unknown as ConfigService;
}
