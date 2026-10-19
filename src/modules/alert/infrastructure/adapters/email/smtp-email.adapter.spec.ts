import { LoggerService } from '@nestjs/common';
import type { Transporter } from 'nodemailer';
import { SmtpEmailAdapter, SmtpConfig } from './smtp-email.adapter';

describe('SmtpEmailAdapter', () => {
  let fakeLogger: LoggerService;
  let mockTransporter: { sendMail: jest.Mock };

  const baseConfig: SmtpConfig = {
    host: 'localhost',
    port: 1025,
    from: 'Pliegos <alertas@pliegos.co>',
    secure: false,
  };

  beforeEach(() => {
    fakeLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };
    mockTransporter = {
      sendMail: jest.fn().mockResolvedValue({ messageId: '123' }),
    };
  });

  it('sends email to recipient with name', async () => {
    const adapter = new SmtpEmailAdapter({
      config: baseConfig,
      transporter: mockTransporter as unknown as Transporter,
      logger: fakeLogger,
    });

    await adapter.send(
      { email: 'contacto@constructora.com', name: 'Constructora Bolivar' },
      {
        subject: 'Actualización de licitación',
        text: 'Contenido en texto plano',
        html: '<p>Contenido en HTML</p>',
      },
    );

    expect(mockTransporter.sendMail).toHaveBeenCalledTimes(1);
    expect(mockTransporter.sendMail).toHaveBeenCalledWith({
      from: 'Pliegos <alertas@pliegos.co>',
      to: '"Constructora Bolivar" <contacto@constructora.com>',
      subject: 'Actualización de licitación',
      text: 'Contenido en texto plano',
      html: '<p>Contenido en HTML</p>',
    });
    expect(fakeLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('[SmtpEmailAdapter] Email sent to "Constructora Bolivar" <contacto@constructora.com>'),
    );
  });

  it('sends email to recipient without name', async () => {
    const adapter = new SmtpEmailAdapter({
      config: baseConfig,
      transporter: mockTransporter as unknown as Transporter,
      logger: fakeLogger,
    });

    await adapter.send(
      { email: 'solo@correo.com' },
      {
        subject: 'Aviso',
        text: 'Hola',
        html: '<p>Hola</p>',
      },
    );

    expect(mockTransporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'solo@correo.com',
      }),
    );
  });

  it('logs error and re-throws when transporter fails', async () => {
    mockTransporter.sendMail.mockRejectedValueOnce(new Error('Connection refused'));

    const adapter = new SmtpEmailAdapter({
      config: baseConfig,
      transporter: mockTransporter as unknown as Transporter,
      logger: fakeLogger,
    });

    await expect(
      adapter.send(
        { email: 'fail@correo.com' },
        { subject: 'Error test', text: 'txt', html: '<p>html</p>' },
      ),
    ).rejects.toThrow('Connection refused');

    expect(fakeLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('[SmtpEmailAdapter] Failed to send email to fail@correo.com: Connection refused'),
    );
  });

  it('creates default transporter with auth when user/pass are provided', () => {
    const adapter = new SmtpEmailAdapter({
      config: {
        ...baseConfig,
        user: 'user@example.com',
        pass: 'secret',
      },
      logger: fakeLogger,
    });

    expect(adapter.getTransporter()).toBeDefined();
  });
});
