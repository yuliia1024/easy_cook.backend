import { ModelPrompt, ModelProvenance } from '../types';

/** `name@vN`: how logs, menu versions and eval reports name a prompt version. */
export const promptLabel = ({ name, version }: Pick<ModelPrompt, 'name' | 'version'>): string =>
  `${name}@v${version}`;

/** The note of a menu version the model generated: the model and the prompt version. */
export const provenanceNote = ({ modelId, prompt }: ModelProvenance): string =>
  `model: ${modelId}; prompt: ${prompt}`;
