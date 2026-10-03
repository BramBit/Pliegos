import { Module } from '@nestjs/common';
import { AI_PROVIDER_PORT } from '../../../recommendation/domain/ports/ai-provider.port';
import { OllamaAdapter } from '../../../recommendation/infrastructure/adapters/ollama/ollama.adapter';

@Module({
  providers: [
    {
      provide: AI_PROVIDER_PORT,
      useFactory: () => {
        return new OllamaAdapter({
          baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
          embedModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
          chatModel: process.env.OLLAMA_CHAT_MODEL || 'llama3.1',
        });
      },
    },
  ],
  exports: [AI_PROVIDER_PORT],
})
export class AiModule {}
