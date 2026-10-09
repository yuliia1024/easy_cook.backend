import { fakeConfig } from '../../test/fake-config';
import { DatabaseConfigService } from './database-config.service';

describe('DatabaseConfigService', () => {
  it('builds postgres options that only change the schema through migrations', () => {
    const service = new DatabaseConfigService(
      fakeConfig({
        POSTGRES_HOST: 'db',
        POSTGRES_PORT: '5442',
        POSTGRES_USER: 'u',
        POSTGRES_PASSWORD: 'p',
        POSTGRES_DB: 'd',
        POSTGRES_LOGGING: 'true',
      }),
    );

    expect(service.config()).toMatchObject({
      type: 'postgres',
      host: 'db',
      port: 5442,
      username: 'u',
      password: 'p',
      database: 'd',
      synchronize: false,
      migrationsRun: true,
      logging: true,
    });
  });

  it('points at entity and migration files', () => {
    const config = new DatabaseConfigService(fakeConfig({})).config() as {
      entities: string[];
      migrations: string[];
    };

    expect(config.entities[0]).toMatch(/modules\/\*\*\/\*\.entity\{\.ts,\.js\}$/);
    expect(config.migrations[0]).toMatch(/database\/migrations\/\*\{\.ts,\.js\}$/);
  });
});
