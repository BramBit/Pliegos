import { ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const syncOpportunitiesSchema = z.object({
  since: z.string().datetime({ message: 'since must be an ISO 8601 date string' }).optional(),
  maxRecords: z.number().int().positive().max(1_000_000).optional(),
});

export type SyncOpportunitiesInput = z.infer<typeof syncOpportunitiesSchema>;

export class SyncOpportunitiesDto {
  @ApiPropertyOptional({
    description: 'Fecha ISO 8601 a partir de la cual sincronizar procesos modificados o nuevos',
    example: '2026-01-01T00:00:00Z',
  })
  since?: string;

  @ApiPropertyOptional({
    description:
      'Máximo de procesos a traer (paginado de a 1000). Por defecto SECOP_SYNC_MAX_RECORDS o 5000.',
    example: 5000,
  })
  maxRecords?: number;
}
