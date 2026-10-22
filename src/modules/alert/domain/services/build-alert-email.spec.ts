import {
  buildAlertEmail,
  formatCopAmount,
  formatBogotaDate,
} from './build-alert-email';
import { Alert } from '../entities/alert.entity';
import { Opportunity } from '../../../opportunity/domain/entities/opportunity.entity';
import { Profile } from '../../../profile/domain/entities/profile.entity';
import {
  asAlertId,
  asOpportunityId,
  asProfileId,
  asUserId,
} from '../../../shared/domain/typed-id';

describe('buildAlertEmail', () => {
  const baseOpportunity: Opportunity = {
    id: asOpportunityId('opp-123'),
    title: 'Construcción de Puente Vehicular sobre Río Cauca',
    description: 'Obra de infraestructura',
    contractingEntity: {
      name: 'Gobernación del Valle del Cauca',
      taxId: '890399029-5',
    },
    location: {
      department: 'Valle del Cauca',
      city: 'Cali',
    },
    amount: {
      amount: 150000000,
      currency: 'COP',
    },
    amountKnown: true,
    contractType: 'Obra',
    procurementModality: 'Licitación pública',
    isCompetitive: true,
    categoryCode: '72141100',
    publishedAt: new Date('2026-10-01T10:00:00Z'),
    lastPublishedAt: new Date('2026-10-05T12:00:00Z'),
    closingDate: new Date('2026-10-25T22:00:00Z'), // 5:00 PM Bogota
    isOpenForSubmission: true,
    status: 'Published',
    source: {
      sourceName: 'SECOP',
      externalId: '1234567',
      humanReference: 'CO1.REQ.1234567',
      originalUrl:
        'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/1234567',
    },
    analysis: null,
    changeHistory: [
      {
        field: 'status',
        previousValue: 'Draft',
        newValue: 'Published',
        detectedAt: new Date('2026-10-05T12:00:00Z'),
        material: true,
      },
      {
        field: 'closingDate',
        previousValue: '2026-10-20T22:00:00.000Z',
        newValue: '2026-10-25T22:00:00.000Z',
        detectedAt: new Date('2026-10-10T14:30:00Z'),
        material: true,
      },
    ],
  };

  const baseProfile: Profile = {
    id: asProfileId('prof-1'),
    ownerId: asUserId('user-1'),
    name: 'Constructora del Sur SAS',
    contactEmail: 'licitaciones@constructoradelsur.com',
    alertsEnabled: true,
    deadlineAlertDays: 3,
    sector: 'Construcción',
    capabilities: [],
    preferences: {
      categoryCodes: [],
      keywords: [],
      amountRange: { min: 0, max: 500000000 },
      departments: ['Valle del Cauca'],
    },
  };

  it('builds email for Amendment alert matching change history', () => {
    const alert: Alert = {
      id: asAlertId('alt-1'),
      profileId: baseProfile.id,
      opportunityId: baseOpportunity.id,
      trigger: 'Amendment',
      changeKey: 'closingDate:2026-10-10T14:30:00.000Z',
      attempts: 0,
      lastError: null,
      readAt: null,
      deliveredAt: null,
    };

    const email = buildAlertEmail(alert, baseOpportunity, baseProfile);

    expect(email.subject).toBe(
      '[Pliegos] Adenda detectada: Construcción de Puente Vehicular sobre Río Cauca',
    );
    expect(email.text).toContain('Hola Constructora del Sur SAS');
    expect(email.text).toContain('Gobernación del Valle del Cauca');
    expect(email.text).toContain('$ 150.000.000 COP');
    expect(email.text).toContain(
      'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/1234567',
    );
    expect(email.text).toContain('Campo modificado: Fecha de cierre');
    expect(email.text).toContain('Valor anterior: 2026-10-20T22:00:00.000Z');
    expect(email.text).toContain('Nuevo valor: 2026-10-25T22:00:00.000Z');
    expect(email.text).toContain(
      'Para desactivar o configurar las alertas de este perfil',
    );

    expect(email.html).toContain(
      'Construcción de Puente Vehicular sobre Río Cauca',
    );
    expect(email.html).toContain('Gobernación del Valle del Cauca');
    expect(email.html).toContain(
      'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/1234567',
    );
    expect(email.html).toContain('Ver proceso original en SECOP');
  });

  it('builds email for StatusChange alert', () => {
    const alert: Alert = {
      id: asAlertId('alt-2'),
      profileId: baseProfile.id,
      opportunityId: baseOpportunity.id,
      trigger: 'StatusChange',
      changeKey: 'status:2026-10-05T12:00:00.000Z',
      attempts: 0,
      lastError: null,
      readAt: null,
      deliveredAt: null,
    };

    const email = buildAlertEmail(alert, baseOpportunity, baseProfile);

    expect(email.subject).toBe(
      '[Pliegos] Cambio de estado: Construcción de Puente Vehicular sobre Río Cauca',
    );
    expect(email.text).toContain('Campo modificado: Estado del proceso');
    expect(email.text).toContain('Valor anterior: Draft');
    expect(email.text).toContain('Nuevo valor: Published');
  });

  it('builds email for DeadlineApproaching alert', () => {
    const alert: Alert = {
      id: asAlertId('alt-3'),
      profileId: baseProfile.id,
      opportunityId: baseOpportunity.id,
      trigger: 'DeadlineApproaching',
      changeKey: 'deadline:2026-10-25',
      attempts: 0,
      lastError: null,
      readAt: null,
      deliveredAt: null,
    };

    const email = buildAlertEmail(alert, baseOpportunity, baseProfile);

    expect(email.subject).toBe(
      '[Pliegos] Plazo próximo a vencer: Construcción de Puente Vehicular sobre Río Cauca',
    );
    expect(email.text).toContain(
      'El plazo para participar en esta oportunidad está próximo a vencer',
    );
    expect(email.html).toContain(
      '⚠️ El plazo para participar en esta oportunidad está próximo a vencer',
    );
  });

  it('handles unknown amount and profile without name gracefully', () => {
    const unknownAmountOpp: Opportunity = {
      ...baseOpportunity,
      amountKnown: false,
      amount: { amount: 0, currency: 'COP' },
      closingDate: null,
    };
    const profileNoName: Profile = {
      ...baseProfile,
      name: null,
    };
    const alert: Alert = {
      id: asAlertId('alt-4'),
      profileId: profileNoName.id,
      opportunityId: unknownAmountOpp.id,
      trigger: 'Amendment',
      changeKey: 'unknown',
      attempts: 0,
      lastError: null,
      readAt: null,
      deliveredAt: null,
    };

    const email = buildAlertEmail(alert, unknownAmountOpp, profileNoName);

    expect(email.text).toContain('Hola Contratista,');
    expect(email.text).toContain('Cuantía: Cuantía no determinada');
    expect(email.text).toContain('Fecha de cierre (Bogotá): No informada');
  });

  describe('formatCopAmount & formatBogotaDate helpers', () => {
    it('formats COP amounts correctly', () => {
      expect(formatCopAmount(5000000, true)).toBe('$ 5.000.000 COP');
      expect(formatCopAmount(0, false)).toBe('Cuantía no determinada');
    });

    it('formats dates in America/Bogota timezone', () => {
      const utcDate = new Date('2026-10-25T17:00:00Z'); // 12:00 PM Bogota (-05:00)
      const formatted = formatBogotaDate(utcDate);
      expect(formatted).toContain('25 de octubre de 2026');
      expect(formatted).toMatch(/12:00\s*(p\.\s*m\.|PM|pm)/i);
    });
  });
});
