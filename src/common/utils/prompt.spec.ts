import { promptLabel, provenanceNote } from './prompt';

describe('promptLabel', () => {
  it('names the prompt with its version', () => {
    expect(promptLabel({ name: 'menu-plan', version: 3 })).toBe('menu-plan@v3');
  });
});

describe('provenanceNote', () => {
  it('names the model and the prompt version', () => {
    expect(provenanceNote({ modelId: 'gpt-4o-mini-2024-07-18', prompt: 'menu-plan@v1' })).toBe(
      'model: gpt-4o-mini-2024-07-18; prompt: menu-plan@v1',
    );
  });
});
