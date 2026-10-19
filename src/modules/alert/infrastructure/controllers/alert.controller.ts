import {
  Controller,
  Post,
  Param,
  HttpCode,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { asAlertId } from '../../../shared/domain/typed-id';
import { ZodValidationPipe, uuidParamSchema } from '../../../shared/infrastructure/http/zod-validation.pipe';
import { DomainErrorException } from '../../../shared/infrastructure/http/global-exception.filter';
import { createAlertNotFoundError } from '../../../shared/domain/errors';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../../../auth/infrastructure/security/current-user.decorator';
import {
  ErrorEnvelopeDto,
  MarkAlertReadResponseDto,
} from '../../../shared/infrastructure/http/response.dtos';
import {
  ALERT_REPOSITORY_PORT,
  AlertRepositoryPort,
} from '../../domain/ports/alert.repository.port';
import { ProfileAccessService } from '../../../profile/application/services/profile-access.service';
import { MarkAlertReadUseCase } from '../../application/use-cases/mark-alert-read.use-case';

@ApiTags('Alerts')
@Controller('alerts')
export class AlertController {
  constructor(
    @Inject(ALERT_REPOSITORY_PORT)
    private readonly alertRepository: AlertRepositoryPort,
    private readonly profileAccessService: ProfileAccessService,
    private readonly markAlertReadUseCase: MarkAlertReadUseCase,
  ) {}

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Marcar una alerta como leída',
    description:
      'Marca una alerta específica como leída (read_at = NOW()). Verifica que el usuario autenticado sea propietario del perfil asociado a la alerta.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador único de la alerta',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Alerta marcada como leída exitosamente',
    type: MarkAlertReadResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'La alerta o el perfil no fue encontrado',
    type: ErrorEnvelopeDto,
  })
  async markRead(
    @Param('id', new ZodValidationPipe(uuidParamSchema)) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<MarkAlertReadResponseDto> {
    const alertId = asAlertId(id);
    const alert = await this.alertRepository.findById(alertId);
    if (!alert) {
      throw new DomainErrorException(createAlertNotFoundError(alertId));
    }

    await this.profileAccessService.assertOwner(alert.profileId, user);
    await this.markAlertReadUseCase.execute({ alertId });

    return { success: true, message: 'Alert marked as read' };
  }
}
