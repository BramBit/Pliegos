import { ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const searchOpportunitiesSchema = z.object({
  query: z.string().min(1).optional(),
  categoryCodePrefix: z.string().min(1).optional(),
  department: z.string().min(1).optional(),
  minAmount: z.number().nonnegative().optional(),
  maxAmount: z.number().nonnegative().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export type SearchOpportunitiesInput = z.infer<typeof searchOpportunitiesSchema>;

export class SearchOpportunitiesDto {
  @ApiPropertyOptional({
    description: 'Consulta en lenguaje natural para búsqueda semántica vectorial',
    example: 'Desarrollo de software y mantenimiento de plataformas web',
  })
  query?: string;

  @ApiPropertyOptional({
    description: 'Prefijo de código UNSPSC para filtrar categorías (ej. V1.8011)',
    example: 'V1.8011',
  })
  categoryCodePrefix?: string;

  @ApiPropertyOptional({
    description: 'Departamento de ejecución de la contratación',
    example: 'Antioquia',
  })
  department?: string;

  @ApiPropertyOptional({
    description: 'Monto mínimo en COP para filtrar oportunidades',
    example: 50000000,
  })
  minAmount?: number;

  @ApiPropertyOptional({
    description: 'Monto máximo en COP para filtrar oportunidades',
    example: 500000000,
  })
  maxAmount?: number;

  @ApiPropertyOptional({
    description: 'Límite máximo de resultados a retornar (1-100, default 20)',
    example: 20,
    default: 20,
  })
  limit?: number;
}
