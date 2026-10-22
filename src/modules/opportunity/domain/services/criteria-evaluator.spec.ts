import {
  evaluateCriteria,
  Criteria,
  EvaluatableOpportunity,
  Evaluation,
} from './criteria-evaluator';

describe('evaluateCriteria', () => {
  const baseOpportunity: EvaluatableOpportunity = {
    amount: { amount: 100_000_000 },
    amountKnown: true,
    location: { department: 'Bogotá D.C.' },
    categoryCode: '81111500',
    closingDate: new Date('2026-11-15T12:00:00Z'),
  };

  interface TestCase {
    readonly description: string;
    readonly opportunityPatch?: Partial<EvaluatableOpportunity>;
    readonly criteria: Criteria;
    readonly expected: Evaluation;
  }

  const cases: TestCase[] = [
    // 1. No criteria gives tier 1
    {
      description: 'no criteria gives tier 1 with empty states and missing',
      criteria: {},
      expected: {
        states: {},
        missing: [],
        tier: 1,
      },
    },

    // 2. Amount within range
    {
      description: 'amount within range gives match and tier 1',
      criteria: { amountMin: 50_000_000, amountMax: 200_000_000 },
      expected: {
        states: { amount: 'match' },
        missing: [],
        tier: 1,
      },
    },

    // 3. Amount below min
    {
      description: 'amount below amountMin gives mismatch and tier 3',
      criteria: { amountMin: 150_000_000 },
      expected: {
        states: { amount: 'mismatch' },
        missing: [],
        tier: 3,
      },
    },

    // 4. Amount above max
    {
      description: 'amount outside the range (above amountMax) gives tier 3',
      criteria: { amountMax: 80_000_000 },
      expected: {
        states: { amount: 'mismatch' },
        missing: [],
        tier: 3,
      },
    },

    // 5. Amount open-ended min
    {
      description: 'open-ended amountMin with amount >= amountMin gives match',
      criteria: { amountMin: 100_000_000 },
      expected: {
        states: { amount: 'match' },
        missing: [],
        tier: 1,
      },
    },

    // 6. Amount open-ended max
    {
      description: 'open-ended amountMax with amount <= amountMax gives match',
      criteria: { amountMax: 100_000_000 },
      expected: {
        states: { amount: 'match' },
        missing: [],
        tier: 1,
      },
    },

    // 7. Unknown amount with only amountMin
    {
      description:
        'unknown amount with only amountMin gives tier 2 and missing [amount]',
      opportunityPatch: { amountKnown: false, amount: { amount: 0 } },
      criteria: { amountMin: 50_000_000 },
      expected: {
        states: { amount: 'unknown' },
        missing: ['amount'],
        tier: 2,
      },
    },

    // 8. Unknown amount with both bounds
    {
      description:
        'unknown amount with both bounds gives tier 2 and missing [amount]',
      opportunityPatch: { amountKnown: false },
      criteria: { amountMin: 50_000_000, amountMax: 200_000_000 },
      expected: {
        states: { amount: 'unknown' },
        missing: ['amount'],
        tier: 2,
      },
    },

    // 9. Department exact canonical match
    {
      description: 'exact canonical department match gives match and tier 1',
      opportunityPatch: { location: { department: 'Antioquia' } },
      criteria: { departments: ['Antioquia'] },
      expected: {
        states: { department: 'match' },
        missing: [],
        tier: 1,
      },
    },

    // 10. "Distrito Capital de Bogotá" matches "Bogotá D.C."
    {
      description:
        '"Distrito Capital de Bogotá" matches a profile list containing "Bogotá D.C."',
      opportunityPatch: {
        location: { department: 'Distrito Capital de Bogotá' },
      },
      criteria: { departments: ['Bogotá D.C.'] },
      expected: {
        states: { department: 'match' },
        missing: [],
        tier: 1,
      },
    },

    // 11. Criteria alias matches canonical opp
    {
      description:
        'criteria alias ("bogota") matches canonical opportunity department',
      opportunityPatch: { location: { department: 'Bogotá D.C.' } },
      criteria: { departments: ['bogota'] },
      expected: {
        states: { department: 'match' },
        missing: [],
        tier: 1,
      },
    },

    // 12. Two departments in the list
    {
      description:
        'two departments in the list, matches when opportunity matches either',
      opportunityPatch: { location: { department: 'Santander' } },
      criteria: { departments: ['Boyacá', 'Santander'] },
      expected: {
        states: { department: 'match' },
        missing: [],
        tier: 1,
      },
    },

    // 13. Non-matching department
    {
      description: 'non-matching department gives mismatch and tier 3',
      opportunityPatch: { location: { department: 'Caldas' } },
      criteria: { departments: ['Santander', 'Boyacá'] },
      expected: {
        states: { department: 'mismatch' },
        missing: [],
        tier: 3,
      },
    },

    // 14. Null department
    {
      description:
        'null opportunity department gives unknown, missing [department] and tier 2',
      opportunityPatch: { location: { department: null } },
      criteria: { departments: ['Bogotá D.C.'] },
      expected: {
        states: { department: 'unknown' },
        missing: ['department'],
        tier: 2,
      },
    },

    // 15. Empty department string
    {
      description:
        'empty opportunity department gives unknown, missing [department] and tier 2',
      opportunityPatch: { location: { department: '   ' } },
      criteria: { departments: ['Bogotá D.C.'] },
      expected: {
        states: { department: 'unknown' },
        missing: ['department'],
        tier: 2,
      },
    },

    // 16. Empty departments criteria list ignored
    {
      description: 'empty departments criteria list is ignored',
      criteria: { departments: [] },
      expected: {
        states: {},
        missing: [],
        tier: 1,
      },
    },

    // 17. Category prefix match
    {
      description: 'category prefix match gives match and tier 1',
      opportunityPatch: { categoryCode: '81111500' },
      criteria: { categoryPrefixes: ['8111'] },
      expected: {
        states: { category: 'match' },
        missing: [],
        tier: 1,
      },
    },

    // 18. Category prefix with "V1." prefix in criteria
    {
      description:
        'category prefix with "V1." prefix in criteria matches normalized code',
      opportunityPatch: { categoryCode: '81111500' },
      criteria: { categoryPrefixes: ['V1.8111'] },
      expected: {
        states: { category: 'match' },
        missing: [],
        tier: 1,
      },
    },

    // 19. Opportunity category code with "V1." prefix
    {
      description:
        'opportunity category code with "V1." prefix matches clean prefix',
      opportunityPatch: { categoryCode: 'V1.81111500' },
      criteria: { categoryPrefixes: ['8111'] },
      expected: {
        states: { category: 'match' },
        missing: [],
        tier: 1,
      },
    },

    // 20. Category prefix with and without "V1." in criteria list
    {
      description: 'category prefixes with and without "V1." in list',
      opportunityPatch: { categoryCode: '43231500' },
      criteria: { categoryPrefixes: ['V1.8111', '4323'] },
      expected: {
        states: { category: 'match' },
        missing: [],
        tier: 1,
      },
    },

    // 21. Non-matching category
    {
      description: 'non-matching category gives mismatch and tier 3',
      opportunityPatch: { categoryCode: '72141000' },
      criteria: { categoryPrefixes: ['8111'] },
      expected: {
        states: { category: 'mismatch' },
        missing: [],
        tier: 3,
      },
    },

    // 22. Null category code
    {
      description:
        'null categoryCode gives unknown, missing [category] and tier 2',
      opportunityPatch: { categoryCode: null },
      criteria: { categoryPrefixes: ['8111'] },
      expected: {
        states: { category: 'unknown' },
        missing: ['category'],
        tier: 2,
      },
    },

    // 23. UNSPECIFIED category code normalizes to null
    {
      description:
        '"UNSPECIFIED" categoryCode normalizes to null and gives unknown',
      opportunityPatch: { categoryCode: 'UNSPECIFIED' },
      criteria: { categoryPrefixes: ['8111'] },
      expected: {
        states: { category: 'unknown' },
        missing: ['category'],
        tier: 2,
      },
    },

    // 24. Closing date inside range
    {
      description: 'closing date inside range gives match and tier 1',
      opportunityPatch: { closingDate: new Date('2026-11-15T12:00:00Z') },
      criteria: {
        closingAfter: new Date('2026-11-01T00:00:00Z'),
        closingBefore: new Date('2026-11-30T23:59:59Z'),
      },
      expected: {
        states: { closing: 'match' },
        missing: [],
        tier: 1,
      },
    },

    // 25. Closing date before closingAfter
    {
      description: 'closing date before closingAfter gives mismatch and tier 3',
      opportunityPatch: { closingDate: new Date('2026-10-15T12:00:00Z') },
      criteria: { closingAfter: new Date('2026-11-01T00:00:00Z') },
      expected: {
        states: { closing: 'mismatch' },
        missing: [],
        tier: 3,
      },
    },

    // 26. Closing date after closingBefore
    {
      description: 'closing date after closingBefore gives mismatch and tier 3',
      opportunityPatch: { closingDate: new Date('2026-12-05T12:00:00Z') },
      criteria: { closingBefore: new Date('2026-11-30T23:59:59Z') },
      expected: {
        states: { closing: 'mismatch' },
        missing: [],
        tier: 3,
      },
    },

    // 27. Null closing date
    {
      description:
        'null closing date gives unknown, missing [closing] and tier 2',
      opportunityPatch: { closingDate: null },
      criteria: { closingAfter: new Date('2026-11-01T00:00:00Z') },
      expected: {
        states: { closing: 'unknown' },
        missing: ['closing'],
        tier: 2,
      },
    },

    // 28. Mismatch wins over unknown
    {
      description:
        'mismatch wins over unknown: amount mismatch + department unknown gives tier 3',
      opportunityPatch: {
        amount: { amount: 10_000_000 },
        amountKnown: true,
        location: { department: null },
      },
      criteria: {
        amountMin: 50_000_000,
        departments: ['Bogotá D.C.'],
      },
      expected: {
        states: { amount: 'mismatch', department: 'unknown' },
        missing: ['department'],
        tier: 3,
      },
    },

    // 29. Multiple unknowns
    {
      description: 'multiple unknowns give tier 2 and all missing names listed',
      opportunityPatch: {
        amountKnown: false,
        location: { department: null },
        categoryCode: null,
        closingDate: null,
      },
      criteria: {
        amountMin: 50_000_000,
        departments: ['Bogotá D.C.'],
        categoryPrefixes: ['8111'],
        closingAfter: new Date('2026-11-01T00:00:00Z'),
      },
      expected: {
        states: {
          amount: 'unknown',
          department: 'unknown',
          category: 'unknown',
          closing: 'unknown',
        },
        missing: ['amount', 'department', 'category', 'closing'],
        tier: 2,
      },
    },

    // 30. All criteria match
    {
      description: 'all four criteria match gives tier 1 with no missing',
      opportunityPatch: {
        amount: { amount: 100_000_000 },
        amountKnown: true,
        location: { department: 'Bogotá D.C.' },
        categoryCode: '81111500',
        closingDate: new Date('2026-11-15T12:00:00Z'),
      },
      criteria: {
        amountMin: 50_000_000,
        amountMax: 150_000_000,
        departments: ['Bogotá D.C.', 'Cundinamarca'],
        categoryPrefixes: ['8111', '8011'],
        closingAfter: new Date('2026-11-01T00:00:00Z'),
        closingBefore: new Date('2026-11-30T00:00:00Z'),
      },
      expected: {
        states: {
          amount: 'match',
          department: 'match',
          category: 'match',
          closing: 'match',
        },
        missing: [],
        tier: 1,
      },
    },
  ];

  test.each(cases)(
    '$description',
    ({ opportunityPatch, criteria, expected }) => {
      const opp: EvaluatableOpportunity = {
        ...baseOpportunity,
        ...opportunityPatch,
      };
      const result = evaluateCriteria(opp, criteria);
      expect(result).toEqual(expected);
    },
  );
});
