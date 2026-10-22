import { asOpportunityId } from '../../../shared/domain/typed-id';
import {
  createOpportunity,
  withOpportunityChange,
  withOpportunityAnalysis,
  buildIndexText,
  isRecommendable,
  MAX_INDEX_DESCRIPTION_LENGTH,
} from './opportunity.entity';
import { createMoney } from '../value-objects/money.vo';

describe('Opportunity Entity', () => {
  const validMoney = createMoney(50000000);
  if (!validMoney.ok) throw new Error('Setup failed');

  const baseProps = {
    id: asOpportunityId('opp-001'),
    title: 'Adquisición de licencias de software',
    description: 'Licenciamiento anual para servidores institucionales',
    contractingEntity: {
      name: 'Ministerio de Tecnologías de la Información',
      taxId: '899999034-1',
    },
    location: {
      city: 'Bogotá',
      department: 'Bogotá D.C.',
    },
    amount: validMoney.value,
    amountKnown: true,
    contractType: 'Prestación de servicios',
    procurementModality: 'Licitación pública',
    isCompetitive: true,
    categoryCode: '43230000',
    publishedAt: new Date('2026-10-01T10:00:00.000Z'),
    lastPublishedAt: new Date('2026-10-02T10:00:00.000Z'),
    closingDate: new Date('2026-10-31T17:00:00.000Z'),
    isOpenForSubmission: true,
    status: 'Published' as const,
    source: {
      sourceName: 'SECOP' as const,
      externalId: 'CO1.REQ.1001',
      humanReference: 'MINTIC-01-2026',
      originalUrl: 'https://community.secop.gov.co/process/1001',
    },
  };

  it('creates a valid Opportunity with all fields properly populated', () => {
    const result = createOpportunity(baseProps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const opp = result.value;
      expect(opp.id).toBe('opp-001');
      expect(opp.title).toBe('Adquisición de licencias de software');
      expect(opp.description).toBe('Licenciamiento anual para servidores institucionales');
      expect(opp.amount.amount).toBe(50000000);
      expect(opp.amount.currency).toBe('COP');
      expect(opp.amountKnown).toBe(true);
      expect(opp.isCompetitive).toBe(true);
      expect(opp.categoryCode).toBe('43230000');
      expect(opp.lastPublishedAt).toEqual(new Date('2026-10-02T10:00:00.000Z'));
      expect(opp.closingDate).toEqual(new Date('2026-10-31T17:00:00.000Z'));
      expect(opp.isOpenForSubmission).toBe(true);
      expect(opp.status).toBe('Published');
      expect(opp.analysis).toBeNull();
      expect(opp.changeHistory).toEqual([]);
    }
  });

  it('permits null closingDate and null categoryCode', () => {
    const directContractProps = {
      ...baseProps,
      procurementModality: 'Contratación directa',
      isCompetitive: false,
      categoryCode: null,
      closingDate: null,
    };

    const result = createOpportunity(directContractProps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.closingDate).toBeNull();
      expect(result.value.categoryCode).toBeNull();
      expect(result.value.isCompetitive).toBe(false);
    }
  });

  it('validates required fields on creation and reports missing fields', () => {
    const invalidProps = {
      ...baseProps,
      id: asOpportunityId(''),
      title: '',
      contractingEntity: { name: '', taxId: '' },
      source: { sourceName: 'SECOP' as const, externalId: '', humanReference: '', originalUrl: '' },
      publishedAt: new Date('invalid-date'),
    };

    const result = createOpportunity(invalidProps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.fields).toContain('id');
      expect(result.error.fields).toContain('title');
      expect(result.error.fields).toContain('contractingEntity.name');
      expect(result.error.fields).toContain('source.externalId');
      expect(result.error.fields).toContain('publishedAt');
    }
  });

  it('records changes and updates status to Amended via withOpportunityChange', () => {
    const created = createOpportunity(baseProps);
    if (!created.ok) throw new Error('Setup failed');

    const change = {
      field: 'closingDate',
      previousValue: '2026-10-31T17:00:00.000Z',
      newValue: '2026-11-15T17:00:00.000Z',
      detectedAt: new Date('2026-10-15T09:00:00.000Z'),
    };

    const amended = withOpportunityChange(created.value, change);
    expect(amended.status).toBe('Amended');
    expect(amended.changeHistory).toHaveLength(1);
    expect(amended.changeHistory[0]).toEqual(change);
    expect(created.value.status).toBe('Published');
  });

  it('attaches analysis via withOpportunityAnalysis', () => {
    const created = createOpportunity(baseProps);
    if (!created.ok) throw new Error('Setup failed');

    const analysis = {
      summary: 'Resumen del pliego técnico',
      requirements: [{ text: 'Experiencia mínima 3 años', type: 'technical' as const }],
      embeddingGeneratedAt: new Date('2026-10-02T12:00:00.000Z'),
    };

    const analyzed = withOpportunityAnalysis(created.value, analysis);
    expect(analyzed.analysis).toEqual(analysis);
    expect(created.value.analysis).toBeNull();
  });

  describe('buildIndexText', () => {
    it('includes title, description, entityName and contractType and excludes categoryCode, amount, city, department and modality', () => {
      const created = createOpportunity(baseProps);
      if (!created.ok) throw new Error('Setup failed');

      const text = buildIndexText(created.value);
      expect(text).toBe(
        'Adquisición de licencias de software. Licenciamiento anual para servidores institucionales. Entidad: Ministerio de Tecnologías de la Información. Tipo: Prestación de servicios.',
      );
      expect(text).not.toContain('43230000');
      expect(text).not.toContain('50000000');
      expect(text).not.toContain('Bogotá');
      expect(text).not.toContain('Licitación pública');
    });

    it('uses title only when description is empty', () => {
      const created = createOpportunity({ ...baseProps, description: '   ' });
      if (!created.ok) throw new Error('Setup failed');

      const text = buildIndexText(created.value);
      expect(text).toBe(
        'Adquisición de licencias de software. Entidad: Ministerio de Tecnologías de la Información. Tipo: Prestación de servicios.',
      );
    });

    it('uses title only when description equals the title (case-insensitive)', () => {
      const created = createOpportunity({
        ...baseProps,
        description: 'ADQUISICIÓN DE LICENCIAS DE SOFTWARE',
      });
      if (!created.ok) throw new Error('Setup failed');

      const text = buildIndexText(created.value);
      expect(text).toBe(
        'Adquisición de licencias de software. Entidad: Ministerio de Tecnologías de la Información. Tipo: Prestación de servicios.',
      );
    });

    it('truncates long descriptions to 1500 characters', () => {
      const longDesc = 'A'.repeat(2200);
      const created = createOpportunity({
        ...baseProps,
        description: longDesc,
      });
      if (!created.ok) throw new Error('Setup failed');

      const text = buildIndexText(created.value);
      const expectedTruncated = 'A'.repeat(MAX_INDEX_DESCRIPTION_LENGTH);
      expect(text).toBe(
        `Adquisición de licencias de software. ${expectedTruncated}. Entidad: Ministerio de Tecnologías de la Información. Tipo: Prestación de servicios.`,
      );
    });
  });

  describe('isRecommendable', () => {
    const fixedNow = new Date('2026-10-20T12:00:00.000Z');

    it('returns false for direct contracting (non-competitive)', () => {
      expect(
        isRecommendable(
          {
            isCompetitive: false,
            status: 'Published',
            closingDate: new Date('2026-10-25T12:00:00.000Z'),
          },
          fixedNow,
        ),
      ).toBe(false);
    });

    it('returns false for awarded status', () => {
      expect(
        isRecommendable(
          {
            isCompetitive: true,
            status: 'Awarded',
            closingDate: new Date('2026-10-25T12:00:00.000Z'),
          },
          fixedNow,
        ),
      ).toBe(false);
    });

    it('returns false when closed 10 days ago', () => {
      const tenDaysAgo = new Date('2026-10-10T12:00:00.000Z');
      expect(
        isRecommendable(
          {
            isCompetitive: true,
            status: 'Published',
            closingDate: tenDaysAgo,
          },
          fixedNow,
        ),
      ).toBe(false);
    });

    it('returns true for competitive opportunity with no closing date', () => {
      expect(
        isRecommendable(
          {
            isCompetitive: true,
            status: 'Published',
            closingDate: null,
          },
          fixedNow,
        ),
      ).toBe(true);
    });

    it('returns true when closed within 7 days (e.g. 2 days ago)', () => {
      const twoDaysAgo = new Date('2026-10-18T12:00:00.000Z');
      expect(
        isRecommendable(
          {
            isCompetitive: true,
            status: 'Published',
            closingDate: twoDaysAgo,
          },
          fixedNow,
        ),
      ).toBe(true);
    });

    it('returns true for Amended status with future closing date', () => {
      expect(
        isRecommendable(
          {
            isCompetitive: true,
            status: 'Amended',
            closingDate: new Date('2026-10-25T12:00:00.000Z'),
          },
          fixedNow,
        ),
      ).toBe(true);
    });
  });
});

