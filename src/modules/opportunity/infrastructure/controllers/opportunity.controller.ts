import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { asOpportunityId } from '../../../shared/domain/typed-id';
import { createOpportunityNotFoundError } from '../../../shared/domain/errors';
import { SyncOpportunitiesUseCase } from '../../application/use-cases/sync-opportunities.use-case';
import { SearchOpportunitiesUseCase } from '../../application/use-cases/search-opportunities.use-case';
import { GetOpportunityByIdUseCase } from '../../application/use-cases/get-opportunity-by-id.use-case';
import { ZodValidationPipe } from '../../../shared/infrastructure/http/zod-validation.pipe';
import { canonicalizeDepartment } from '../../../shared/domain/colombian-departments';
import { DomainErrorException } from '../../../shared/infrastructure/http/global-exception.filter';
import {
  ErrorEnvelopeDto,
  OpportunityDetail,
  OpportunitySummaryPageDto,
  SyncOpportunitiesResponseDto,
  toOpportunityDetailDto,
  toOpportunitySummaryDto,
} from '../../../shared/infrastructure/http/response.dtos';
import {
  SyncOpportunitiesDto,
  syncOpportunitiesSchema,
} from './dtos/sync-opportunities.dto';
import {
  ListOpportunitiesQueryDto,
  ListOpportunitiesQueryInput,
  listOpportunitiesQuerySchema,
} from './dtos/search-opportunities.dto';
import { z } from 'zod';

@ApiTags('Opportunities')
@Controller('opportunities')
export class OpportunityController {
  constructor(
    private readonly searchOpportunitiesUseCase: SearchOpportunitiesUseCase,
    private readonly getOpportunityByIdUseCase?: GetOpportunityByIdUseCase,
    private readonly syncOpportunitiesUseCase?: SyncOpportunitiesUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listado paginado de oportunidades con niveles y filtros',
    description:
      'Retorna una página de oportunidades con niveles de coincidencia (matchTier 1, 2 o 3). Con parámetro `q`, toma hasta 300 candidatos del recuperador híbrido (solo exclusiones duras), los evalúa y pagina en memoria; los resultados más allá de 300 no son alcanzables. Sin `q`, consulta directamente sobre PostgreSQL aplicando los criterios en tres estados y ordenando por nivel.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description:
      'Página de oportunidades que cumplen los criterios de búsqueda y filtrado',
    type: OpportunitySummaryPageDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Parámetros de consulta o paginación inválidos',
    type: ErrorEnvelopeDto,
  })
  @ApiQuery({
    name: 'q',
    required: false,
    type: String,
    description:
      "Consulta en lenguaje natural o palabras clave (habilita búsqueda híbrida y sort='relevance')",
  })
  @ApiQuery({
    name: 'department',
    required: false,
    type: String,
    description: 'Departamento de ejecución territorial del contrato',
  })
  @ApiQuery({
    name: 'categoryPrefix',
    required: false,
    type: String,
    description: 'Prefijo de código UNSPSC (ej. V1.4323 o 4323)',
  })
  @ApiQuery({
    name: 'minAmount',
    required: false,
    type: Number,
    minimum: 0,
    description: 'Cuantía mínima estimada en COP',
  })
  @ApiQuery({
    name: 'maxAmount',
    required: false,
    type: Number,
    minimum: 0,
    description: 'Cuantía máxima estimada en COP',
  })
  @ApiQuery({
    name: 'status',
    required: false,
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
  @ApiQuery({
    name: 'modality',
    required: false,
    type: String,
    description: 'Modalidad de selección (ej. Licitación pública)',
  })
  @ApiQuery({
    name: 'closingAfter',
    required: false,
    type: String,
    format: 'date-time',
    description:
      'Fecha límite de presentación posterior a esta fecha (ISO-8601)',
  })
  @ApiQuery({
    name: 'closingBefore',
    required: false,
    type: String,
    format: 'date-time',
    description:
      'Fecha límite de presentación anterior a esta fecha (ISO-8601)',
  })
  @ApiQuery({
    name: 'onlyCompetitive',
    required: false,
    type: Boolean,
    schema: { type: 'boolean', default: true },
    description: 'Solo procesos competitivos (excluye contratación directa)',
  })
  @ApiQuery({
    name: 'onlyOpen',
    required: false,
    type: Boolean,
    schema: { type: 'boolean', default: true },
    description: 'Solo procesos abiertos para presentación de propuestas',
  })
  @ApiQuery({
    name: 'includeMismatches',
    required: false,
    type: Boolean,
    schema: { type: 'boolean', default: false },
    description:
      'Incluye resultados que incumplen algún criterio definido (nivel 3)',
  })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['publishedAt', 'closingDate', 'amount', 'relevance'],
    description:
      "Criterio de orden; por defecto 'relevance' con q y 'publishedAt' sin q",
  })
  @ApiQuery({
    name: 'order',
    required: false,
    schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
    description: 'Dirección del ordenamiento',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { type: 'integer', minimum: 1, default: 1 },
    description: 'Número de página a consultar (inicia en 1)',
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
    description: 'Cantidad de elementos por página (1 a 50)',
  })
  async list(
    @Query(new ZodValidationPipe(listOpportunitiesQuerySchema))
    query: ListOpportunitiesQueryInput,
  ): Promise<OpportunitySummaryPageDto> {
    const result = await this.searchOpportunitiesUseCase.executePaged({
      q: query.q,
      filters: {
        categoryCode: query.categoryPrefix,
        categoryPrefix: query.categoryPrefix,
        department: query.department
          ? (canonicalizeDepartment(query.department) ?? query.department)
          : undefined,
        amountMin: query.minAmount,
        amountMax: query.maxAmount,
        status: query.status,
        modality: query.modality,
        closingAfter: query.closingAfter,
        closingBefore: query.closingBefore,
        onlyCompetitive: query.onlyCompetitive,
        onlyOpen: query.onlyOpen,
        includeMismatches: query.includeMismatches,
        sort: query.sort,
        order: query.order,
        page: query.page,
        pageSize: query.pageSize,
      },
    });

    if (!result.ok) {
      throw new DomainErrorException(result.error);
    }

    return {
      items: result.value.items.map((opp) => toOpportunitySummaryDto(opp)),
      total: result.value.total,
      page: result.value.page,
      pageSize: result.value.pageSize,
      tierCounts: result.value.tierCounts ?? {
        1: result.value.total,
        2: 0,
        3: 0,
      },
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Obtener detalle de una oportunidad por ID',
    description:
      'Retorna el detalle de una oportunidad de contratación. Si aún no cuenta con resumen analítico, encola el trabajo de generación bajo demanda y responde con summaryStatus = "pending".',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador único de la oportunidad',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description:
      'Detalle de la oportunidad con estado de resumen (pending | ready | fallback | unavailable)',
    type: OpportunityDetail,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'La oportunidad solicitada no existe',
    type: ErrorEnvelopeDto,
  })
  async getById(
    @Param('id', new ZodValidationPipe(z.string().min(1))) id: string,
  ): Promise<OpportunityDetail> {
    if (!this.getOpportunityByIdUseCase) {
      throw new DomainErrorException(
        createOpportunityNotFoundError(asOpportunityId(id)),
      );
    }

    const result = await this.getOpportunityByIdUseCase.execute({
      opportunityId: asOpportunityId(id),
    });

    if (!result.ok) {
      throw new DomainErrorException(result.error);
    }

    return toOpportunityDetailDto(
      result.value.opportunity,
      result.value.summaryStatus,
    );
  }
}
