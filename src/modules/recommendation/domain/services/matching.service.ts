import { randomUUID } from 'node:crypto';
import { cosine } from '../ports/ai-provider.port';
import { Opportunity } from '../../../opportunity/domain/entities/opportunity.entity';
import { Profile, buildProfileQuery } from '../../../profile/domain/entities/profile.entity';
import { Recommendation } from '../entities/recommendation.entity';
import {
  Explanation,
  MatchedFactor,
} from '../../../opportunity/domain/value-objects/opportunity.value-objects';
import { RecommendationId, asRecommendationId } from '../../../shared/domain/typed-id';
import { normalizeUnspsc } from '../../../opportunity/infrastructure/adapters/secop/normalizers';

export { cosine, buildProfileQuery };

export interface ScoringWeights {
  readonly semanticSimilarity: number;
  readonly categoryMatch: number;
  readonly amountFit: number;
  readonly locationMatch: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  semanticSimilarity: 0.35,
  categoryMatch: 0.35,
  amountFit: 0.20,
  locationMatch: 0.10,
};

export const FACTOR_MATCH_THRESHOLD = 0.6;
export const DEFAULT_SEMANTIC_COSINE_LOW = 0.4;
export const DEFAULT_SEMANTIC_COSINE_HIGH = 0.75;
export const DEFAULT_MIN_RECOMMENDATION_SCORE = 0.45;

function readEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw !== undefined && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

export function getMinRecommendationScore(): number {
  const val = readEnvNumber('MIN_RECOMMENDATION_SCORE', DEFAULT_MIN_RECOMMENDATION_SCORE);
  return Math.min(1, Math.max(0, val));
}

export interface ScoringBreakdown {
  readonly semanticSimilarity: number;
  readonly categoryMatch: number;
  readonly amountFit: number;
  readonly locationMatch: number;
  readonly combinedScore: number;
  readonly matchedFactors: MatchedFactor[];
  readonly unavailableFactors: string[];
  readonly explanation: Explanation;
}

export class MatchingService {
  constructor(private readonly weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS) {}

  /**
   * Computes the detailed scoring breakdown for an Opportunity against a Profile.
   * Unavailable factors (missing inputs) are excluded from the weighted average
   * and recorded in unavailableFactors with Spanish reasons.
   */
  async computeBreakdown(
    opportunity: Opportunity,
    profile: Profile,
    semanticSimilarity: number | null,
  ): Promise<ScoringBreakdown> {
    const unavailableFactors: string[] = [];
    const matchedFactors: MatchedFactor[] = [];
    let weightedSum = 0;
    let totalAvailableWeight = 0;

    // 1. Semantic similarity factor
    const semanticAvailable =
      semanticSimilarity !== null && Number.isFinite(semanticSimilarity);
    let semanticScore = 0;
    if (semanticAvailable) {
      semanticScore = Math.min(1, Math.max(0, Number(semanticSimilarity.toFixed(4))));
      weightedSum += this.weights.semanticSimilarity * semanticScore;
      totalAvailableWeight += this.weights.semanticSimilarity;

      if (semanticScore >= FACTOR_MATCH_THRESHOLD) {
        matchedFactors.push({
          factor: 'semanticSimilarity',
          score: Number(semanticScore.toFixed(4)),
          description:
            'Alta coincidencia semántica con las capacidades y palabras clave de tu perfil',
        });
      }
    } else {
      unavailableFactors.push('La oportunidad aún no tiene vector semántico indexado');
    }

    // 2. Category match factor
    const normOppCategory = normalizeUnspsc(opportunity.categoryCode);
    const normPrefCategories = (profile.preferences.categoryCodes ?? [])
      .map((c) => normalizeUnspsc(c))
      .filter((c): c is string => c !== null);
    const categoryAvailable = normOppCategory !== null && normPrefCategories.length > 0;
    let categoryMatch = 0;

    if (categoryAvailable) {
      categoryMatch = this.computeCategoryMatch(normOppCategory, normPrefCategories);
      weightedSum += this.weights.categoryMatch * categoryMatch;
      totalAvailableWeight += this.weights.categoryMatch;

      if (categoryMatch >= FACTOR_MATCH_THRESHOLD) {
        matchedFactors.push({
          factor: 'categoryMatch',
          score: Number(categoryMatch.toFixed(4)),
          description: 'Coincide con tu categoría de interés',
        });
      }
    } else {
      if (normOppCategory === null) {
        unavailableFactors.push('La oportunidad no declara categoría UNSPSC');
      }
      if (normPrefCategories.length === 0) {
        unavailableFactors.push('El perfil no declara categorías UNSPSC de interés');
      }
    }

    // 3. Amount fit factor
    const amountKnown = opportunity.amountKnown !== false;
    const amountRange = profile.preferences.amountRange;
    const amountAvailable = amountKnown && amountRange !== null;
    let amountFit = 0;

    if (amountAvailable && amountRange !== null) {
      amountFit = this.computeAmountFit(opportunity.amount.amount, amountRange);
      weightedSum += this.weights.amountFit * amountFit;
      totalAvailableWeight += this.weights.amountFit;

      if (amountFit >= FACTOR_MATCH_THRESHOLD) {
        matchedFactors.push({
          factor: 'amountFit',
          score: Number(amountFit.toFixed(4)),
          description: 'El monto está dentro de tu rango declarado',
        });
      }
    } else {
      if (!amountKnown) {
        unavailableFactors.push('La oportunidad no declara un monto válido');
      }
      if (amountRange === null) {
        unavailableFactors.push('El perfil no declara rango de cuantía');
      }
    }

    // 4. Location match factor
    const preferredDepartments = (profile.preferences.departments ?? []).filter(
      (d) => d.trim().length > 0,
    );
    const locationAvailable = preferredDepartments.length > 0;
    let locationMatch = 0;

    if (locationAvailable) {
      locationMatch = this.computeLocationMatch(
        opportunity.location.department,
        preferredDepartments,
      );
      weightedSum += this.weights.locationMatch * locationMatch;
      totalAvailableWeight += this.weights.locationMatch;

      if (locationMatch >= FACTOR_MATCH_THRESHOLD) {
        matchedFactors.push({
          factor: 'locationMatch',
          score: Number(locationMatch.toFixed(4)),
          description: 'La ubicación coincide con tus departamentos de interés',
        });
      }
    } else {
      unavailableFactors.push('El perfil no declara departamentos de interés');
    }

    const rawScore = totalAvailableWeight > 0 ? weightedSum / totalAvailableWeight : 0;
    const combinedScore = Math.min(1, Math.max(0, Number(rawScore.toFixed(4))));

    const explanation: Explanation = {
      summary:
        matchedFactors.length > 0
          ? `Oportunidad recomendada por: ${matchedFactors.map((f) => f.description).join('; ')}.`
          : 'Baja coincidencia general con los criterios del perfil.',
      matchedFactors,
      unavailableFactors,
    };

    return {
      semanticSimilarity: semanticScore,
      categoryMatch,
      amountFit,
      locationMatch,
      combinedScore,
      matchedFactors,
      unavailableFactors,
      explanation,
    };
  }

