import { z } from 'zod';

export const listAlertsQuerySchema = z.object({
  page: z.preprocess(
    (val) => (val === undefined || val === '' ? 1 : Number(val)),
    z.number().int().min(1).default(1),
  ),
  pageSize: z.preprocess(
    (val) => (val === undefined || val === '' ? 20 : Number(val)),
    z.number().int().min(1).max(100).default(20),
  ),
});

export type ListAlertsQuery = z.infer<typeof listAlertsQuerySchema>;
