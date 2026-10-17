import { randomUUID } from 'node:crypto';
import { AIProviderPort } from '../ports/ai-provider.port';
import { Opportunity } from '../../../opportunity/domain/entities/opportunity.entity';
import { Profile } from '../../../profile/domain/entities/profile.entity';
import { Capability } from '../../../profile/domain/value-objects/profile.value-objects';
import { Recommendation } from '../entities/recommendation.entity';
import {
  Explanation,
  MatchedFactor,
} from '../../../opportunity/domain/value-objects/opportunity.value-objects';
import { RecommendationId, asRecommendationId } from '../../../shared/domain/typed-id';
import { normalizeUnspsc } from '../../../opportunity/infrastructure/adapters/secop/normalizers';

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

export interface ScoringBreakdown {
  readonly semanticSimilarity: number;
  readonly categoryMatch: number;
  readonly amountFit: number;
  readonly locationMatch: number;
  readonly combinedScore: number;
  readonly matchedFactors: MatchedFactor[];
  readonly explanation: Explanation;
}

export class MatchingService {
  constructor(
    private readonly aiProvider: AIProviderPort,
    private readonly weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
  ) {}

  /**
   * Computes the detailed scoring breakdown for an Opportunity against a Profile.
   */
  async computeBreakdown(
    opportunity: Opportunity,
    profile: Profile,
    precomputedSemanticSimilarity?: number,
  ): Promise<ScoringBreakdown> {
    // A precomputed value (e.g. pgvector cosine similarity) skips the per-pair LLM call
    const semanticSimilarity =
      precomputedSemanticSimilarity !== undefined
        ? Math.min(1, Math.max(0, precomputedSemanticSimilarity))
        : await this.computeSemanticSimilarity(profile, opportunity);
    const categoryMatch = this.computeCategoryMatch(
      opportunity.categoryCode,
      profile.preferences.categoryCodes,
    );
    const amountFit = this.computeAmountFit(
      opportunity.amount.amount,
      profile.preferences.amountRange,
    );
    const locationMatch = this.computeLocationMatch(
      opportunity.location.department,
      profile.preferences.departments,
    );

    const rawScore =
      this.weights.semanticSimilarity * semanticSimilarity +
      this.weights.categoryMatch * categoryMatch +
      this.weights.amountFit * amountFit +
      this.weights.locationMatch * locationMatch;

    const combinedScore = Math.min(1, Math.max(0, Number(rawScore.toFixed(4))));

    const matchedFactors: MatchedFactor[] = [];

    if (semanticSimilarity >= FACTOR_MATCH_THRESHOLD) {
      matchedFactors.push({
        factor: 'semanticSimilarity',
        score: Number(semanticSimilarity.toFixed(4)),
        description: 'Alta coincidencia semántica con las capacidades y palabras clave de tu perfil',
      });
    }

    if (categoryMatch >= FACTOR_MATCH_THRESHOLD) {
      matchedFactors.push({
        factor: 'categoryMatch',
        score: Number(categoryMatch.toFixed(4)),
        description: 'Coincide con tu categoría de interés',
      });
    }

    if (amountFit >= FACTOR_MATCH_THRESHOLD) {
      matchedFactors.push({
        factor: 'amountFit',
        score: Number(amountFit.toFixed(4)),
        description: 'El monto está dentro de tu rango declarado',
      });
    }

    if (locationMatch >= FACTOR_MATCH_THRESHOLD) {
      matchedFactors.push({
        factor: 'locationMatch',
        score: Number(locationMatch.toFixed(4)),
        description: 'La ubicación coincide con tus departamentos de interés',
      });
    }

    const explanation: Explanation = {
      summary:
        matchedFactors.length > 0
          ? `Oportunidad recomendada por: ${matchedFactors.map((f) => f.description).join('; ')}.`
          : 'Baja coincidencia general con los criterios del perfil.',
      matchedFactors,
    };

    return {
      semanticSimilarity,
      categoryMatch,
      amountFit,
      locationMatch,
      combinedScore,
      matchedFactors,
      explanation,
    };
  }

