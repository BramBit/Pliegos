import { MarkAllAlertsReadUseCase } from './mark-all-alerts-read.use-case';
import { AlertRepositoryPort } from '../../domain/ports/alert.repository.port';
import { asProfileId } from '../../../shared/domain/typed-id';

describe('MarkAllAlertsReadUseCase', () => {
  let mockRepo: jest.Mocked<AlertRepositoryPort>;
  let useCase: MarkAllAlertsReadUseCase;

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
    useCase = new MarkAllAlertsReadUseCase(mockRepo);
  });

  it('marks all alerts read for a profile and returns the count', async () => {
    const profileId = asProfileId('profile-test-1');
    mockRepo.markAllRead.mockResolvedValueOnce(3);

    const result = await useCase.execute({ profileId });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
      expect(result.value.markedCount).toBe(3);
    }
    expect(mockRepo.markAllRead).toHaveBeenCalledWith(profileId);
  });
});
