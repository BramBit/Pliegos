import { Module } from '@nestjs/common';
import {
  EMBEDDER_PORT,
  TEXT_GENERATOR_PORT,
} from '../../../recommendation/domain/ports/ai-provider.port';
import { OllamaAdapter } from '../../../recommendation/infrastructure/adapters/ollama/ollama.adapter';

@Module({
  providers: [
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
      useExisting: OllamaAdapter,
    },
    {
      provide: TEXT_GENERATOR_PORT,
      useExisting: OllamaAdapter,
    },
  ],
  exports: [EMBEDDER_PORT, TEXT_GENERATOR_PORT],
})
export class AiModule {}
