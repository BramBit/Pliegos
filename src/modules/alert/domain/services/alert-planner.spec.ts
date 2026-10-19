import { AlertPlanner, planAlerts, WatcherProfile } from './alert-planner';
import { asOpportunityId, asProfileId } from '../../../shared/domain/typed-id';
import { Change } from '../../../opportunity/domain/value-objects/opportunity.value-objects';

describe('AlertPlanner Domain Service', () => {
  const opportunityId = asOpportunityId('opp-100');
  const now = new Date('2026-10-18T15:30:00.000Z');

  const watcher1: WatcherProfile = {
    profileId: asProfileId('prof-1'),
    alertsEnabled: true,
    contactEmail: 'user1@example.com',
  };

  const watcher2: WatcherProfile = {
    profileId: asProfileId('prof-2'),
    alertsEnabled: true,
    contactEmail: 'user2@example.com',
  };

  const disabledWatcher: WatcherProfile = {
    profileId: asProfileId('prof-3'),
    alertsEnabled: false,
    contactEmail: 'user3@example.com',
  };

  it('creates a StatusChange alert when status changes materially', () => {
    const statusChange: Change = {
      field: 'status',
      previousValue: 'Published',
      newValue: 'Closed',
      detectedAt: now,
      material: true,
    };

    const alerts = AlertPlanner.planAlerts(opportunityId, [statusChange], [watcher1]);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].profileId).toBe('prof-1');
    expect(alerts[0].opportunityId).toBe('opp-100');
    expect(alerts[0].trigger).toBe('StatusChange');
    expect(alerts[0].changeKey).toBe(`status:${now.toISOString()}`);
    expect(alerts[0].deliveredAt).toBeNull();
    expect(alerts[0].attempts).toBe(0);
  });

  it('creates Amendment alerts for closingDate, amount, and description changes', () => {
    const changes: Change[] = [
      {
        field: 'closingDate',
        previousValue: '2026-10-20T00:00:00.000Z',
        newValue: '2026-10-25T00:00:00.000Z',
        detectedAt: now,
        material: true,
      },
      {
        field: 'amount',
        previousValue: '100000000',
        newValue: '120000000',
        detectedAt: now,
        material: true,
      },
      {
        field: 'description',
        previousValue: 'Desc v1',
        newValue: 'Desc v2 with modification',
        detectedAt: now,
        material: true,
      },
    ];

    const alerts = planAlerts(opportunityId, changes, [watcher1]);

    expect(alerts).toHaveLength(3);
    expect(alerts.map((a) => a.trigger)).toEqual(['Amendment', 'Amendment', 'Amendment']);
    expect(alerts.map((a) => a.changeKey)).toEqual([
      `closingDate:${now.toISOString()}`,
      `amount:${now.toISOString()}`,
      `description:${now.toISOString()}`,
    ]);
  });

  it('ignores non-material changes', () => {
    const changes: Change[] = [
      {
        field: 'title',
        previousValue: 'Old Title',
        newValue: 'New Title',
        detectedAt: now,
        material: false,
      },
      {
        field: 'categoryCode',
        previousValue: '43211500',
        newValue: '43211501',
        detectedAt: now,
        material: false,
      },
    ];

    const alerts = AlertPlanner.planAlerts(opportunityId, changes, [watcher1]);
    expect(alerts).toHaveLength(0);
  });

  it('skips watchers that have alerts_enabled = false', () => {
    const change: Change = {
      field: 'status',
      previousValue: 'Published',
      newValue: 'Closed',
      detectedAt: now,
      material: true,
    };

    const alerts = AlertPlanner.planAlerts(
      opportunityId,
      [change],
      [watcher1, disabledWatcher, watcher2],
    );

    expect(alerts).toHaveLength(2);
    const profileIds = alerts.map((a) => a.profileId);
    expect(profileIds).toContain('prof-1');
    expect(profileIds).toContain('prof-2');
    expect(profileIds).not.toContain('prof-3');
  });

  it('returns empty array when there are no active watchers or no material changes', () => {
    const materialChange: Change = {
      field: 'status',
      previousValue: 'A',
      newValue: 'B',
      detectedAt: now,
      material: true,
    };

    expect(AlertPlanner.planAlerts(opportunityId, [materialChange], [])).toEqual([]);
    expect(AlertPlanner.planAlerts(opportunityId, [materialChange], [disabledWatcher])).toEqual([]);
    expect(AlertPlanner.planAlerts(opportunityId, [], [watcher1])).toEqual([]);
  });
});
