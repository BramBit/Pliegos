import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  BadGatewayException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { asOpportunityId } from '../../../shared/domain/typed-id';
import { SyncOpportunitiesUseCase } from '../../application/use-cases/sync-opportunities.use-case';
import { SearchOpportunitiesUseCase } from '../../application/use-cases/search-opportunities.use-case';
import { GetOpportunityByIdUseCase } from '../../application/use-cases/get-opportunity-by-id.use-case';
import { ZodValidationPipe } from '../../../shared/infrastructure/http/zod-validation.pipe';
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
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Detalle de la oportunidad con estado de resumen (pending | ready | fallback | unavailable)',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'La oportunidad solicitada no existe',
  })
  async getById(@Param('id') id: string) {
    if (!this.getOpportunityByIdUseCase) {
      throw new NotFoundException(`Oportunidad no encontrada: ${id}`);
    }

    const result = await this.getOpportunityByIdUseCase.execute({
      opportunityId: asOpportunityId(id),
    });

    if (!result.ok) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: result.error.type,
        message: `Oportunidad no encontrada: ${result.error.opportunityId}`,
      });
    }

    return {
      ...result.value.opportunity,
      summaryStatus: result.value.summaryStatus,
    };
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
    schema: {
      type: 'object',
      properties: {
        created: { type: 'number', example: 12 },
        updated: { type: 'number', example: 3 },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_GATEWAY,
    description: 'Error de conectividad o respuesta inválida del endpoint de SECOP II',
  })
  async sync(
    @Body(new ZodValidationPipe(syncOpportunitiesSchema))
    body: SyncOpportunitiesDto,
  ) {
    const sinceDate = body.since ? new Date(body.since) : undefined;
    const result = await this.syncOpportunitiesUseCase.execute({
      since: sinceDate,
      maxRecords: body.maxRecords ?? (Number(process.env.SECOP_SYNC_MAX_RECORDS) || 5000),
    });

    if (!result.ok) {
      throw new BadGatewayException({
        statusCode: HttpStatus.BAD_GATEWAY,
        error: result.error.type,
        message: `Fuente de contratación no disponible: ${result.error.sourceName}`,
      });
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
  })
  async search(
    @Body(new ZodValidationPipe(searchOpportunitiesSchema))
    body: SearchOpportunitiesDto,
  ) {
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
      return result.value;
    }
    return [];
  }
}
