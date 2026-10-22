import { LoggerService } from '@nestjs/common';
import { InMemoryNotificationAdapter } from './in-memory-notification.adapter';

describe('InMemoryNotificationAdapter', () => {
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

  it('records and logs sent notification', async () => {
    const adapter = new InMemoryNotificationAdapter({ logger: fakeLogger });
    const to = { email: 'contratista@ejemplo.com', name: 'Empresa SAS' };
    const content = {
      subject: 'Nueva adenda detectada',
      text: 'Texto plano',
      html: '<p>HTML</p>',
    };

    await adapter.send(to, content);

    const sent = adapter.getSentNotifications();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(to);
    expect(sent[0].content).toEqual(content);
    expect(sent[0].sentAt).toBeInstanceOf(Date);
    expect(fakeLogger.log).toHaveBeenCalledWith(
      expect.stringContaining(
        '[InMemoryNotificationAdapter] Sent to contratista@ejemplo.com (Empresa SAS): "Nueva adenda detectada"',
      ),
    );
  });

  it('triggers onSend callback when provided', async () => {
    const mockOnSend = jest.fn();
    const adapter = new InMemoryNotificationAdapter({
      onSend: mockOnSend,
      logger: fakeLogger,
    });
    const to = { email: 'alerta@ejemplo.com' };
    const content = {
      subject: 'Alerta de plazo',
      text: 'Texto plano',
      html: '<p>HTML</p>',
    };

    await adapter.send(to, content);

    expect(mockOnSend).toHaveBeenCalledTimes(1);
    expect(mockOnSend).toHaveBeenCalledWith(
      expect.objectContaining({ to, content }),
    );
  });

  it('clears recorded notifications buffer', async () => {
    const adapter = new InMemoryNotificationAdapter({ logger: fakeLogger });
    await adapter.send(
      { email: 'a@b.com' },
      { subject: 'S1', text: 'T1', html: 'H1' },
    );
    expect(adapter.getSentNotifications()).toHaveLength(1);

    adapter.clear();
    expect(adapter.getSentNotifications()).toHaveLength(0);
  });
});
