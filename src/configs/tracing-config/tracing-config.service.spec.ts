import { Environments } from '../../common/types';
import { fakeConfig } from '../../test/fake-config';
import { TracingConfigService } from './tracing-config.service';

describe('TracingConfigService', () => {
  it('is off without keys', () => {
    const config = new TracingConfigService(fakeConfig({ ENV: 'production' }));

    expect(config.langfuse).toBeNull();
    expect(config.isEnabled).toBe(false);
  });

  it.each([
    { LANGFUSE_PUBLIC_KEY: 'pk-lf-1' },
    { LANGFUSE_SECRET_KEY: 'sk-lf-1' },
    { LANGFUSE_PUBLIC_KEY: '', LANGFUSE_SECRET_KEY: 'sk-lf-1' },
  ])('is off unless both keys are set: %p', (values) => {
    expect(new TracingConfigService(fakeConfig(values)).isEnabled).toBe(false);
  });

  it('reads the keys, the server and the environment', () => {
    const config = new TracingConfigService(
      fakeConfig({
        ENV: 'staging',
        LANGFUSE_PUBLIC_KEY: 'pk-lf-1',
        LANGFUSE_SECRET_KEY: 'sk-lf-1',
        LANGFUSE_BASE_URL: 'http://localhost:3000',
      }),
    );

    expect(config.isEnabled).toBe(true);
    expect(config.langfuse).toEqual({
      publicKey: 'pk-lf-1',
      secretKey: 'sk-lf-1',
      baseUrl: 'http://localhost:3000',
      environment: Environments.STAGING,
    });
  });

  it('leaves the server to the SDK when LANGFUSE_BASE_URL is empty', () => {
    const config = new TracingConfigService(
      fakeConfig({ LANGFUSE_PUBLIC_KEY: 'pk', LANGFUSE_SECRET_KEY: 'sk', LANGFUSE_BASE_URL: '' }),
    );

    expect(config.langfuse?.baseUrl).toBeUndefined();
  });

  it.each([
    ['local', true],
    ['development', false],
    ['staging', false],
    ['production', false],
  ])('records the content of the calls with ENV=%s: %p', (env, expected) => {
    expect(new TracingConfigService(fakeConfig({ ENV: env })).recordsContent).toBe(expected);
  });
});
