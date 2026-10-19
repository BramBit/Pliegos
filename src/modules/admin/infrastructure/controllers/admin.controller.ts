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
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { z } from 'zod';
import { Roles } from '../../../auth/infrastructure/security/roles.decorator';
import { ZodValidationPipe, uuidParamSchema } from '../../../shared/infrastructure/http/zod-validation.pipe';
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

@ApiTags('Admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(
    @Inject(ADMIN_QUEUE_PORT)
    private readonly adminQueue: AdminQueuePort,
  ) {}

  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Encolar sincronización operativa de oportunidades desde SECOP II (Solo Admin)',
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
    summary: 'Encolar refresco masivo de recomendaciones para todos los perfiles (Solo Admin)',
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
}
