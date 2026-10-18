import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { GetRecommendationFeedUseCase } from '../../application/use-cases/get-recommendation-feed.use-case';
import { WatchOpportunityUseCase } from '../../application/use-cases/watch-opportunity.use-case';
import { UnwatchOpportunityUseCase } from '../../application/use-cases/unwatch-opportunity.use-case';
import { GetWatchedOpportunitiesUseCase } from '../../application/use-cases/get-watched-opportunities.use-case';
import { GetProfileSummaryUseCase } from '../../application/use-cases/get-profile-summary.use-case';
import { asProfileId, asOpportunityId } from '../../../shared/domain/typed-id';
import { ZodValidationPipe } from '../../../shared/infrastructure/http/zod-validation.pipe';
import { DomainErrorException } from '../../../shared/infrastructure/http/global-exception.filter';
import {
  ErrorEnvelopeDto,
  RecommendationPageDto,
  WatchedOpportunityPageDto,
  ProfileSummaryDto,
  RegisterFeedbackResponseDto,
  toRecommendationDto,
  toWatchedOpportunityDto,
} from '../../../shared/infrastructure/http/response.dtos';
import {
  RecommendationFeedQuery,
  recommendationFeedQuerySchema,
} from './dtos/recommendation-feed.dto';
import {
  ListWatchesQuery,
  listWatchesQuerySchema,
} from './dtos/list-watches.dto';

@ApiTags('Recommendations')
@Controller('profiles')
export class ProfileRecommendationsController {
  constructor(
    private readonly getRecommendationFeedUseCase: GetRecommendationFeedUseCase,
    private readonly watchOpportunityUseCase: WatchOpportunityUseCase,
    private readonly unwatchOpportunityUseCase: UnwatchOpportunityUseCase,
    private readonly getWatchedOpportunitiesUseCase: GetWatchedOpportunitiesUseCase,
    private readonly getProfileSummaryUseCase: GetProfileSummaryUseCase,
  ) {}

