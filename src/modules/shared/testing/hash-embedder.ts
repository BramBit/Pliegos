import { createHash } from 'node:crypto';
import { EmbedderPort } from '../../recommendation/domain/ports/ai-provider.port';

export const DEFAULT_HASH_EMBEDDER_MODEL = 'nomic-embed-text';
export const DEFAULT_HASH_EMBEDDER_DIMENSIONS = 768;

/**
 * Deterministic test-only embedder implementing EmbedderPort.
 * Produces 768-dimensional unit vectors using signed feature hashing over normalized tokens
 * and character 3-grams, so texts sharing words/concepts have higher cosine similarity
 * while remaining 100% deterministic without network or LLM calls.
 */
export class HashEmbedder implements EmbedderPort {
  public readonly model: string;
  public readonly dimensions: number;
  public calls = 0;
  public embeddedBatches: string[][] = [];

  constructor(
    model: string = DEFAULT_HASH_EMBEDDER_MODEL,
    dimensions: number = DEFAULT_HASH_EMBEDDER_DIMENSIONS,
  ) {
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    this.calls += 1;
    this.embeddedBatches.push([...texts]);

    if (!Array.isArray(texts) || texts.length === 0) {
      throw new Error('HashEmbedder: cannot generate embeddings for empty input array');
    }

    return texts.map((text) => this.embedSingle(text));
  }

  private embedSingle(text: string): number[] {
    if (!text || text.trim() === '') {
      throw new Error('HashEmbedder: cannot generate embedding for empty text');
    }

    const vec = new Float64Array(this.dimensions);
    const normalized = text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    const tokens = normalized.split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
    const features: string[] = [...tokens];

    // Add 4-char prefixes (lightweight Spanish stemming) so related morphological forms match
    for (const token of tokens) {
      if (token.length >= 4) {
        features.push(`stem:${token.slice(0, 4)}`);
      }
      if (token.length >= 5) {
        features.push(`stem5:${token.slice(0, 5)}`);
      }
    }

    if (features.length === 0) {
      features.push(normalized.trim());
    }

    for (const feature of features) {
      const digest = createHash('sha256').update(feature, 'utf8').digest();
      // Project each feature onto 8 coordinates with signed weights
      for (let k = 0; k < 8; k++) {
        const idx = digest.readUInt16BE(k * 2) % this.dimensions;
        const sign = (digest[16 + k] & 1) === 0 ? 1 : -1;
        vec[idx] += sign;
      }
    }

    // Small full-text perturbation to guarantee non-zero vector and distinguish exact strings
    const fullDigest = createHash('sha256').update(text, 'utf8').digest();
    for (let i = 0; i < this.dimensions; i++) {
      const byte = fullDigest[i % fullDigest.length];
      vec[i] += ((byte / 255) - 0.5) * 0.01;
    }

    let norm = 0;
    for (let i = 0; i < this.dimensions; i++) {
      norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm) || 1;

    const result = new Array<number>(this.dimensions);
    for (let i = 0; i < this.dimensions; i++) {
      result[i] = vec[i] / norm;
    }
    return result;
  }
}
