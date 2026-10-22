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
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
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
