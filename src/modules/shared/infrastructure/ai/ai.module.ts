import { Module, Global } from '@nestjs/common';
import {
  EMBEDDER_PORT,
  TEXT_GENERATOR_PORT,
} from '../../../recommendation/domain/ports/ai-provider.port';
import { OllamaAdapter } from '../../../recommendation/infrastructure/adapters/ollama/ollama.adapter';
import { AiMetricsService } from './ai-metrics.service';
import { MeasuredEmbedder, MeasuredTextGenerator } from './measured-ai.decorator';

@Global()
@Module({
  providers: [
    AiMetricsService,
    {
      provide: OllamaAdapter,
      useFactory: () => {
        return new OllamaAdapter({
          baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
          embedModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
          chatModel: process.env.OLLAMA_CHAT_MODEL || 'llama3.1',
        });
      },
    },
    {
      provide: EMBEDDER_PORT,
      useFactory: (adapter: OllamaAdapter, metrics: AiMetricsService) => {
        return new MeasuredEmbedder(adapter, metrics, 'embedding');
      },
      inject: [OllamaAdapter, AiMetricsService],
    },
    {
      provide: TEXT_GENERATOR_PORT,
      useFactory: (adapter: OllamaAdapter, metrics: AiMetricsService) => {
        const chatModel = process.env.OLLAMA_CHAT_MODEL || 'llama3.1';
        return new MeasuredTextGenerator(adapter, metrics, 'summarization', chatModel);
      },
      inject: [OllamaAdapter, AiMetricsService],
    },
  ],
  exports: [EMBEDDER_PORT, TEXT_GENERATOR_PORT, AiMetricsService, OllamaAdapter],
})
export class AiModule {}
