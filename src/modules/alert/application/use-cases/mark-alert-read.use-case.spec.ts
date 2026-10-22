import { MarkAlertReadUseCase } from './mark-alert-read.use-case';
import { AlertRepositoryPort } from '../../domain/ports/alert.repository.port';
import {
  asAlertId,
  asOpportunityId,
  asProfileId,
} from '../../../shared/domain/typed-id';
import { Alert } from '../../domain/entities/alert.entity';

describe('MarkAlertReadUseCase', () => {
  let mockRepo: jest.Mocked<AlertRepositoryPort>;
  let useCase: MarkAlertReadUseCase;

  beforeEach(() => {
    mockRepo = {
      save: jest.fn(),
      createMany: jest.fn(),
      findUndelivered: jest.fn(),
      findById: jest.fn(),
      markFailed: jest.fn(),
      findByProfile: jest.fn(),
      markRead: jest.fn(),
      markAllRead: jest.fn(),
    };
    useCase = new MarkAlertReadUseCase(mockRepo);
  });

  it('marks alert read when alert exists', async () => {
    const alert: Alert = {
      id: asAlertId('alt-read-1'),
      profileId: asProfileId('prof-1'),
      opportunityId: asOpportunityId('opp-1'),
      trigger: 'Amendment',
      changeKey: 'k1',
      attempts: 0,
      lastError: null,
      readAt: null,
      deliveredAt: null,
    };
    mockRepo.findById.mockResolvedValueOnce(alert);
    mockRepo.markRead.mockResolvedValueOnce(true);

    const result = await useCase.execute({ alertId: alert.id });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
      expect(result.value.alert.readAt).toBeInstanceOf(Date);
    }
    expect(mockRepo.findById).toHaveBeenCalledWith(alert.id);
    expect(mockRepo.markRead).toHaveBeenCalledWith(alert.id);
  });

  it('returns AlertNotFoundError when alert is not found', async () => {
    mockRepo.findById.mockResolvedValueOnce(null);

    const result = await useCase.execute({ alertId: asAlertId('nonexistent') });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('AlertNotFoundError');
      expect(result.error.alertId).toBe('nonexistent');
    }
    expect(mockRepo.markRead).not.toHaveBeenCalled();
  });
});
