import { ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { OpportunityStatus } from '../../../domain/value-objects/opportunity.value-objects';
import {
  OpportunitySortField,
  SortOrder,
} from '../../../domain/value-objects/opportunity-filters';

const booleanPreprocessor = (val: unknown) => {
  if (val === undefined || val === '') return true;
  if (val === 'true' || val === true) return true;
  if (val === 'false' || val === false) return false;
  return val;
};

export const listOpportunitiesQuerySchema = z
  .object({
    q: z.string().trim().optional(),
    department: z.string().trim().optional(),
    categoryPrefix: z.string().trim().optional(),
    minAmount: z.preprocess(
      (val) => (val === '' ? undefined : val),
      z.coerce.number().nonnegative().optional(),
    ),
    maxAmount: z.preprocess(
      (val) => (val === '' ? undefined : val),
      z.coerce.number().nonnegative().optional(),
    ),
    status: z
      .enum([
        'Draft',
        'Published',
        'Amended',
        'Closed',
        'Awarded',
        'Cancelled',
        'Unknown',
      ])
      .optional(),
    modality: z.string().trim().optional(),
    closingAfter: z.preprocess(
      (val) => (val === '' ? undefined : val),
      z.coerce.date().optional(),
    ),
    closingBefore: z.preprocess(
      (val) => (val === '' ? undefined : val),
      z.coerce.date().optional(),
    ),
    onlyCompetitive: z
      .preprocess(booleanPreprocessor, z.boolean())
      .default(true),
    onlyOpen: z.preprocess(booleanPreprocessor, z.boolean()).default(true),
    includeMismatches: z
      .preprocess(booleanPreprocessor, z.boolean())
      .default(false),
    sort: z
      .enum(['publishedAt', 'closingDate', 'amount', 'relevance'])
      .optional(),
    order: z.enum(['asc', 'desc']).default('desc'),
    page: z.preprocess(
      (val) => (val === '' ? undefined : val),
      z.coerce.number().int().min(1).default(1),
    ),
    pageSize: z.preprocess(
      (val) => (val === '' ? undefined : val),
      z.coerce.number().int().min(1).max(50).default(20),
    ),
  })
  .refine(
    (data) => {
      if (data.sort === 'relevance') {
        return Boolean(data.q && data.q.trim().length > 0);
      }
      return true;
    },
    {
      message: "Sort by 'relevance' is only valid when query 'q' is provided",
      path: ['sort'],
    },
  )
  .transform((data) => ({
    ...data,
    sort: (data.sort ??
      (data.q && data.q.trim().length > 0
        ? 'relevance'
        : 'publishedAt')) as OpportunitySortField,
  }));

export type ListOpportunitiesQueryInput = z.infer<
  typeof listOpportunitiesQuerySchema
>;

export class ListOpportunitiesQueryDto {
  @ApiPropertyOptional({
    description:
      "Consulta en lenguaje natural o palabras clave (habilita búsqueda híbrida y sort='relevance')",
    example: 'desarrollo de software y plataformas web',
  })
  q?: string;

  @ApiPropertyOptional({
    description: 'Departamento de ejecución territorial del contrato',
    example: 'Antioquia',
  })
  department?: string;

  @ApiPropertyOptional({
    description:
      'Prefijo de código UNSPSC para filtrar categorías (ej. V1.4323 o 4323)',
    example: 'V1.4323',
  })
  categoryPrefix?: string;

  @ApiPropertyOptional({
    description: 'Cuantía mínima estimada en COP',
    example: 10000000,
  })
  minAmount?: number;

  @ApiPropertyOptional({
    description: 'Cuantía máxima estimada en COP',
    example: 500000000,
  })
  maxAmount?: number;

  @ApiPropertyOptional({
    enum: [
      'Draft',
      'Published',
      'Amended',
      'Closed',
      'Awarded',
      'Cancelled',
      'Unknown',
    ],
    description: 'Estado administrativo del proceso de contratación',
  })
  status?: OpportunityStatus;

  @ApiPropertyOptional({
    description:
      'Modalidad de selección o contratación (ej. Licitación pública, Selección abreviada)',
    example: 'Licitación pública',
  })
  modality?: string;

  @ApiPropertyOptional({
    description:
      'Filtra procesos con fecha límite de presentación posterior a esta fecha (ISO-8601)',
    example: '2026-10-01T00:00:00.000Z',
  })
  closingAfter?: Date;

  @ApiPropertyOptional({
    description:
      'Filtra procesos con fecha límite de presentación anterior a esta fecha (ISO-8601)',
    example: '2026-12-31T23:59:59.000Z',
  })
  closingBefore?: Date;

  @ApiPropertyOptional({
    description:
      'Filtrar exclusivamente procesos competitivos (excluye contratación directa)',
    default: true,
  })
  onlyCompetitive?: boolean;

  @ApiPropertyOptional({
    description:
      'Filtrar exclusivamente procesos abiertos para presentación de propuestas',
    default: true,
  })
  onlyOpen?: boolean;

  @ApiPropertyOptional({
    description:
      'Incluir oportunidades que no cumplen con los criterios (Nivel 3). Por defecto false.',
    default: false,
  })
  includeMismatches?: boolean;

  @ApiPropertyOptional({
    enum: ['publishedAt', 'closingDate', 'amount', 'relevance'],
    description:
      "Criterio de ordenamiento ('relevance' requiere parámetro 'q')",
    default: 'publishedAt',
  })
  sort?: OpportunitySortField;

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    description: 'Dirección del ordenamiento',
    default: 'desc',
  })
  order?: SortOrder;

  @ApiPropertyOptional({
    description: 'Número de página a consultar (inicia en 1)',
    default: 1,
    minimum: 1,
  })
  page?: number;

  @ApiPropertyOptional({
    description: 'Cantidad de elementos por página (1 a 50)',
    default: 20,
    minimum: 1,
    maximum: 50,
  })
  pageSize?: number;
}