  /**
   * Scores an Opportunity against a Profile and returns a complete Recommendation aggregate root.
   */
  async score(
    opportunity: Opportunity,
    profile: Profile,
    semanticSimilarity: number | null,
    recommendationId?: RecommendationId,
  ): Promise<Recommendation> {
    const breakdown = await this.computeBreakdown(opportunity, profile, semanticSimilarity);

    return {
      id: recommendationId ?? asRecommendationId(randomUUID()),
      profileId: profile.id,
      opportunityId: opportunity.id,
      score: breakdown.combinedScore,
      explanation: breakdown.explanation,
      feedback: null,
    };
  }

  /**
   * Maps a raw embedding cosine similarity to 0..1 using SEMANTIC_COSINE_LOW (default 0.40)
   * and SEMANTIC_COSINE_HIGH (default 0.75) unless overridden.
   */
  static normalizeCosine(cosineValue: number, low?: number, high?: number): number {
    const effLow = low ?? readEnvNumber('SEMANTIC_COSINE_LOW', DEFAULT_SEMANTIC_COSINE_LOW);
    const effHigh = high ?? readEnvNumber('SEMANTIC_COSINE_HIGH', DEFAULT_SEMANTIC_COSINE_HIGH);
    if (effHigh <= effLow) {
      return 0;
    }
    return Math.min(1, Math.max(0, (cosineValue - effLow) / (effHigh - effLow)));
  }

  /**
   * Factor 2: Category match using normalized UNSPSC codes (0..1)
   * Exact match = 1.0; same segment/family (shared prefix) = 0.6; no relation = 0.
   */
  private computeCategoryMatch(normOpp: string, normPrefs: string[]): number {
    let bestMatch = 0.0;

    for (const normPref of normPrefs) {
      if (normOpp === normPref) {
        return 1.0;
      }

      if (
        (normOpp.length >= 4 &&
          normPref.length >= 4 &&
          normOpp.slice(0, 4) === normPref.slice(0, 4)) ||
        (normOpp.length >= 2 &&
          normPref.length >= 2 &&
          normOpp.slice(0, 2) === normPref.slice(0, 2))
      ) {
        bestMatch = Math.max(bestMatch, 0.6);
      }
    }

    return bestMatch;
  }

  /**
   * Factor 3: Relative amount fit (0..1)
   * Inside [min, max] = 1.
   * Below min: max(0, 1 - (min - amount) / min).
   * Above max: max(0, 1 - (amount - max) / max).
   * Reaches 0 at amount 0 and at 2 x max.
   */
  private computeAmountFit(
    opportunityAmount: number,
    amountRange: { min: number; max: number },
  ): number {
    const { min, max } = amountRange;

    if (opportunityAmount >= min && opportunityAmount <= max) {
      return 1.0;
    }

    if (opportunityAmount < min) {
      if (min <= 0) return 0.0;
      const fit = 1 - (min - opportunityAmount) / min;
      return Math.min(1, Math.max(0, Number(fit.toFixed(4))));
    }

    if (max <= 0) return 0.0;
    const fit = 1 - (opportunityAmount - max) / max;
    return Math.min(1, Math.max(0, Number(fit.toFixed(4))));
  }

  /**
   * Factor 4: Location match (0..1)
   */
  private computeLocationMatch(
    opportunityDepartment: string | null,
    preferredDepartments: string[],
  ): number {
    if (!opportunityDepartment) {
      return 0.0;
    }

    const normOppDept = opportunityDepartment.trim().toLowerCase();
    const hasMatch = preferredDepartments.some(
      (dept) => dept.trim().toLowerCase() === normOppDept,
    );

    return hasMatch ? 1.0 : 0.0;
  }
}
