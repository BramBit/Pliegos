import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConfigureProfileUseCase } from '../../application/use-cases/configure-profile.use-case';
import { asProfileId, asUserId } from '../../../shared/domain/typed-id';
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

@ApiTags('Profiles')
@Controller('profiles')
export class ProfileController {
  constructor(
    private readonly configureProfileUseCase: ConfigureProfileUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Configurar o actualizar perfil de contratista',
    description:
      'Registra las capacidades técnicas, sector y preferencias de contratación de una empresa u oferente, utilizadas por el motor de priorización para generar recomendaciones explicadas.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Perfil guardado exitosamente en el repositorio',
    type: ProfileDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Parámetros o invariantes de perfil inválidos',
    type: ErrorEnvelopeDto,
  })
  async configure(
    @Body(new ZodValidationPipe(configureProfileSchema))
    body: ConfigureProfileDto,
  ): Promise<ProfileDto> {
    const profileId = body.profileId ? asProfileId(body.profileId) : null;
    const result = await this.configureProfileUseCase.execute({
      profileId,
      data: {
        ownerId: asUserId(body.ownerId),
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
}
