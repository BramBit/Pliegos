type Brand<T, B extends string> = T & { readonly __brand: B };

export type OpportunityId = Brand<string, 'OpportunityId'>;
export type ProfileId = Brand<string, 'ProfileId'>;
export type RecommendationId = Brand<string, 'RecommendationId'>;
export type AlertId = Brand<string, 'AlertId'>;
export type UserId = Brand<string, 'UserId'>;

export const asOpportunityId = (id: string): OpportunityId => id as OpportunityId;
export const asProfileId = (id: string): ProfileId => id as ProfileId;
export const asRecommendationId = (id: string): RecommendationId => id as RecommendationId;
export const asAlertId = (id: string): AlertId => id as AlertId;
export const asUserId = (id: string): UserId => id as UserId;
