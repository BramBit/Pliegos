import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { z } from 'zod';
import { Roles } from '../../../auth/infrastructure/security/roles.decorator';
import {
  ZodValidationPipe,
  uuidParamSchema,
} from '../../../shared/infrastructure/http/zod-validation.pipe';
import {
  ADMIN_QUEUE_PORT,
  AdminQueuePort,
  JobStatusDto,
} from '../../domain/ports/admin-queue.port';
import {
  SyncOpportunitiesDto,
  syncOpportunitiesSchema,
} from '../../../opportunity/infrastructure/controllers/dtos/sync-opportunities.dto';
import { ErrorEnvelopeDto } from '../../../shared/infrastructure/http/response.dtos';
import {
  AiMetricsReport,
  AiMetricsService,
} from '../../../shared/infrastructure/ai/ai-metrics.service';
import {
  PIPELINE_RUN_REPOSITORY_PORT,
  PipelineRun,
  PipelineRunRepositoryPort,
} from '../../domain/ports/pipeline-run-repository.port';

@ApiTags('Admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(
    @Inject(ADMIN_QUEUE_PORT)
    private readonly adminQueue: AdminQueuePort,
    @Inject(AiMetricsService)
    private readonly aiMetricsService: AiMetricsService,
    @Inject(PIPELINE_RUN_REPOSITORY_PORT)
    private readonly pipelineRunRepository: PipelineRunRepositoryPort,
  ) {}

  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Encolar sincronización operativa de oportunidades desde SECOP II (Solo Admin)',
    description:
      'Encola un trabajo en segundo plano para sincronizar oportunidades e indexarlas. Responde inmediatamente con 202 Accepted y el jobId asignado.',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Trabajo de sincronización encolado exitosamente',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Parámetros de sincronización inválidos',
    type: ErrorEnvelopeDto,
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Acceso denegado: requiere rol admin',
    type: ErrorEnvelopeDto,
  })
  async sync(
    @Body(new ZodValidationPipe(syncOpportunitiesSchema.optional()))
    body?: SyncOpportunitiesDto,
  ): Promise<{ jobId: string }> {
    return this.adminQueue.enqueueSync(body);
  }

  @Post('alerts/run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Encolar ejecución de seguimiento de alertas (Solo Admin)',
    description:
      'Encola un trabajo en segundo plano para procesar y enviar alertas no entregadas. Responde inmediatamente con 202 Accepted y el jobId asignado.',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Trabajo de procesamiento de alertas encolado exitosamente',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Acceso denegado: requiere rol admin',
    type: ErrorEnvelopeDto,
  })
  async alertsRun(): Promise<{ jobId: string }> {
    return this.adminQueue.enqueueAlertsRun();
  }

  @Post('recommendations/refresh')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Encolar refresco masivo de recomendaciones para todos los perfiles (Solo Admin)',
    description:
      'Encola trabajos de recomputación de recomendaciones para todos los perfiles registrados. Responde con 202 Accepted y el jobId asignado.',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Trabajo de refresco encolado exitosamente',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Acceso denegado: requiere rol admin',
    type: ErrorEnvelopeDto,
  })
  async recommendationsRefresh(): Promise<{ jobId: string }> {
    return this.adminQueue.enqueueRecommendationsRefresh();
  }

  @Get('jobs/:id')
  @ApiOperation({
    summary: 'Consultar estado de un trabajo administrativo (Solo Admin)',
    description:
      'Retorna el estado de ejecución, progreso y resultado de un trabajo encolado por su identificador UUID.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID del trabajo',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Estado del trabajo administrativo',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'El ID proporcionado no es un UUID válido',
    type: ErrorEnvelopeDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'El trabajo solicitado no existe',
    type: ErrorEnvelopeDto,
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Acceso denegado: requiere rol admin',
    type: ErrorEnvelopeDto,
  })
  async getJob(
    @Param('id', new ZodValidationPipe(uuidParamSchema))
    id: string,
  ): Promise<JobStatusDto> {
    const job = await this.adminQueue.getJobStatus(id);
    if (!job) {
      throw new NotFoundException(`Trabajo administrativo ${id} no encontrado`);
    }
    return job;
  }

  @Get('metrics')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Consultar métricas de llamadas a modelos de IA (Solo Admin)',
    description:
      'Retorna contadores en memoria: llamadas, fallos, y percentiles p50 y p95 de latencia de las últimas 100 llamadas.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Reporte de métricas de IA obtenido exitosamente',
  })
  async getMetrics(): Promise<AiMetricsReport> {
    return this.aiMetricsService.getReport();
  }

  @Get('pipeline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Consultar historial de ejecuciones del pipeline (Solo Admin)',
    description:
      'Retorna las últimas 20 ejecuciones registradas de los procesos del pipeline.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Historial de ejecuciones del pipeline obtenido exitosamente',
  })
  async getPipeline(): Promise<PipelineRun[]> {
    return this.pipelineRunRepository.findRecent(20);
  }
}