  /**
   * Scores an Opportunity against a Profile and returns a complete Recommendation aggregate root.
   */
  async score(
    opportunity: Opportunity,
    profile: Profile,
    recommendationId?: RecommendationId,
  ): Promise<Recommendation> {
    const breakdown = await this.computeBreakdown(opportunity, profile);

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
   * Builds the text that represents a profile for semantic matching.
   * Shared so embeddings-based scoring uses the same text as the LLM-based path.
   */
  static buildProfileText(profile: Profile): string {
    const parts: string[] = [];
    if (profile.preferences.keywords.length > 0) parts.push(profile.preferences.keywords.join(', '));
    if (profile.capabilities.length > 0) {
      parts.push(profile.capabilities.map((c: Capability) => c.name).join(', '));
    }
    if (profile.sector) parts.push(profile.sector);
    return parts.join('. ') || profile.sector;
  }

  /**
   * Maps a raw embedding cosine similarity to 0..1. nomic-embed-text yields roughly
   * 0.40 (unrelated) to 0.75 (strongly related) for short Spanish texts.
   */
  static normalizeCosine(cosine: number, low = 0.4, high = 0.75): number {
    return Math.min(1, Math.max(0, (cosine - low) / (high - low)));
  }

  /**
   * Factor 1: Semantic similarity via AIProviderPort (0..1)
   */
  private async computeSemanticSimilarity(
    profile: Profile,
    opportunity: Opportunity,
  ): Promise<number> {
    const profileParts: string[] = [];
    if (profile.preferences.keywords.length > 0) {
      profileParts.push(profile.preferences.keywords.join(', '));
    }
    if (profile.capabilities.length > 0) {
      profileParts.push(profile.capabilities.map((c: Capability) => c.name).join(', '));
    }
    if (profile.sector) {
      profileParts.push(profile.sector);
    }
    const profileText = profileParts.join('. ') || profile.sector;

    const opportunityText = opportunity.analysis?.summary
      ? `${opportunity.title}. ${opportunity.analysis.summary}`
      : opportunity.title;

    const rawSimilarity = await this.aiProvider.scoreSimilarity(profileText, opportunityText);
    return Math.min(1, Math.max(0, Number(rawSimilarity.toFixed(4))));
  }

  /**
   * Factor 2: Category match using UNSPSC codes (0..1)
   * Exact match = 1.0; same segment/family (shared prefix) = 0.6; no relation = 0.
   */
  private computeCategoryMatch(
    opportunityCategory: string | null,
    preferredCategories: string[],
  ): number {
    if (!preferredCategories || preferredCategories.length === 0) {
      return 0.0;
    }

    const normOpp = normalizeUnspsc(opportunityCategory);
    if (!normOpp) {
      return 0.0;
    }

    let bestMatch = 0.0;

    for (const pref of preferredCategories) {
      const normPref = normalizeUnspsc(pref);
      if (!normPref) continue;

      if (normOpp === normPref) {
        return 1.0;
      }

      // UNSPSC segment (first 2 digits) and family (first 4 digits)
      if (
        (normOpp.length >= 4 && normPref.length >= 4 && normOpp.slice(0, 4) === normPref.slice(0, 4)) ||
        (normOpp.length >= 2 && normPref.length >= 2 && normOpp.slice(0, 2) === normPref.slice(0, 2))
      ) {
        bestMatch = Math.max(bestMatch, 0.6);
      }
    }

    return bestMatch;
  }

  /**
   * Factor 3: Amount fit with triangular falloff (0..1)
   * 1.0 if inside range. Triangular linear falloff for amounts just outside range.
   */
  private computeAmountFit(
    opportunityAmount: number,
    amountRange: { min: number; max: number } | null,
  ): number {
    if (amountRange === null) {
      return 1.0;
    }

    const { min, max } = amountRange;

    if (opportunityAmount >= min && opportunityAmount <= max) {
      return 1.0;
    }

    const rangeSpan = max - min;
    const margin = Math.max(rangeSpan, max > 0 ? max * 0.5 : 1_000_000);

    if (opportunityAmount > max) {
      const diff = opportunityAmount - max;
      return Math.min(1, Math.max(0, Number((1 - diff / margin).toFixed(4))));
    }

    // opportunityAmount < min
    const diff = min - opportunityAmount;
    return Math.min(1, Math.max(0, Number((1 - diff / margin).toFixed(4))));
  }

  /**
   * Factor 4: Location match (0..1)
   * 1.0 if department matches or if profile has no department preferences ("any"); 0 otherwise.
   */
  private computeLocationMatch(
    opportunityDepartment: string | null,
    preferredDepartments: string[],
  ): number {
    if (!preferredDepartments || preferredDepartments.length === 0) {
      return 1.0; // "any"
    }

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
