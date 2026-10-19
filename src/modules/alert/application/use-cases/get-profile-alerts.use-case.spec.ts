import { GetProfileAlertsUseCase } from './get-profile-alerts.use-case';
import {
  AlertRepositoryPort,
  PaginatedAlertInbox,
} from '../../domain/ports/alert.repository.port';
import { asAlertId, asOpportunityId, asProfileId } from '../../../shared/domain/typed-id';

describe('GetProfileAlertsUseCase', () => {
  let mockRepo: jest.Mocked<AlertRepositoryPort>;
  let useCase: GetProfileAlertsUseCase;

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
    useCase = new GetProfileAlertsUseCase(mockRepo);
  });

  it('delegates to alertRepository.findByProfile and returns result in ok envelope', async () => {
    const profileId = asProfileId('profile-test-1');
    const mockInbox: PaginatedAlertInbox = {
      items: [
        {
          id: asAlertId('alt-1'),
          profileId,
          opportunityId: asOpportunityId('opp-1'),
          trigger: 'Amendment',
          changeKey: 'amount:2026-10-18',
          attempts: 0,
          lastError: null,
          readAt: null,
          deliveredAt: null,
          createdAt: new Date('2026-10-18T10:00:00Z'),
          opportunitySummary: {
            id: 'opp-1',
            title: 'Licitación Vial',
            entity: 'Alcaldía',
            amount: 100000000,
            closingDate: new Date('2026-10-30T10:00:00Z'),
          },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    };
    mockRepo.findByProfile.mockResolvedValueOnce(mockInbox);

    const result = await useCase.execute({ profileId, page: 1, pageSize: 20 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(mockInbox);
      expect(result.value.items).toHaveLength(1);
    }
    expect(mockRepo.findByProfile).toHaveBeenCalledWith(profileId, 1, 20);
  });
});
