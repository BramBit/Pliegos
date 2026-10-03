import { LoggerService } from '@nestjs/common';
import { EmailAdapter } from './email.adapter';
import { asProfileId } from '../../../../shared/domain/typed-id';

describe('EmailAdapter', () => {
  let fakeLogger: LoggerService;

  beforeEach(() => {
    fakeLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };
  });

  it('records and logs sent email notification for valid email channel', async () => {
    const adapter = new EmailAdapter({ logger: fakeLogger });
    const profileId = asProfileId('profile-99');
    const message = 'Nueva adenda detectada en la licitacion vial';

    await adapter.send(profileId, message, 'email');

    const sent = adapter.getSentNotifications();
    expect(sent).toHaveLength(1);
    expect(sent[0].profileId).toBe(profileId);
    expect(sent[0].message).toBe(message);
    expect(sent[0].sentAt).toBeInstanceOf(Date);
    expect(fakeLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('[EmailAdapter] Notification sent to Profile profile-99'),
    );
  });

  it('rejects unsupported notification channel', async () => {
    const adapter = new EmailAdapter({ logger: fakeLogger });
    const profileId = asProfileId('profile-99');

    await expect(
      adapter.send(profileId, 'test', 'sms' as any),
    ).rejects.toThrow("EmailAdapter only supports 'email' channel, received 'sms'");
  });

  it('triggers onSend callback when provided', async () => {
    const mockOnSend = jest.fn();
    const adapter = new EmailAdapter({ onSend: mockOnSend, logger: fakeLogger });
    const profileId = asProfileId('profile-1');

    await adapter.send(profileId, 'Alerta de plazo cercano', 'email');

    expect(mockOnSend).toHaveBeenCalledTimes(1);
    expect(mockOnSend).toHaveBeenCalledWith(
      expect.objectContaining({ profileId, message: 'Alerta de plazo cercano' }),
    );
  });

  it('clears recorded notifications buffer', async () => {
    const adapter = new EmailAdapter({ logger: fakeLogger });
    await adapter.send(asProfileId('p1'), 'msg1', 'email');
    expect(adapter.getSentNotifications()).toHaveLength(1);

    adapter.clear();
    expect(adapter.getSentNotifications()).toHaveLength(0);
  });
});
