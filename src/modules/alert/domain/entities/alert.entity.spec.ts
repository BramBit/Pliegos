import {
  asAlertId,
  asProfileId,
  asOpportunityId,
} from '../../../shared/domain/typed-id';
import { createAlert, markAlertDelivered } from './alert.entity';

describe('Alert Entity', () => {
  it('creates a valid Alert entity', () => {
    const alert = createAlert({
      id: asAlertId('alert-001'),
      profileId: asProfileId('prof-001'),
      opportunityId: asOpportunityId('opp-001'),
      trigger: 'DeadlineApproaching',
    });

    expect(alert.ok).toBe(true);
    if (alert.ok) {
      expect(alert.value.id).toBe('alert-001');
      expect(alert.value.trigger).toBe('DeadlineApproaching');
      expect(alert.value.deliveredAt).toBeNull();
    }
  });

  it('validates required fields', () => {
    const invalid = createAlert({
      id: asAlertId(''),
      profileId: asProfileId(''),
      opportunityId: asOpportunityId(''),
      trigger: '' as any,
    });

    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.fields).toContain('id');
      expect(invalid.error.fields).toContain('profileId');
      expect(invalid.error.fields).toContain('opportunityId');
      expect(invalid.error.fields).toContain('trigger');
    }
  });

  it('marks alert delivered via markAlertDelivered', () => {
    const created = createAlert({
      id: asAlertId('alert-002'),
      profileId: asProfileId('prof-001'),
      opportunityId: asOpportunityId('opp-001'),
      trigger: 'Amendment',
    });
    if (!created.ok) throw new Error('Alert failed');

    const deliveryTime = new Date('2026-10-02T16:00:00.000Z');
    const delivered = markAlertDelivered(created.value, deliveryTime);

    expect(delivered.deliveredAt).toEqual(deliveryTime);
    expect(created.value.deliveredAt).toBeNull();
  });
});
