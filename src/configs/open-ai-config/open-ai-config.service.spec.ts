import { fakeConfig } from '../../test/fake-config';
import { OpenAiConfigService } from './open-ai-config.service';

describe('OpenAiConfigService', () => {
  it('exposes OPEN_AI_API_KEY', () => {
    expect(new OpenAiConfigService(fakeConfig({ OPEN_AI_API_KEY: 'sk-test' })).apiKey).toBe(
      'sk-test',
    );
  });
});
