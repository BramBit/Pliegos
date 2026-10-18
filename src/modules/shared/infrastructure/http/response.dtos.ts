import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Opportunity } from '../../../opportunity/domain/entities/opportunity.entity';
import {
  OpportunityStatus,
  SummaryStatus,
} from '../../../opportunity/domain/value-objects/opportunity.value-objects';
import { Profile } from '../../../profile/domain/entities/profile.entity';
import { Recommendation } from '../../../recommendation/domain/entities/recommendation.entity';
import { Alert, AlertTrigger } from '../../../alert/domain/entities/alert.entity';

const ONE_DAY_MS = 86_400_000;

export class ErrorEnvelopeDto {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({ example: 'ValidationError' })
  error!: string;

  @ApiProperty({ example: 'Validation failed' })
  message!: string;

  @ApiPropertyOptional({
    description: 'Optional structured details about the error',
    nullable: true,
  })
  details?: unknown;

  @ApiProperty({ example: 'c42d8e41-29a4-4f6a-9870-8d65e32b5011' })
  requestId!: string;
}

export class ContractingEntityDto {
  @ApiProperty({ example: 'Ministerio de Tecnologías de la Información y las Comunicaciones' })
  name!: string;

  @ApiProperty({ example: '899999053-1' })
  taxId!: string;
}

export class LocationDto {
  @ApiProperty({ type: String, nullable: true, example: 'Bogotá' })
  city!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Bogotá D.C.' })
  department!: string | null;
}

export class SourceReferenceDto {
  @ApiProperty({ enum: ['SECOP'], example: 'SECOP' })
  sourceName!: 'SECOP';

  @ApiProperty({ example: 'CO1.REQ.2577563' })
  externalId!: string;

  @ApiProperty({ example: 'MINTIC-LP-012-2026' })
  humanReference!: string;

  @ApiProperty({ example: 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.1' })
  originalUrl!: string;
}

export class OpportunitySummary {
  @ApiProperty({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' })
  id!: string;

  @ApiProperty({ example: 'Servicio de desarrollo de software a la medida' })
  title!: string;

  @ApiProperty({ example: 'Desarrollo e implementación de plataforma web en arquitectura hexagonal' })
  description!: string;

  @ApiProperty({ type: ContractingEntityDto })
  contractingEntity!: ContractingEntityDto;

  @ApiProperty({ example: 'Ministerio de Tecnologías de la Información y las Comunicaciones' })
  entityName!: string;

  @ApiProperty({ type: LocationDto })
  location!: LocationDto;

  @ApiProperty({ type: String, nullable: true, example: 'Bogotá' })
  city!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Bogotá D.C.' })
  department!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Amount in COP, or null when the opportunity does not declare a known amount',
    example: 150000000,
  })
  amount!: number | null;

  @ApiProperty({ example: true })
  amountKnown!: boolean;

  @ApiProperty({ example: 'COP' })
  currency!: 'COP';

  @ApiProperty({ example: 'Prestación de servicios' })
  contractType!: string;

  @ApiProperty({ example: 'Licitación pública' })
  procurementModality!: string;

  @ApiProperty({ example: true })
  isCompetitive!: boolean;

  @ApiProperty({ type: String, nullable: true, example: '80111600' })
  categoryCode!: string | null;

  @ApiProperty({ example: '2026-10-01T08:00:00.000Z' })
  publishedAt!: string;

  @ApiProperty({ example: '2026-10-10T12:00:00.000Z' })
  lastPublishedAt!: string;

  @ApiProperty({ type: String, nullable: true, example: '2026-10-30T17:00:00.000Z' })
  closingDate!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Whole days remaining until closingDate, or null when closingDate is null',
    example: 12,
  })
  daysToClose!: number | null;

  @ApiProperty({ example: true })
  isOpenForSubmission!: boolean;

  @ApiProperty({
    enum: ['Draft', 'Published', 'Amended', 'Closed', 'Awarded', 'Cancelled', 'Unknown'],
    example: 'Published',
  })
  status!: OpportunityStatus;

  @ApiProperty({ type: SourceReferenceDto })
  source!: SourceReferenceDto;

