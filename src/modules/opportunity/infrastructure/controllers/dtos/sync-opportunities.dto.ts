import { ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const syncOpportunitiesSchema = z.object({
  since: z.string().datetime({ message: 'since must be an ISO 8601 date string' }).optional(),
});

export type SyncOpportunitiesInput = z.infer<typeof syncOpportunitiesSchema>;

export class SyncOpportunitiesDto {
  @ApiPropertyOptional({
    description: 'Fecha ISO 8601 a partir de la cual sincronizar procesos modificados o nuevos',
    example: '2026-01-01T00:00:00Z',
  })
  since?: string;
}
