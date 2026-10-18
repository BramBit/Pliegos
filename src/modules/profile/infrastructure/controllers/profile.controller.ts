import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { ConfigureProfileUseCase } from '../../application/use-cases/configure-profile.use-case';
import { GetProfileByIdUseCase } from '../../application/use-cases/get-profile-by-id.use-case';
import { GetProfilesByOwnerUseCase } from '../../application/use-cases/get-profiles-by-owner.use-case';
import { DeleteProfileUseCase } from '../../application/use-cases/delete-profile.use-case';
import { asProfileId, asUserId } from '../../../shared/domain/typed-id';
import { createProfileNotFoundError } from '../../../shared/domain/errors';
import { ZodValidationPipe } from '../../../shared/infrastructure/http/zod-validation.pipe';
import { DomainErrorException } from '../../../shared/infrastructure/http/global-exception.filter';
import {
  ErrorEnvelopeDto,
  ProfileDto,
  toProfileDto,
} from '../../../shared/infrastructure/http/response.dtos';
import {
  ConfigureProfileDto,
  configureProfileSchema,
} from './dtos/configure-profile.dto';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../../../auth/infrastructure/security/current-user.decorator';

import { ProfileAccessService } from '../../application/services/profile-access.service';

@ApiTags('Profiles')
@Controller('profiles')
export class ProfileController {
  constructor(
    private readonly configureProfileUseCase: ConfigureProfileUseCase,
    private readonly getProfileByIdUseCase?: GetProfileByIdUseCase,
    private readonly getProfilesByOwnerUseCase?: GetProfilesByOwnerUseCase,
    private readonly deleteProfileUseCase?: DeleteProfileUseCase,
    private readonly profileAccessService?: ProfileAccessService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar perfiles del contratista autenticado',
    description:
      'Retorna todos los perfiles pertenecientes al usuario autenticado.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Lista de perfiles asociados al usuario autenticado',
    type: [ProfileDto],
  })
  async list(@CurrentUser() user: CurrentUserPayload): Promise<ProfileDto[]> {
    if (!this.getProfilesByOwnerUseCase) {
      return [];
    }
    const result = await this.getProfilesByOwnerUseCase.execute({
      ownerId: asUserId(user.sub),
    });
    if (!result.ok) {
      return [];
    }
    return result.value.map((p) => toProfileDto(p));
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Obtener un perfil por ID',
    description: 'Retorna el perfil completo de un contratista perteneciente al usuario autenticado.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador único del perfil',
    example: 'd9b2d63d-a232-4d2c-8cb4-e5e6b72a44f1',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Perfil de contratista encontrado',
    type: ProfileDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'El perfil solicitado no existe',
    type: ErrorEnvelopeDto,
  })
  async getById(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ProfileDto> {
    if (this.profileAccessService) {
      const profile = await this.profileAccessService.assertOwner(asProfileId(id), user);
      return toProfileDto(profile);
    }

    if (!this.getProfileByIdUseCase) {
      throw new DomainErrorException(createProfileNotFoundError(asProfileId(id)));
    }

    const result = await this.getProfileByIdUseCase.execute({
      profileId: asProfileId(id),
    });

    if (!result.ok) {
      throw new DomainErrorException(result.error);
    }

    return toProfileDto(result.value);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Crear perfil de contratista',
    description:
      'Crea un nuevo perfil con capacidades técnicas, preferencias territoriales canónicas de Colombia, rango de cuantía y preferencias de notificación. Encola automáticamente el job de cálculo de recomendaciones.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Perfil guardado exitosamente y trabajo de recomendación encolado',
    type: ProfileDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Datos de perfil inválidos o departamento no reconocido',
    type: ErrorEnvelopeDto,
  })
  async create(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(configureProfileSchema))
    body: ConfigureProfileDto,
  ): Promise<ProfileDto> {
    const ownerId = user?.sub || body.ownerId || '';
    const profileId = body.profileId ? asProfileId(body.profileId) : null;
    const result = await this.configureProfileUseCase.execute({
      profileId,
      data: {
        ownerId: asUserId(ownerId),
        name: body.name ?? null,
        contactEmail: body.contactEmail ?? null,
        alertsEnabled: body.alertsEnabled ?? true,
        deadlineAlertDays: body.deadlineAlertDays ?? 3,
        sector: body.sector,
        capabilities: body.capabilities,
        preferences: {
          categoryCodes: body.preferences.categoryCodes,
          keywords: body.preferences.keywords,
          amountRange: body.preferences.amountRange
            ? { min: body.preferences.amountRange.min, max: body.preferences.amountRange.max }
            : null,
          departments: body.preferences.departments,
        },
      },
    });

    if (!result.ok) {
      throw new DomainErrorException(result.error);
    }

    return toProfileDto(result.value);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reemplazar perfil de contratista',
    description:
      'Reemplaza íntegramente los datos de un perfil existente identificado por ID y refresca sus recomendaciones.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador único del perfil a reemplazar',
    example: 'd9b2d63d-a232-4d2c-8cb4-e5e6b72a44f1',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Perfil reemplazado exitosamente',
    type: ProfileDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'El perfil a actualizar no existe',
    type: ErrorEnvelopeDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Datos de perfil inválidos',
    type: ErrorEnvelopeDto,
  })
  async replace(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(configureProfileSchema))
    body: ConfigureProfileDto,
  ): Promise<ProfileDto> {
    if (this.profileAccessService) {
      await this.profileAccessService.assertOwner(asProfileId(id), user);
    } else if (this.getProfileByIdUseCase) {
      const existing = await this.getProfileByIdUseCase.execute({
        profileId: asProfileId(id),
      });
      if (!existing.ok) {
        throw new DomainErrorException(existing.error);
      }
    }

    const ownerId = user?.sub || body.ownerId || '';
    const result = await this.configureProfileUseCase.execute({
      profileId: asProfileId(id),
      data: {
        ownerId: asUserId(ownerId),
        name: body.name ?? null,
        contactEmail: body.contactEmail ?? null,
        alertsEnabled: body.alertsEnabled ?? true,
        deadlineAlertDays: body.deadlineAlertDays ?? 3,
        sector: body.sector,
        capabilities: body.capabilities,
        preferences: {
          categoryCodes: body.preferences.categoryCodes,
          keywords: body.preferences.keywords,
          amountRange: body.preferences.amountRange
            ? { min: body.preferences.amountRange.min, max: body.preferences.amountRange.max }
            : null,
          departments: body.preferences.departments,
        },
      },
    });

    if (!result.ok) {
      throw new DomainErrorException(result.error);
    }

    return toProfileDto(result.value);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Eliminar un perfil de contratista',
    description:
      'Elimina el perfil especificado por ID. La eliminación se propaga en cascada a recomendaciones y alertas.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador único del perfil a eliminar',
    example: 'd9b2d63d-a232-4d2c-8cb4-e5e6b72a44f1',
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Perfil eliminado exitosamente',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'El perfil no existe',
    type: ErrorEnvelopeDto,
  })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    if (this.profileAccessService) {
      await this.profileAccessService.assertOwner(asProfileId(id), user);
    }

    if (!this.deleteProfileUseCase) {
      return;
    }

    const result = await this.deleteProfileUseCase.execute({
      profileId: asProfileId(id),
    });

    if (!result.ok) {
      throw new DomainErrorException(result.error);
    }
  }
}