  @ApiProperty({ example: 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.1' })
  sourceUrl!: string;

  @ApiProperty({
    enum: ['pending', 'ready', 'fallback', 'unavailable'],
    example: 'ready',
  })
  summaryStatus!: SummaryStatus;
}

export class RequirementDto {
  @ApiProperty({ example: 'Experiencia específica en desarrollo web' })
  text!: string;

  @ApiProperty({ enum: ['technical', 'financial', 'legal'], example: 'technical' })
  type!: 'technical' | 'financial' | 'legal';
}

export class AnalysisDto {
  @ApiProperty({ type: String, nullable: true, example: 'Resumen analítico conciso del proceso.' })
  summary!: string | null;

  @ApiProperty({
    enum: ['pending', 'ready', 'fallback', 'unavailable'],
    example: 'ready',
  })
  summaryStatus!: SummaryStatus;

  @ApiProperty({ type: [RequirementDto] })
  requirements!: RequirementDto[];

  @ApiProperty({ type: String, nullable: true, example: '2026-10-10T12:05:00.000Z' })
  embeddingGeneratedAt!: string | null;
}

export class ChangeDto {
  @ApiProperty({ example: 'closingDate' })
  field!: string;

  @ApiProperty({ example: '2026-10-25T17:00:00.000Z' })
  previousValue!: string;

  @ApiProperty({ example: '2026-10-30T17:00:00.000Z' })
  newValue!: string;

  @ApiProperty({ example: '2026-10-15T09:00:00.000Z' })
  detectedAt!: string;

  @ApiProperty({ example: true })
  material!: boolean;
}

export class OpportunityDetail extends OpportunitySummary {
  @ApiProperty({ type: String, nullable: true, example: 'Resumen analítico conciso del proceso.' })
  summary!: string | null;

  @ApiProperty({ type: AnalysisDto, nullable: true })
  analysis!: AnalysisDto | null;

  @ApiProperty({ type: [ChangeDto] })
  changeHistory!: ChangeDto[];
}

export class MatchedFactorDto {
  @ApiProperty({
    enum: ['semanticSimilarity', 'categoryMatch', 'amountFit', 'locationMatch'],
    example: 'semanticSimilarity',
  })
  factor!: 'semanticSimilarity' | 'categoryMatch' | 'amountFit' | 'locationMatch';

  @ApiProperty({ example: 0.85 })
  score!: number;

  @ApiProperty({ example: 'Coincidencia semántica con tu perfil (85%)' })
  description!: string;
}

export class ExplanationDto {
  @ApiProperty({ example: 'Afinidad del 82% basada en 3 factores evaluados.' })
  summary!: string;

  @ApiProperty({ type: [MatchedFactorDto] })
  matchedFactors!: MatchedFactorDto[];

  @ApiProperty({
    type: [String],
    example: ['La oportunidad no declara categoría UNSPSC'],
  })
  unavailableFactors!: string[];
}

export class FeedbackDto {
  @ApiProperty({ enum: ['Participate', 'Discard'], example: 'Participate' })
  decision!: 'Participate' | 'Discard';

  @ApiProperty({ example: '2026-10-16T10:30:00.000Z' })
  recordedAt!: string;
}

export class RecommendationDto {
  @ApiProperty({ example: 'rec-123e4567-e89b-12d3-a456-426614174000' })
  id!: string;

  @ApiProperty({ example: 'd9b2d63d-a232-4d2c-8cb4-e5e6b72a44f1' })
  profileId!: string;

  @ApiProperty({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' })
  opportunityId!: string;

  @ApiProperty({ example: 0.82 })
  score!: number;

  @ApiProperty({ type: ExplanationDto })
  explanation!: ExplanationDto;

  @ApiProperty({ type: FeedbackDto, nullable: true })
  feedback!: FeedbackDto | null;

  @ApiProperty({ type: OpportunitySummary, nullable: true })
  opportunity!: OpportunitySummary | null;
}

export class CapabilityDto {
  @ApiProperty({ example: 'Desarrollo de Software y Cloud' })
  name!: string;

  @ApiProperty({ example: 5 })
  yearsOfExperience!: number;
}

export class AmountRangeDto {
  @ApiProperty({ example: 50000000 })
  min!: number;

  @ApiProperty({ example: 500000000 })
  max!: number;
}

export class ProfilePreferencesDto {
  @ApiProperty({ type: [String], example: ['80111600'] })
  categoryCodes!: string[];

  @ApiProperty({ type: [String], example: ['software', 'arquitectura'] })
  keywords!: string[];

  @ApiProperty({ type: AmountRangeDto, nullable: true })
  amountRange!: AmountRangeDto | null;

  @ApiProperty({ type: [String], example: ['Bogotá D.C.', 'Antioquia'] })
  departments!: string[];
}

export class ProfileDto {
  @ApiProperty({ example: 'd9b2d63d-a232-4d2c-8cb4-e5e6b72a44f1' })
  id!: string;

  @ApiProperty({ example: 'user-contractor-01' })
  ownerId!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Contratista Demo SAS' })
  name!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'contacto@contratista.com' })
  contactEmail!: string | null;

  @ApiProperty({ example: true, default: true })
  alertsEnabled!: boolean;

  @ApiProperty({ example: 3, default: 3 })
  deadlineAlertDays!: number;

  @ApiProperty({ example: 'Tecnología e Inteligencia Artificial' })
  sector!: string;

  @ApiProperty({ type: [CapabilityDto] })
  capabilities!: CapabilityDto[];

  @ApiProperty({ type: ProfilePreferencesDto })
  preferences!: ProfilePreferencesDto;
}

export class AlertDto {
  @ApiProperty({ example: 'alert-01' })
  id!: string;

  @ApiProperty({ example: 'd9b2d63d-a232-4d2c-8cb4-e5e6b72a44f1' })
  profileId!: string;

  @ApiProperty({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' })
  opportunityId!: string;

  @ApiProperty({
    enum: ['Amendment', 'DeadlineApproaching', 'StatusChange'],
    example: 'Amendment',
  })
  trigger!: AlertTrigger;

  @ApiProperty({ type: String, nullable: true, example: '2026-10-16T08:01:00.000Z' })
  deliveredAt!: string | null;
}

export class Page<T> {
  @ApiProperty({ isArray: true })
  items!: T[];

  @ApiProperty({ example: 42 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  pageSize!: number;
}

export class OpportunitySummaryPageDto extends Page<OpportunitySummary> {
  @ApiProperty({ type: [OpportunitySummary] })
  declare items: OpportunitySummary[];
}

export class RecommendationPageDto extends Page<RecommendationDto> {
  @ApiProperty({ type: [RecommendationDto] })
  declare items: RecommendationDto[];
}

export class AlertPageDto extends Page<AlertDto> {
  @ApiProperty({ type: [AlertDto] })
  declare items: AlertDto[];
}

export class SyncOpportunitiesResponseDto {
  @ApiProperty({ example: 12 })
  created!: number;

  @ApiProperty({ example: 3 })
  updated!: number;

  @ApiProperty({ example: 185 })
  unchanged!: number;

  @ApiProperty({ example: 0 })
  skipped!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: {},
  })
  unknownStatuses!: Record<string, number>;

  @ApiProperty({ example: 845 })
  durationMs!: number;

  @ApiPropertyOptional({ example: true })
  refreshTriggered?: boolean;
}

export class RegisterFeedbackResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 'Feedback recorded successfully' })
  message!: string;
}

export class ReviewFollowUpResponseDto {
  @ApiProperty({ example: 5 })
  alertsSent!: number;
}

export function computeDaysToClose(
  closingDate: Date | null,
  now: Date = new Date(),
): number | null {
  if (!closingDate || isNaN(closingDate.getTime())) {
    return null;
  }
  return Math.ceil((closingDate.getTime() - now.getTime()) / ONE_DAY_MS);
}

export function deriveSummaryStatus(opportunity: Opportunity): SummaryStatus {
  if (opportunity.analysis?.summaryStatus) {
    return opportunity.analysis.summaryStatus;
  }
  if (opportunity.analysis?.summary && opportunity.analysis.summary.trim() !== '') {
    return 'ready';
  }
  return 'unavailable';
}

export function toOpportunitySummaryDto(
  opportunity: Opportunity,
  now: Date = new Date(),
): OpportunitySummary {
  const summaryStatus = deriveSummaryStatus(opportunity);
  return {
    id: opportunity.id,
    title: opportunity.title,
    description: opportunity.description ?? '',
    contractingEntity: {
      name: opportunity.contractingEntity.name,
      taxId: opportunity.contractingEntity.taxId,
    },
    entityName: opportunity.contractingEntity.name,
    location: {
      city: opportunity.location.city ?? null,
      department: opportunity.location.department ?? null,
    },
    city: opportunity.location.city ?? null,
    department: opportunity.location.department ?? null,
    amount: opportunity.amountKnown ? opportunity.amount.amount : null,
    amountKnown: opportunity.amountKnown,
    currency: 'COP',
    contractType: opportunity.contractType,
    procurementModality: opportunity.procurementModality,
    isCompetitive: opportunity.isCompetitive,
    categoryCode: opportunity.categoryCode ?? null,
    publishedAt: opportunity.publishedAt.toISOString(),
    lastPublishedAt: (opportunity.lastPublishedAt ?? opportunity.publishedAt).toISOString(),
    closingDate: opportunity.closingDate ? opportunity.closingDate.toISOString() : null,
    daysToClose: computeDaysToClose(opportunity.closingDate, now),
    isOpenForSubmission: opportunity.isOpenForSubmission,
    status: opportunity.status,
    source: {
      sourceName: opportunity.source.sourceName,
      externalId: opportunity.source.externalId,
      humanReference: opportunity.source.humanReference,
      originalUrl: opportunity.source.originalUrl,
    },
    sourceUrl: opportunity.source.originalUrl,
    summaryStatus,
  };
}

export function toOpportunityDetailDto(
  opportunity: Opportunity,
  explicitStatus?: SummaryStatus,
  now: Date = new Date(),
): OpportunityDetail {
  const base = toOpportunitySummaryDto(opportunity, now);
  const summaryStatus = explicitStatus ?? base.summaryStatus;
  const rawSummary = opportunity.analysis?.summary?.trim() ?? '';
  const summary = rawSummary.length > 0 ? rawSummary : null;

  return {
    ...base,
    summaryStatus,
    summary,
    analysis: opportunity.analysis
      ? {
          summary,
          summaryStatus,
          requirements: (opportunity.analysis.requirements ?? []).map((req) => ({
            text: req.text,
            type: req.type,
          })),
          embeddingGeneratedAt: opportunity.analysis.embeddingGeneratedAt
            ? new Date(opportunity.analysis.embeddingGeneratedAt).toISOString()
            : null,
        }
      : null,
    changeHistory: (opportunity.changeHistory ?? []).map((ch) => ({
      field: ch.field,
      previousValue: ch.previousValue,
      newValue: ch.newValue,
      detectedAt: new Date(ch.detectedAt).toISOString(),
      material: Boolean(ch.material),
    })),
  };
}

export function toRecommendationDto(
  recommendation: Recommendation,
  opportunity: Opportunity | null = null,
  now: Date = new Date(),
): RecommendationDto {
  return {
    id: recommendation.id,
    profileId: recommendation.profileId,
    opportunityId: recommendation.opportunityId,
    score: recommendation.score,
    explanation: {
      summary: recommendation.explanation.summary,
      matchedFactors: recommendation.explanation.matchedFactors.map((f) => ({
        factor: f.factor,
        score: f.score,
        description: f.description,
      })),
      unavailableFactors: recommendation.explanation.unavailableFactors ?? [],
    },
    feedback: recommendation.feedback
      ? {
          decision: recommendation.feedback.decision,
          recordedAt: new Date(recommendation.feedback.recordedAt).toISOString(),
        }
      : null,
    opportunity: opportunity ? toOpportunitySummaryDto(opportunity, now) : null,
  };
}

export function toProfileDto(profile: Profile): ProfileDto {
  return {
    id: profile.id,
    ownerId: profile.ownerId,
    name: profile.name ?? null,
    contactEmail: profile.contactEmail ?? null,
    alertsEnabled: profile.alertsEnabled ?? true,
    deadlineAlertDays: profile.deadlineAlertDays ?? 3,
    sector: profile.sector,
    capabilities: profile.capabilities.map((c) => ({
      name: c.name,
      yearsOfExperience: c.yearsOfExperience,
    })),
    preferences: {
      categoryCodes: [...profile.preferences.categoryCodes],
      keywords: [...profile.preferences.keywords],
      amountRange: profile.preferences.amountRange
        ? {
            min: profile.preferences.amountRange.min,
            max: profile.preferences.amountRange.max,
          }
        : null,
      departments: [...profile.preferences.departments],
    },
  };
}

export function toAlertDto(alert: Alert): AlertDto {
  return {
    id: alert.id,
    profileId: alert.profileId,
    opportunityId: alert.opportunityId,
    trigger: alert.trigger,
    deliveredAt: alert.deliveredAt ? new Date(alert.deliveredAt).toISOString() : null,
  };
}
