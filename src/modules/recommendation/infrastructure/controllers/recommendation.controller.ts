import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { GetRecommendationsUseCase } from '../../application/use-cases/get-recommendations.use-case';
import { RegisterFeedbackUseCase } from '../../application/use-cases/register-feedback.use-case';
import { asProfileId, asRecommendationId } from '../../../shared/domain/typed-id';
import { ZodValidationPipe } from '../../../shared/infrastructure/http/zod-validation.pipe';
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
      'Calcula el score de afinidad de todas las oportunidades candidatas frente al perfil indicado usando MatchingService (similitud semántica, UNSPSC, monto y ubicación) y retorna el ranking con razones explicadas.',
  })
  @ApiParam({
    name: 'profileId',
    description: 'Identificador único del perfil de contratista',
    example: 'd9b2d63d-a232-4d2c-8cb4-e5e6b72a44f1',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Lista de recomendaciones ordenadas descendentemente por score',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'El perfil solicitado no existe',
  })
  async getRecommendations(@Param('profileId') profileId: string) {
    const result = await this.getRecommendationsUseCase.execute({
      profileId: asProfileId(profileId),
    });

    if (!result.ok) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: result.error.type,
        message: `Perfil no encontrado: ${result.error.profileId}`,
      });
    }

    return result.value;
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
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'La recomendación no fue encontrada',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Decisión inválida (debe ser Participate o Discard)',
  })
  async registerFeedback(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(registerFeedbackSchema))
    body: RegisterFeedbackDto,
  ) {
    const result = await this.registerFeedbackUseCase.execute({
      recommendationId: asRecommendationId(id),
      decision: body.decision,
    });

    if (!result.ok) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: result.error.type,
        message: `Recomendación no encontrada: ${result.error.recommendationId}`,
      });
    }

    return { success: true, message: 'Feedback recorded successfully' };
  }
}
