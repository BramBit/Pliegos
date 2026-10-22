import { normalizeUnspsc } from '../value-objects/opportunity.value-objects';
import { canonicalizeDepartment } from '../../../shared/domain/colombian-departments';

export type CriterionState = 'match' | 'mismatch' | 'unknown';
export type CriterionName = 'amount' | 'department' | 'category' | 'closing';

export interface Criteria {
  readonly amountMin?: number;
  readonly amountMax?: number;
  readonly departments?: readonly string[];
  readonly categoryPrefixes?: readonly string[];
  readonly closingAfter?: Date;
  readonly closingBefore?: Date;
}

export interface Evaluation {
  readonly states: Partial<Record<CriterionName, CriterionState>>;
  readonly missing: CriterionName[];
  readonly tier: 1 | 2 | 3;
}

export interface EvaluatableOpportunity {
  readonly amount: { readonly amount: number };
  readonly amountKnown?: boolean;
  readonly location: { readonly department: string | null };
  readonly categoryCode: string | null;
  readonly closingDate: Date | null;
}

export function evaluateCriteria(
  opportunity: EvaluatableOpportunity,
  criteria: Criteria,
): Evaluation {
  const states: Partial<Record<CriterionName, CriterionState>> = {};

  // 1. Amount criterion
  if (criteria.amountMin !== undefined || criteria.amountMax !== undefined) {
    if (opportunity.amountKnown === false) {
      states.amount = 'unknown';
    } else {
      const val = opportunity.amount.amount;
      const minOk =
        criteria.amountMin === undefined || val >= criteria.amountMin;
      const maxOk =
        criteria.amountMax === undefined || val <= criteria.amountMax;
      states.amount = minOk && maxOk ? 'match' : 'mismatch';
    }
  }

  // 2. Department criterion
  if (criteria.departments !== undefined && criteria.departments.length > 0) {
    const oppDept = opportunity.location?.department;
    if (!oppDept || oppDept.trim() === '') {
      states.department = 'unknown';
    } else {
      const canonicalOpp = canonicalizeDepartment(oppDept);
      const normOppDept = canonicalOpp ?? oppDept.trim().toLowerCase();

      const matched = criteria.departments.some((dept) => {
        if (!dept || dept.trim() === '') return false;
        const canonicalPref = canonicalizeDepartment(dept);
        const normPref = canonicalPref ?? dept.trim().toLowerCase();
        return normPref === normOppDept;
      });

      states.department = matched ? 'match' : 'mismatch';
    }
  }

  // 3. Category criterion
  if (
    criteria.categoryPrefixes !== undefined &&
    criteria.categoryPrefixes.length > 0
  ) {
    const normCode = normalizeUnspsc(opportunity.categoryCode);
    if (normCode === null) {
      states.category = 'unknown';
    } else {
      const validPrefixes = criteria.categoryPrefixes
        .map((p) => p.trim().replace(/^v1\./i, ''))
        .filter((p) => p.length > 0);

      if (validPrefixes.length === 0) {
        // If all prefixes were invalid or empty, treat as no match
        states.category = 'mismatch';
      } else {
        const matched = validPrefixes.some((p) => normCode.startsWith(p));
        states.category = matched ? 'match' : 'mismatch';
      }
    }
  }

  // 4. Closing criterion
  if (
    criteria.closingAfter !== undefined ||
    criteria.closingBefore !== undefined
  ) {
    if (!opportunity.closingDate) {
      states.closing = 'unknown';
    } else {
      const closingTime = opportunity.closingDate.getTime();
      const afterOk =
        criteria.closingAfter === undefined ||
        closingTime >= criteria.closingAfter.getTime();
      const beforeOk =
        criteria.closingBefore === undefined ||
        closingTime <= criteria.closingBefore.getTime();
      states.closing = afterOk && beforeOk ? 'match' : 'mismatch';
    }
  }

  const missing: CriterionName[] = (
    Object.keys(states) as CriterionName[]
  ).filter((key) => states[key] === 'unknown');

  const stateValues = Object.values(states);
  let tier: 1 | 2 | 3 = 1;
  if (stateValues.includes('mismatch')) {
    tier = 3;
  } else if (stateValues.includes('unknown')) {
    tier = 2;
  }

  return {
    states,
    missing,
    tier,
  };
}
