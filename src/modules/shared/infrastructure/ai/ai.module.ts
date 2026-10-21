import { Module, Global } from '@nestjs/common';
import {
  EMBEDDER_PORT,
  TEXT_GENERATOR_PORT,
} from '../../../recommendation/domain/ports/ai-provider.port';
import { OllamaAdapter } from '../../../recommendation/infrastructure/adapters/ollama/ollama.adapter';
import { AiMetricsService } from './ai-metrics.service';
import { MeasuredEmbedder, MeasuredTextGenerator } from './measured-ai.decorator';
import { ENV, Env } from '../../../../config/env';

@Global()
@Module({
  providers: [
    AiMetricsService,
    {
      provide: OllamaAdapter,
      inject: [ENV],
      useFactory: (env: Env) => {
        return new OllamaAdapter({
          baseUrl: env.OLLAMA_BASE_URL,
          embedModel: env.OLLAMA_EMBED_MODEL,
          chatModel: env.OLLAMA_CHAT_MODEL,
          embedTimeoutMs: env.OLLAMA_EMBED_TIMEOUT_MS,
          chatTimeoutMs: env.OLLAMA_CHAT_TIMEOUT_MS,
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
      useFactory: (adapter: OllamaAdapter, metrics: AiMetricsService, env: Env) => {
        return new MeasuredTextGenerator(adapter, metrics, 'summarization', env.OLLAMA_CHAT_MODEL);
      },
      inject: [OllamaAdapter, AiMetricsService, ENV],
    },
  ],
  exports: [EMBEDDER_PORT, TEXT_GENERATOR_PORT, AiMetricsService, OllamaAdapter],
})
export class AiModule {}
