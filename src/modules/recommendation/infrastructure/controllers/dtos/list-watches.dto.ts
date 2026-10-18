import { z } from 'zod';

export const listWatchesQuerySchema = z.object({
  page: z.preprocess(
    (val) => (val === undefined || val === '' ? 1 : Number(val)),
    z.number().int().min(1).default(1),
  ),
  pageSize: z.preprocess(
    (val) => (val === undefined || val === '' ? 20 : Number(val)),
    z.number().int().min(1).max(50).default(20),
  ),
});

export type ListWatchesQuery = z.infer<typeof listWatchesQuerySchema>;
