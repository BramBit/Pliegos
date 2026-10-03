import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadGatewayException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SyncOpportunitiesUseCase } from '../../application/use-cases/sync-opportunities.use-case';
import { SearchOpportunitiesUseCase } from '../../application/use-cases/search-opportunities.use-case';
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
  ) {}

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sincronizar oportunidades desde SECOP II',
    description:
      'Consulta la API pública de SECOP II (Socrata), normaliza los procesos hacia el modelo de dominio Opportunity, detecta cambios o nuevas convocatorias y encola los trabajos de análisis asíncrono.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Procesos sincronizados y analizados en cola correctamente',
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
    const result = await this.syncOpportunitiesUseCase.execute({ since: sinceDate });

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
