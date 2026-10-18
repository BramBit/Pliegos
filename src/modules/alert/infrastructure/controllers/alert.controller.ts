import { Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ReviewFollowUpUseCase } from '../../application/use-cases/review-follow-up.use-case';
import {
  ErrorEnvelopeDto,
  ReviewFollowUpResponseDto,
} from '../../../shared/infrastructure/http/response.dtos';

@ApiTags('Alerts')
@Controller('alerts')
export class AlertController {
  constructor(
    private readonly reviewFollowUpUseCase: ReviewFollowUpUseCase,
  ) {}

  @Post('review-follow-up')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ejecutar revisión de seguimiento de alertas',
    description:
      'Recorre todas las alertas no entregadas en la base de datos (adendas, cambios de estado o plazos críticos), envía las notificaciones por correo electrónico a través de NotificationPort y las marca como entregadas.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Revisión y envío de alertas completado exitosamente',
    type: ReviewFollowUpResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Error interno al procesar alertas',
    type: ErrorEnvelopeDto,
  })
  async reviewFollowUp(): Promise<ReviewFollowUpResponseDto> {
    const result = await this.reviewFollowUpUseCase.execute();
    if (result.ok) {
      return result.value;
    }
    return { alertsSent: 0 };
  }
}
