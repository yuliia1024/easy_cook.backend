import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Configs } from './configs';

@Injectable()
export class ConfigService {
  private readonly configuration: Configs;

  constructor() {
    this.configuration = plainToInstance(Configs, { ...process.env });
    this.validate();
  }

  public get<K extends keyof Configs>(key: K): Configs[K] {
    return this.configuration[key];
  }

  public getNumber<K extends keyof Configs>(key: K): number {
    return Number(this.configuration[key]);
  }

  public getBoolean<K extends keyof Configs>(key: K): boolean {
    return this.configuration[key] === 'true';
  }

  private validate(): void {
    const errors = validateSync(this.configuration, { whitelist: true });

    if (errors.length > 0) {
      const details = errors.map(
        (e) => `${e.property}: ${Object.values(e.constraints || {}).join(', ')}`,
      );
      throw new Error(`Configuration invalid\n${details.join('\n')}`);
    }
  }
}
