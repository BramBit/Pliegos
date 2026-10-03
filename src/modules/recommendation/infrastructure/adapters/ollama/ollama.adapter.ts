import { Injectable, Logger, LoggerService } from '@nestjs/common';
import { AIProviderPort } from '../../../domain/ports/ai-provider.port';

export interface OllamaAdapterOptions {
  readonly baseUrl?: string;
  readonly embedModel?: string;
  readonly chatModel?: string;
  readonly fetchFn?: typeof fetch;
  readonly logger?: LoggerService;
}

export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
export const DEFAULT_EMBED_MODEL = 'nomic-embed-text';
export const DEFAULT_CHAT_MODEL = 'llama3.1';
export const EXPECTED_EMBEDDING_DIMENSIONS = 768;

@Injectable()
export class OllamaAdapter implements AIProviderPort {
  private readonly baseUrl: string;
  private readonly embedModel: string;
  private readonly chatModel: string;
  private readonly fetchFn: typeof fetch;
  private readonly logger: LoggerService;

  constructor(options?: OllamaAdapterOptions) {
    this.baseUrl = (options?.baseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, '');
    this.embedModel = options?.embedModel ?? DEFAULT_EMBED_MODEL;
    this.chatModel = options?.chatModel ?? DEFAULT_CHAT_MODEL;
    this.fetchFn = options?.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.logger = options?.logger ?? new Logger(OllamaAdapter.name);
  }

  /**
   * Generates a dense vector embedding using local Ollama model nomic-embed-text (768 dimensions).
   */
  async embed(text: string): Promise<number[]> {
    if (!text || text.trim() === '') {
      return new Array(EXPECTED_EMBEDDING_DIMENSIONS).fill(0);
    }

    const url = `${this.baseUrl}/api/embeddings`;
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.embedModel,
        prompt: text,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama embed error (${url}): HTTP ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { embedding?: number[] };
    if (!data || !Array.isArray(data.embedding)) {
      throw new Error(`Ollama embed error: invalid response format from model ${this.embedModel}`);
    }

    if (data.embedding.length !== EXPECTED_EMBEDDING_DIMENSIONS) {
      this.logger.warn(
        `Ollama embedding dimension mismatch: expected ${EXPECTED_EMBEDDING_DIMENSIONS}, received ${data.embedding.length}`,
      );
    }

    return data.embedding;
  }

  /**
   * Generates a concise summary in Spanish for public procurement opportunities using local chat model.
   */
  async summarize(text: string): Promise<string> {
    if (!text || text.trim() === '') {
      return '';
    }

    const prompt = `Resume de forma neutral y concisa en un parrafo en espanol el siguiente texto de un proceso de contratacion:

${text}

Resumen:`;

    const url = `${this.baseUrl}/api/generate`;
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.chatModel,
        prompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama summarize error (${url}): HTTP ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { response?: string };
    return (data?.response ?? '').trim();
  }

  /**
   * Evaluates semantic similarity between profile and opportunity descriptions using local chat model,
   * returning a float between 0.0 and 1.0.
   */
  async scoreSimilarity(textA: string, textB: string): Promise<number> {
    if (!textA.trim() || !textB.trim()) {
      return 0.0;
    }

    const prompt = `Evalua la afinidad tematica y similitud semantica entre estos dos textos en el contexto de contratacion publica en una escala numerica de 0.0 a 1.0 (donde 1.0 es coincidencia ideal o identidad tematica, y 0.0 es ninguna relacion).
Responde UNICAMENTE con el numero flotante, sin palabras ni explicaciones adicionales.

Texto A: ${textA}
Texto B: ${textB}

Puntaje:`;

    try {
      const url = `${this.baseUrl}/api/generate`;
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.chatModel,
          prompt,
          stream: false,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as { response?: string };
        const rawOutput = (data?.response ?? '').trim();
        const score = this.parseScoreFromOutput(rawOutput);

        if (score !== null) {
          return score;
        }
      }
    } catch (err) {
      this.logger.warn(`Ollama chat scoring failed: ${(err as Error).message}. Falling back to cosine similarity.`);
    }

    // Fallback: cosine similarity between nomic-embed-text vectors
    return this.cosineSimilarityFallback(textA, textB);
  }

  private parseScoreFromOutput(output: string): number | null {
    // Extract first valid float in range 0.0 to 1.0
    const match = output.match(/\b(1(\.0+)?|0(\.\d+)?)\b/);
    if (!match) return null;

    const parsed = parseFloat(match[0]);
    if (isNaN(parsed)) return null;

    return Math.max(0.0, Math.min(1.0, parsed));
  }

  private async cosineSimilarityFallback(textA: string, textB: string): Promise<number> {
    const [vecA, vecB] = await Promise.all([this.embed(textA), this.embed(textB)]);

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) return 0;
    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    return Math.max(0.0, Math.min(1.0, similarity));
  }
}
