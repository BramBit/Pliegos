import { z } from 'zod';

export const recommendationFeedQuerySchema = z.object({
  state: z.enum(['new', 'participate', 'discard', 'all']).default('new'),
  minScore: z.preprocess(
    (val) => (val === undefined || val === '' ? undefined : Number(val)),
    z.number().min(0).max(1).optional(),
  ),
  page: z.preprocess(
    (val) => (val === undefined || val === '' ? 1 : Number(val)),
    z.number().int().min(1).default(1),
  ),
  pageSize: z.preprocess(
    (val) => (val === undefined || val === '' ? 20 : Number(val)),
    z.number().int().min(1).max(50).default(20),
  ),
});

export type RecommendationFeedQuery = z.infer<typeof recommendationFeedQuerySchema>;
