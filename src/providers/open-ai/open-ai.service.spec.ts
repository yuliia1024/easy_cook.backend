import { Test } from '@nestjs/testing';
import { OpenAiModule } from './open-ai.module';
import { OpenAiService } from './open-ai.service';

describe('OpenAiService', () => {
  it('is provided by OpenAiModule', async () => {
    const module = await Test.createTestingModule({ imports: [OpenAiModule] }).compile();

    expect(module.get(OpenAiService)).toBeInstanceOf(OpenAiService);
  });
});
