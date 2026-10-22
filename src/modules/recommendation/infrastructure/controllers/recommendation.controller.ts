import {
  Controller,
  Post,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { RegisterFeedbackUseCase } from '../../application/use-cases/register-feedback.use-case';
import { UndoFeedbackUseCase } from '../../application/use-cases/undo-feedback.use-case';
import { asRecommendationId, asUserId } from '../../../shared/domain/typed-id';
import {
  ZodValidationPipe,
  uuidParamSchema,
} from '../../../shared/infrastructure/http/zod-validation.pipe';
import { DomainErrorException } from '../../../shared/infrastructure/http/global-exception.filter';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../../../auth/infrastructure/security/current-user.decorator';
import {
  ErrorEnvelopeDto,
  RegisterFeedbackResponseDto,
} from '../../../shared/infrastructure/http/response.dtos';
import {
  RegisterFeedbackDto,
  registerFeedbackSchema,
} from './dtos/register-feedback.dto';
import { z } from 'zod';

@ApiTags('Recommendations')
@Controller('recommendations')
export class RecommendationController {
  constructor(
    private readonly registerFeedbackUseCase: RegisterFeedbackUseCase,
    private readonly undoFeedbackUseCase: UndoFeedbackUseCase,
  ) {}

  @Post(':id/feedback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Registrar feedback sobre una recomendación',
    description:
      'Guarda la decisión del usuario (Participate o Discard) respecto a una recomendación específica. Participate crea una vigilancia en la misma transacción y Discard la remueve si existía.',
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
    @Param('id', new ZodValidationPipe(uuidParamSchema)) id: string,
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(registerFeedbackSchema))
    body: RegisterFeedbackDto,
  ): Promise<RegisterFeedbackResponseDto> {
    const result = await this.registerFeedbackUseCase.execute({
      recommendationId: asRecommendationId(id),
      decision: body.decision,
      userId: user?.sub ? asUserId(user.sub) : undefined,
    });

    if (!result.ok) {
      throw new DomainErrorException(result.error);
    }

    return { success: true, message: 'Feedback recorded successfully' };
  }

  @Delete(':id/feedback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deshacer feedback de una recomendación',
    description:
      'Elimina el feedback registrado en la recomendación y remueve la vigilancia asociada si la decisión previa era Participate.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador único de la recomendación',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Feedback eliminado exitosamente',
    type: RegisterFeedbackResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'La recomendación no fue encontrada',
    type: ErrorEnvelopeDto,
  })
  async undoFeedback(
    @Param('id', new ZodValidationPipe(uuidParamSchema)) id: string,
    @CurrentUser() user: CurrentUserPayload | undefined,
  ): Promise<RegisterFeedbackResponseDto> {
    const result = await this.undoFeedbackUseCase.execute({
      recommendationId: asRecommendationId(id),
      userId: user?.sub ? asUserId(user.sub) : undefined,
    });

    if (!result.ok) {
      throw new DomainErrorException(result.error);
    }

    return { success: true, message: 'Feedback removed successfully' };
  }
}
