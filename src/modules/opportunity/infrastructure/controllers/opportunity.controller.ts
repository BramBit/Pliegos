import {
  Controller,
  Get,
  Post,
  Param,
  Body,
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
import { DomainErrorException } from '../../../shared/infrastructure/http/global-exception.filter';
import {
  ErrorEnvelopeDto,
  OpportunityDetail,
  OpportunitySummary,
  SyncOpportunitiesResponseDto,
  toOpportunityDetailDto,
  toOpportunitySummaryDto,
} from '../../../shared/infrastructure/http/response.dtos';
import {
  SyncOpportunitiesDto,
  syncOpportunitiesSchema,
} from './dtos/sync-opportunities.dto';
import {
  SearchOpportunitiesDto,
  searchOpportunitiesSchema,
} from './dtos/search-opportunities.dto';

@ApiTags('Opportunities')
@Controller('opportunities')
export class OpportunityController {
  constructor(
    private readonly syncOpportunitiesUseCase: SyncOpportunitiesUseCase,
    private readonly searchOpportunitiesUseCase: SearchOpportunitiesUseCase,
    private readonly getOpportunityByIdUseCase?: GetOpportunityByIdUseCase,
  ) {}

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
    description: 'Detalle de la oportunidad con estado de resumen (pending | ready | fallback | unavailable)',
    type: OpportunityDetail,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'La oportunidad solicitada no existe',
    type: ErrorEnvelopeDto,
  })
  async getById(@Param('id') id: string): Promise<OpportunityDetail> {
    if (!this.getOpportunityByIdUseCase) {
      throw new DomainErrorException(createOpportunityNotFoundError(asOpportunityId(id)));
    }

    const result = await this.getOpportunityByIdUseCase.execute({
      opportunityId: asOpportunityId(id),
    });

    if (!result.ok) {
      throw new DomainErrorException(result.error);
    }

    return toOpportunityDetailDto(result.value.opportunity, result.value.summaryStatus);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sincronizar oportunidades desde SECOP II',
    description:
      'Consulta la API pública de SECOP II (Socrata), normaliza los procesos hacia el modelo de dominio Opportunity, detecta cambios o nuevas convocatorias y encola los trabajos de indexación asíncrona.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Procesos sincronizados e indexados en cola correctamente',
    type: SyncOpportunitiesResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Parámetros de sincronización inválidos',
    type: ErrorEnvelopeDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_GATEWAY,
    description: 'Error de conectividad o respuesta inválida del endpoint de SECOP II',
    type: ErrorEnvelopeDto,
  })
  async sync(
    @Body(new ZodValidationPipe(syncOpportunitiesSchema))
    body: SyncOpportunitiesDto,
  ): Promise<SyncOpportunitiesResponseDto> {
    const sinceDate = body.since ? new Date(body.since) : undefined;
    const result = await this.syncOpportunitiesUseCase.execute({
      since: sinceDate,
      maxRecords: body.maxRecords ?? (Number(process.env.SECOP_SYNC_MAX_RECORDS) || 5000),
    });

    if (!result.ok) {
      throw new DomainErrorException(result.error);
    }

    return result.value;
  }

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Búsqueda estructurada y semántica de oportunidades',
    description:
      'Realiza una búsqueda combinada en el índice de pgvector: si se especifica query en lenguaje natural, ejecuta ordenamiento por distancia coseno; además aplica filtros por categoría UNSPSC, departamento y rango de cuantía.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Lista de oportunidades coincidentes con la consulta y filtros',
    type: [OpportunitySummary],
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Filtros de búsqueda inválidos',
    type: ErrorEnvelopeDto,
  })
  async search(
    @Body(new ZodValidationPipe(searchOpportunitiesSchema))
    body: SearchOpportunitiesDto,
  ): Promise<OpportunitySummary[]> {
    const result = await this.searchOpportunitiesUseCase.execute({
      query: body.query,
      filters: {
        categoryCode: body.categoryCodePrefix,
        department: body.department,
        amountMin: body.minAmount,
        amountMax: body.maxAmount,
      },
    });

    if (result.ok) {
      return result.value.map((opp) => toOpportunitySummaryDto(opp));
    }
    return [];
  }
}
