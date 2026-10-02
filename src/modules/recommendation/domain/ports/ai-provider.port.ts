export interface AIProviderPort {
  embed(text: string): Promise<number[]>;
  scoreSimilarity(textA: string, textB: string): Promise<number>;
  summarize(text: string): Promise<string>;
}

export const AI_PROVIDER_PORT = Symbol('AI_PROVIDER_PORT');