  @Get(':id/recommendations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Feed de recomendaciones filtrado y paginado para un perfil',
    description:
      'Retorna el feed de recomendaciones para un perfil con joins SQL eficientes en una única consulta, filtrable por estado (new, participate, discard, all) y minScore.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador único del perfil',
    example: 'd9b2d63d-a232-4d2c-8cb4-e5e6b72a44f1',
  })
  @ApiQuery({
    name: 'state',
    required: false,
    enum: ['new', 'participate', 'discard', 'all'],
    description: 'Estado de feedback (por defecto new)',
    example: 'new',
  })
  @ApiQuery({
    name: 'minScore',
    required: false,
    type: Number,
    description: 'Puntuación mínima de afinidad (0.0 a 1.0)',
    example: 0.7,
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Número de página (base 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: Number,
    description: 'Tamaño de página (máximo 50)',
    example: 20,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Página de recomendaciones con resumen de oportunidad y explicaciones',
    type: RecommendationPageDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'El perfil solicitado no existe',
    type: ErrorEnvelopeDto,
  })
  async getRecommendationFeed(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(recommendationFeedQuerySchema))
    query: RecommendationFeedQuery,
  ): Promise<RecommendationPageDto> {
    const result = await this.getRecommendationFeedUseCase.execute({
      profileId: asProfileId(id),
      options: {
        state: query.state,
        minScore: query.minScore,
        page: query.page,
        pageSize: query.pageSize,
      },
    });

    if (!result.ok) {
      throw new DomainErrorException(result.error);
    }

    const feed = result.value;
    const now = new Date();

    return {
      items: feed.items.map((item) =>
        toRecommendationDto(
          {
            id: item.id,
            profileId: item.profileId,
            opportunityId: item.opportunityId,
            score: item.score,
            explanation: item.explanation,
            feedback: item.feedback,
          },
          item.opportunity,
          now,
          {
            lastRefreshedAt: feed.lastRefreshedAt,
            degraded: feed.degraded,
          },
        ),
      ),
      total: feed.total,
      page: feed.page,
      pageSize: feed.pageSize,
      lastRefreshedAt: feed.lastRefreshedAt ? feed.lastRefreshedAt.toISOString() : null,
      degraded: feed.degraded,
    };
  }

  @Get(':id/summary')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resumen de actividad e indicadores clave para un perfil',
    description:
      'Retorna métricas clave para la pantalla principal: recomendaciones pendientes, convocatorias vigiladas, vigiladas con cierre en menos de 7 días y alertas pendientes.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador único del perfil',
    example: 'd9b2d63d-a232-4d2c-8cb4-e5e6b72a44f1',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Resumen de métricas del perfil',
    type: ProfileSummaryDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'El perfil solicitado no existe',
    type: ErrorEnvelopeDto,
  })
  async getProfileSummary(@Param('id') id: string): Promise<ProfileSummaryDto> {
    const result = await this.getProfileSummaryUseCase.execute({
      profileId: asProfileId(id),
    });

    if (!result.ok) {
      throw new DomainErrorException(result.error);
    }

    return result.value;
  }

  @Get(':id/watches')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Listado paginado de oportunidades vigiladas por un perfil',
    description:
      'Retorna las oportunidades actualmente bajo seguimiento/vigilancia con sus últimos 10 cambios registrados.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador único del perfil',
    example: 'd9b2d63d-a232-4d2c-8cb4-e5e6b72a44f1',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    example: 1,
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: Number,
    example: 20,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Página de oportunidades vigiladas',
    type: WatchedOpportunityPageDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'El perfil solicitado no existe',
    type: ErrorEnvelopeDto,
  })
  async getWatchedOpportunities(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(listWatchesQuerySchema))
    query: ListWatchesQuery,
  ): Promise<WatchedOpportunityPageDto> {
    const result = await this.getWatchedOpportunitiesUseCase.execute({
      profileId: asProfileId(id),
      page: query.page,
      pageSize: query.pageSize,
    });

    if (!result.ok) {
      throw new DomainErrorException(result.error);
    }

    const now = new Date();
    return {
      items: result.value.items.map((item) => toWatchedOpportunityDto(item, now)),
      total: result.value.total,
      page: result.value.page,
      pageSize: result.value.pageSize,
    };
  }

  @Post(':id/watches/:opportunityId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Agregar una oportunidad a la lista de vigilancia del perfil',
    description:
      'Registra manualmente la oportunidad en la lista de seguimiento del contratista.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador único del perfil',
    example: 'd9b2d63d-a232-4d2c-8cb4-e5e6b72a44f1',
  })
  @ApiParam({
    name: 'opportunityId',
    description: 'Identificador de la oportunidad a vigilar',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Oportunidad agregada a la lista de vigilancia',
    type: RegisterFeedbackResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'El perfil o la oportunidad no existe',
    type: ErrorEnvelopeDto,
  })
  async watchOpportunity(
    @Param('id') id: string,
    @Param('opportunityId') opportunityId: string,
  ): Promise<RegisterFeedbackResponseDto> {
    const result = await this.watchOpportunityUseCase.execute({
      profileId: asProfileId(id),
      opportunityId: asOpportunityId(opportunityId),
    });

    if (!result.ok) {
      throw new DomainErrorException(result.error);
    }

    return { success: true, message: 'Opportunity watched successfully' };
  }

  @Delete(':id/watches/:opportunityId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remover una oportunidad de la lista de vigilancia del perfil',
    description: 'Elimina la oportunidad de la lista de seguimiento del contratista.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador único del perfil',
    example: 'd9b2d63d-a232-4d2c-8cb4-e5e6b72a44f1',
  })
  @ApiParam({
    name: 'opportunityId',
    description: 'Identificador de la oportunidad a dejar de vigilar',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Oportunidad removida de la lista de vigilancia',
    type: RegisterFeedbackResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'El perfil solicitado no existe',
    type: ErrorEnvelopeDto,
  })
  async unwatchOpportunity(
    @Param('id') id: string,
    @Param('opportunityId') opportunityId: string,
  ): Promise<RegisterFeedbackResponseDto> {
    const result = await this.unwatchOpportunityUseCase.execute({
      profileId: asProfileId(id),
      opportunityId: asOpportunityId(opportunityId),
    });

    if (!result.ok) {
      throw new DomainErrorException(result.error);
    }

    return { success: true, message: 'Opportunity unwatched successfully' };
  }
}
