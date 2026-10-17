export interface EmbedderPort {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export const EMBEDDER_PORT = Symbol('EMBEDDER_PORT');

export interface TextGeneratorPort {
  summarize(text: string): Promise<string>;
}

export const TEXT_GENERATOR_PORT = Symbol('TEXT_GENERATOR_PORT');

/**
 * Pure cosine similarity between two in-memory vectors of equal length.
 */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
