import {
  EmbedderPort,
  TextGeneratorPort,
} from '../../../recommendation/domain/ports/ai-provider.port';
import { AiMetricsService } from './ai-metrics.service';

/**
 * Decorator around EmbedderPort that records feature, model, latencyMs,
 * input size in characters, and success/failure status in AiMetricsService.
 */
export class MeasuredEmbedder implements EmbedderPort {
  constructor(
    private readonly inner: EmbedderPort,
    private readonly metrics: AiMetricsService,
    private readonly feature: string = 'embedding',
  ) {}

  get model(): string {
    return this.inner.model;
  }

  get dimensions(): number {
    return this.inner.dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const inputChars = texts.reduce((sum, t) => sum + (t ? t.length : 0), 0);
    const start = Date.now();

    try {
      const result = await this.inner.embed(texts);
      const latencyMs = Date.now() - start;
      this.metrics.record({
        feature: this.feature,
        model: this.inner.model,
        latencyMs,
        inputChars,
        success: true,
      });
      return result;
    } catch (error) {
      const latencyMs = Date.now() - start;
      this.metrics.record({
        feature: this.feature,
        model: this.inner.model,
        latencyMs,
        inputChars,
        success: false,
      });
      throw error;
    }
  }
}

/**
 * Decorator around TextGeneratorPort that records feature, model, latencyMs,
 * input size in characters, and success/failure status in AiMetricsService.
 */
export class MeasuredTextGenerator implements TextGeneratorPort {
  constructor(
    private readonly inner: TextGeneratorPort,
    private readonly metrics: AiMetricsService,
    private readonly feature: string = 'summarization',
    private readonly model: string = 'llama3.1',
  ) {}

  async summarize(text: string): Promise<string> {
    const inputChars = text ? text.length : 0;
    const start = Date.now();

    try {
      const result = await this.inner.summarize(text);
      const latencyMs = Date.now() - start;
      this.metrics.record({
        feature: this.feature,
        model: this.model,
        latencyMs,
        inputChars,
        success: true,
      });
      return result;
    } catch (error) {
      const latencyMs = Date.now() - start;
      this.metrics.record({
        feature: this.feature,
        model: this.model,
        latencyMs,
        inputChars,
        success: false,
      });
      throw error;
    }
  }
}
