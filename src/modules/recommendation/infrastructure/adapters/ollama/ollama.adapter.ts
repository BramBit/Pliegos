import { Injectable, Logger, LoggerService } from '@nestjs/common';
import {
  EmbedderPort,
  TextGeneratorPort,
} from '../../../domain/ports/ai-provider.port';

export interface OllamaAdapterOptions {
  readonly baseUrl?: string;
  readonly embedModel?: string;
  readonly chatModel?: string;
  readonly embedTimeoutMs?: number;
  readonly chatTimeoutMs?: number;
  readonly fetchFn?: typeof fetch;
  readonly logger?: LoggerService;
}

export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
export const DEFAULT_EMBED_MODEL = 'nomic-embed-text';
export const DEFAULT_CHAT_MODEL = 'llama3.1';
export const DEFAULT_EMBED_TIMEOUT_MS = 30_000;
export const DEFAULT_CHAT_TIMEOUT_MS = 120_000;
export const EXPECTED_EMBEDDING_DIMENSIONS = 768;

@Injectable()
export class OllamaAdapter implements EmbedderPort, TextGeneratorPort {
  public readonly model: string;
  public readonly dimensions: number = EXPECTED_EMBEDDING_DIMENSIONS;
  private readonly baseUrl: string;
  private readonly chatModel: string;
  private readonly embedTimeoutMs: number;
  private readonly chatTimeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly logger: LoggerService;

  constructor(options?: OllamaAdapterOptions) {
    this.baseUrl = (options?.baseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, '');
    this.model = options?.embedModel ?? DEFAULT_EMBED_MODEL;
    this.chatModel = options?.chatModel ?? DEFAULT_CHAT_MODEL;
    this.embedTimeoutMs =
      options?.embedTimeoutMs ??
      (Number(process.env.OLLAMA_EMBED_TIMEOUT_MS) || DEFAULT_EMBED_TIMEOUT_MS);
    this.chatTimeoutMs =
      options?.chatTimeoutMs ??
      (Number(process.env.OLLAMA_CHAT_TIMEOUT_MS) || DEFAULT_CHAT_TIMEOUT_MS);
    this.fetchFn = options?.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.logger = options?.logger ?? new Logger(OllamaAdapter.name);
  }

  /**
   * Generates dense 768-dim vector embeddings in batch via Ollama `/api/embed`.
   * Falls back to sequential `/api/embeddings` calls when `/api/embed` returns 404.
   * Throws on empty input or when any returned vector does not have 768 dimensions.
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (!Array.isArray(texts) || texts.length === 0 || texts.some((t) => !t || t.trim() === '')) {
      throw new Error('Ollama embed error: cannot generate embedding for empty text');
    }

    const batchUrl = `${this.baseUrl}/api/embed`;
    const response = await this.fetchWithTimeout(
      batchUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          input: texts,
        }),
      },
      this.embedTimeoutMs,
    );

    if (response.status === 404) {
      this.logger.warn(
        `Ollama /api/embed returned 404; falling back to sequential /api/embeddings calls`,
      );
      return this.embedSequentialFallback(texts);
    }

    if (!response.ok) {
      throw new Error(
        `Ollama embed error (${batchUrl}): HTTP ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { embeddings?: number[][] };
    if (!data || !Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) {
      throw new Error(`Ollama embed error: invalid response format from model ${this.model}`);
    }

    for (const vec of data.embeddings) {
      this.assertValidDimensions(vec);
    }

    return data.embeddings;
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
    const response = await this.fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.chatModel,
          prompt,
          stream: false,
        }),
      },
      this.chatTimeoutMs,
    );

    if (!response.ok) {
      throw new Error(
        `Ollama summarize error (${url}): HTTP ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { response?: string };
    return (data?.response ?? '').trim();
  }

  private async embedSequentialFallback(texts: string[]): Promise<number[][]> {
    const url = `${this.baseUrl}/api/embeddings`;
    const results: number[][] = [];

    for (const text of texts) {
      const response = await this.fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            prompt: text,
          }),
        },
        this.embedTimeoutMs,
      );

      if (!response.ok) {
        throw new Error(
          `Ollama embed error (${url}): HTTP ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as { embedding?: number[] };
      if (!data || !Array.isArray(data.embedding)) {
        throw new Error(`Ollama embed error: invalid response format from model ${this.model}`);
      }

      this.assertValidDimensions(data.embedding);
      results.push(data.embedding);
    }

    return results;
  }

  private assertValidDimensions(vector: unknown): asserts vector is number[] {
    if (!Array.isArray(vector) || vector.length !== this.dimensions) {
      const received = Array.isArray(vector) ? vector.length : 0;
      throw new Error(
        `Ollama embedding dimension mismatch: expected ${this.dimensions}, received ${received}`,
      );
    }
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchFn(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
