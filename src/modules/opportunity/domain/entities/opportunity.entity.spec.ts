import { asOpportunityId } from '../../../shared/domain/typed-id';
import {
  createOpportunity,
  withOpportunityChange,
  withOpportunityAnalysis,
  Opportunity,
} from './opportunity.entity';
import { createMoney } from '../value-objects/money.vo';

describe('Opportunity Entity', () => {
  const validMoney = createMoney(50000000);
  if (!validMoney.ok) throw new Error('Setup failed');

  const baseProps = {
    id: asOpportunityId('opp-001'),
    title: 'Adquisición de licencias de software',
    contractingEntity: {
      name: 'Ministerio de Tecnologías de la Información',
      taxId: '899999034-1',
    },
    location: {
      city: 'Bogotá',
      department: 'Bogotá D.C.',
    },
    amount: validMoney.value,
    contractType: 'Prestación de servicios',
    procurementModality: 'Licitación pública',
    categoryCode: 'V1.43230000',
    publishedAt: new Date('2026-10-01T10:00:00.000Z'),
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
      expect(opp.amount.amount).toBe(50000000);
      expect(opp.amount.currency).toBe('COP');
      expect(opp.closingDate).toEqual(new Date('2026-10-31T17:00:00.000Z'));
      expect(opp.isOpenForSubmission).toBe(true);
      expect(opp.status).toBe('Published');
      expect(opp.analysis).toBeNull();
      expect(opp.changeHistory).toEqual([]);
    }
  });

  it('permits null closingDate (valid for direct contracting processes)', () => {
    const directContractProps = {
      ...baseProps,
      procurementModality: 'Contratación directa',
      closingDate: null,
    };

    const result = createOpportunity(directContractProps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.closingDate).toBeNull();
    }
  });

  it('validates required fields on creation and reports missing fields', () => {
    const invalidProps = {
      ...baseProps,
      id: asOpportunityId(''),
      title: '',
      contractingEntity: { name: '', taxId: '' },
      categoryCode: '',
      source: { sourceName: 'SECOP' as const, externalId: '', humanReference: '', originalUrl: '' },
      publishedAt: new Date('invalid-date'),
    };

    const result = createOpportunity(invalidProps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.fields).toContain('id');
      expect(result.error.fields).toContain('title');
      expect(result.error.fields).toContain('contractingEntity.name');
      expect(result.error.fields).toContain('categoryCode');
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
    // Preserves original immutable object
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
});
