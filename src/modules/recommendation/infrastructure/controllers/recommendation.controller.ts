import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { GetRecommendationsUseCase } from '../../application/use-cases/get-recommendations.use-case';
import { RegisterFeedbackUseCase } from '../../application/use-cases/register-feedback.use-case';
import { asProfileId, asRecommendationId } from '../../../shared/domain/typed-id';
import { ZodValidationPipe } from '../../../shared/infrastructure/http/zod-validation.pipe';
import { DomainErrorException } from '../../../shared/infrastructure/http/global-exception.filter';
import {
  ErrorEnvelopeDto,
  RecommendationDto,
  RegisterFeedbackResponseDto,
  toRecommendationDto,
} from '../../../shared/infrastructure/http/response.dtos';
import {
  RegisterFeedbackDto,
  registerFeedbackSchema,
} from './dtos/register-feedback.dto';

@ApiTags('Recommendations')
@Controller('recommendations')
export class RecommendationController {
  constructor(
    private readonly getRecommendationsUseCase: GetRecommendationsUseCase,
    private readonly registerFeedbackUseCase: RegisterFeedbackUseCase,
  ) {}

  @Get(':profileId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Obtener recomendaciones priorizadas para un perfil',
    description:
      'Retorna las recomendaciones precalculadas para el perfil indicado ordenadas descendentemente por score con sus factores explicados.',
  })
  @ApiParam({
    name: 'profileId',
    description: 'Identificador único del perfil de contratista',
    example: 'd9b2d63d-a232-4d2c-8cb4-e5e6b72a44f1',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Lista de recomendaciones ordenadas descendentemente por score',
    type: [RecommendationDto],
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'El perfil solicitado no existe',
    type: ErrorEnvelopeDto,
  })
  async getRecommendations(
    @Param('profileId') profileId: string,
    @Query('limit') limit?: string,
  ): Promise<RecommendationDto[]> {
    const parsedLimit = Number.parseInt(limit ?? '', 10);
    const result = await this.getRecommendationsUseCase.execute({
      profileId: asProfileId(profileId),
      limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : undefined,
    });

    if (!result.ok) {
      throw new DomainErrorException(result.error);
    }

    return result.value.map((rec) => toRecommendationDto(rec));
  }

  @Post(':id/feedback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Registrar feedback sobre una recomendación',
    description:
      'Guarda la decisión del usuario (Participate o Discard) respecto a una recomendación específica para alimentar el ciclo de aprendizaje de la plataforma.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador único de la recomendación',
    example: 'rec-123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Decisión de feedback guardada exitosamente',
    type: RegisterFeedbackResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Decisión inválida (debe ser Participate o Discard)',
    type: ErrorEnvelopeDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'La recomendación no fue encontrada',
    type: ErrorEnvelopeDto,
  })
  async registerFeedback(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(registerFeedbackSchema))
    body: RegisterFeedbackDto,
  ): Promise<RegisterFeedbackResponseDto> {
    const result = await this.registerFeedbackUseCase.execute({
      recommendationId: asRecommendationId(id),
      decision: body.decision,
    });

    if (!result.ok) {
      throw new DomainErrorException(result.error);
    }

    return { success: true, message: 'Feedback recorded successfully' };
  }
}
