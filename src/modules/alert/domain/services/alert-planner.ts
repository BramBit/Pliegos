import { randomUUID } from 'node:crypto';
import {
  asAlertId,
  OpportunityId,
  ProfileId,
} from '../../../shared/domain/typed-id';
import { Change } from '../../../opportunity/domain/value-objects/opportunity.value-objects';
import { Alert, AlertTrigger, createAlert } from '../entities/alert.entity';

export interface WatcherProfile {
  readonly profileId: ProfileId;
  readonly alertsEnabled: boolean;
  readonly contactEmail?: string | null;
}

export class AlertPlanner {
  static planAlerts(
    opportunityId: OpportunityId,
    changes: readonly Change[],
    watchers: readonly WatcherProfile[],
  ): Alert[] {
    const activeWatchers = watchers.filter((w) => w.alertsEnabled);
    if (activeWatchers.length === 0) {
      return [];
    }

    const materialChanges = changes.filter((c) => c.material);
    if (materialChanges.length === 0) {
      return [];
    }

    const alerts: Alert[] = [];

    for (const watcher of activeWatchers) {
      for (const change of materialChanges) {
        const trigger: AlertTrigger =
          change.field === 'status' ? 'StatusChange' : 'Amendment';
        const detectedAtIso =
          change.detectedAt instanceof Date
            ? change.detectedAt.toISOString()
            : new Date(change.detectedAt).toISOString();
        const changeKey = `${change.field}:${detectedAtIso}`;

        const alertRes = createAlert({
          id: asAlertId(randomUUID()),
          profileId: watcher.profileId,
          opportunityId,
          trigger,
          changeKey,
        });

        if (alertRes.ok) {
          alerts.push(alertRes.value);
        }
      }
    }

    return alerts;
  }
}

export const planAlerts = AlertPlanner.planAlerts;
