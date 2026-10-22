import {
  Controller,
  Get,
  Post,
  Param,
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
import { asProfileId } from '../../../shared/domain/typed-id';
import {
  ZodValidationPipe,
  uuidParamSchema,
} from '../../../shared/infrastructure/http/zod-validation.pipe';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../../../auth/infrastructure/security/current-user.decorator';
import {
  ErrorEnvelopeDto,
  AlertInboxPageDto,
  MarkAlertReadResponseDto,
  toAlertInboxItemDto,
} from '../../../shared/infrastructure/http/response.dtos';
import { ProfileAccessService } from '../../../profile/application/services/profile-access.service';
import { DomainErrorException } from '../../../shared/infrastructure/http/global-exception.filter';
import { GetProfileAlertsUseCase } from '../../application/use-cases/get-profile-alerts.use-case';
import { MarkAllAlertsReadUseCase } from '../../application/use-cases/mark-all-alerts-read.use-case';
import { ListAlertsQuery, listAlertsQuerySchema } from './dtos/list-alerts.dto';

@ApiTags('Alerts')
@Controller('profiles')
export class ProfileAlertsController {
  constructor(
    private readonly getProfileAlertsUseCase: GetProfileAlertsUseCase,
    private readonly markAllAlertsReadUseCase: MarkAllAlertsReadUseCase,
    private readonly profileAccessService: ProfileAccessService,
  ) {}

  @Get(':id/alerts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Listado paginado de alertas de un perfil',
    description:
      'Retorna la bandeja de entrada de alertas de un perfil específico, ordenadas cronológicamente por fecha de creación descendente.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador único del perfil',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20 })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Bandeja de alertas paginada',
    type: AlertInboxPageDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Perfil no encontrado o no pertenece al usuario autenticado',
    type: ErrorEnvelopeDto,
  })
  async getAlerts(
    @Param('id', new ZodValidationPipe(uuidParamSchema)) id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query(new ZodValidationPipe(listAlertsQuerySchema)) query: ListAlertsQuery,
  ): Promise<AlertInboxPageDto> {
    const profileId = asProfileId(id);
    await this.profileAccessService.assertOwner(profileId, user);

    const result = await this.getProfileAlertsUseCase.execute({
      profileId,
      page: query.page,
      pageSize: query.pageSize,
    });

    if (!result.ok) {
      throw new DomainErrorException(result.error);
    }

    const items = result.value.items.map(toAlertInboxItemDto);
    return {
      items,
      total: result.value.total,
      page: result.value.page,
      pageSize: result.value.pageSize,
    };
  }

  @Post(':id/alerts/read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Marcar todas las alertas de un perfil como leídas',
    description:
      'Marca todas las alertas no leídas de un perfil como leídas (read_at = NOW()). Verifica que el usuario autenticado sea propietario del perfil.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador único del perfil',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Alertas marcadas como leídas exitosamente',
    type: MarkAlertReadResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Perfil no encontrado o no pertenece al usuario autenticado',
    type: ErrorEnvelopeDto,
  })
  async markAllRead(
    @Param('id', new ZodValidationPipe(uuidParamSchema)) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<MarkAlertReadResponseDto> {
    const profileId = asProfileId(id);
    await this.profileAccessService.assertOwner(profileId, user);

    const result = await this.markAllAlertsReadUseCase.execute({ profileId });
    if (!result.ok) {
      throw new DomainErrorException(result.error);
    }
    return {
      success: true,
      message: 'All alerts marked as read',
      markedCount: result.value.markedCount,
    };
  }
}
