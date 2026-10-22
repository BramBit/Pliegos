import {
  EmbedderPort,
  TextGeneratorPort,
} from '../../../recommendation/domain/ports/ai-provider.port';
import { AiMetricsService } from './ai-metrics.service';
import {
  MeasuredEmbedder,
  MeasuredTextGenerator,
} from './measured-ai.decorator';

describe('Measured AI Decorators', () => {
  let metricsService: AiMetricsService;

  beforeEach(() => {
    metricsService = new AiMetricsService();
  });

  describe('MeasuredEmbedder', () => {
    let mockInnerEmbedder: jest.Mocked<EmbedderPort>;

    beforeEach(() => {
      mockInnerEmbedder = {
        model: 'nomic-embed-text',
        dimensions: 768,
        embed: jest.fn(),
      };
    });

    it('records successful calls with latency, characters and ok status', async () => {
      mockInnerEmbedder.embed.mockResolvedValueOnce([[0.1, 0.2, 0.3]]);
      const decorator = new MeasuredEmbedder(
        mockInnerEmbedder,
        metricsService,
        'opportunity-indexing',
      );

      const result = await decorator.embed(['hello world']);

      expect(result).toEqual([[0.1, 0.2, 0.3]]);
      expect(mockInnerEmbedder.embed).toHaveBeenCalledWith(['hello world']);

      const report = metricsService.getReport();
      expect(report.overall.calls).toBe(1);
      expect(report.overall.failures).toBe(0);
      expect(report.byFeature['opportunity-indexing'].calls).toBe(1);
      expect(report.byFeature['opportunity-indexing'].failures).toBe(0);
    });

    it('records failure in metrics and rethrows the original error when inner embedder fails', async () => {
      const error = new Error('Ollama connection timeout');
      mockInnerEmbedder.embed.mockRejectedValueOnce(error);

      const decorator = new MeasuredEmbedder(
        mockInnerEmbedder,
        metricsService,
        'opportunity-indexing',
      );

      await expect(decorator.embed(['test input'])).rejects.toThrow(
        'Ollama connection timeout',
      );

      const report = metricsService.getReport();
      expect(report.overall.calls).toBe(1);
      expect(report.overall.failures).toBe(1);
      expect(report.byFeature['opportunity-indexing'].calls).toBe(1);
      expect(report.byFeature['opportunity-indexing'].failures).toBe(1);
    });
  });

  describe('MeasuredTextGenerator', () => {
    let mockInnerGenerator: jest.Mocked<TextGeneratorPort>;

    beforeEach(() => {
      mockInnerGenerator = {
        summarize: jest.fn(),
      };
    });

    it('records successful summarization calls in metrics', async () => {
      mockInnerGenerator.summarize.mockResolvedValueOnce('Summary text');
      const decorator = new MeasuredTextGenerator(
        mockInnerGenerator,
        metricsService,
        'summarization',
        'llama3.1',
      );

      const result = await decorator.summarize('Long opportunity description');

      expect(result).toBe('Summary text');
      expect(mockInnerGenerator.summarize).toHaveBeenCalledWith(
        'Long opportunity description',
      );

      const report = metricsService.getReport();
      expect(report.overall.calls).toBe(1);
      expect(report.overall.failures).toBe(0);
      expect(report.byFeature['summarization'].calls).toBe(1);
    });

    it('records failure in metrics and rethrows the error when inner summarizer fails', async () => {
      const error = new Error('LLM model out of memory');
      mockInnerGenerator.summarize.mockRejectedValueOnce(error);

      const decorator = new MeasuredTextGenerator(
        mockInnerGenerator,
        metricsService,
        'summarization',
        'llama3.1',
      );

      await expect(decorator.summarize('Some document')).rejects.toThrow(
        'LLM model out of memory',
      );

      const report = metricsService.getReport();
      expect(report.overall.calls).toBe(1);
      expect(report.overall.failures).toBe(1);
      expect(report.byFeature['summarization'].calls).toBe(1);
      expect(report.byFeature['summarization'].failures).toBe(1);
    });
  });

  describe('percentile calculations across 100 calls', () => {
    it('calculates p50 and p95 accurately', () => {
      for (let i = 1; i <= 100; i++) {
        metricsService.record({
          feature: 'test',
          model: 'm',
          latencyMs: i,
          inputChars: 10,
          success: true,
        });
      }

      const report = metricsService.getReport();
      expect(report.overall.calls).toBe(100);
      expect(report.overall.failures).toBe(0);
      expect(report.overall.p50).toBe(50);
      expect(report.overall.p95).toBe(95);
    });
  });
});
