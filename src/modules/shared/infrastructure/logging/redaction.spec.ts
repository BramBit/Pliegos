import { redact, redactString } from './redaction';

describe('Redaction Utilities', () => {
  describe('redactString', () => {
    it('redacts email addresses', () => {
      const input = 'Contact user at john.doe@example.com or admin@pliegos.co for help.';
      const output = redactString(input);
      expect(output).toBe('Contact user at [REDACTED_EMAIL] or [REDACTED_EMAIL] for help.');
    });

    it('redacts JWT tokens', () => {
      const jwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const input = `User authenticated with session jwt: ${jwt}`;
      const output = redactString(input);
      expect(output).toMatch(/\[REDACTED(_TOKEN)?\]/);
      expect(output).not.toContain(jwt);
    });

    it('redacts Bearer tokens in Authorization header formats', () => {
      const input = 'Authorization header: Bearer abc123xyz456def789== sent';
      const output = redactString(input);
      expect(output).toBe('Authorization header: Bearer [REDACTED] sent');
    });

    it('redacts password in database connection strings', () => {
      const input = 'Connecting to postgres://postgres:SuperSecretPassword123@localhost:5432/pliegos';
      const output = redactString(input);
      expect(output).toBe('Connecting to postgres://postgres:[REDACTED]@localhost:5432/pliegos');
    });

    it('redacts key-value password assignments in text', () => {
      const input = 'Connecting with password=mySecretPass and token="xyzSecretToken"';
      const output = redactString(input);
      expect(output).toContain('password=[REDACTED]');
      expect(output).toContain('token="[REDACTED]"');
      expect(output).not.toContain('mySecretPass');
    });
  });

  describe('redact (deep object redaction)', () => {
    it('redacts sensitive keys in objects', () => {
      const payload = {
        username: 'emilia',
        email: 'emilia@example.com',
        password: 'myPassword123',
        nested: {
          token: 'jwt.token.here',
          secret: 'supersecret',
          publicInfo: 'visible',
        },
      };

      const result = redact(payload) as Record<string, any>;

      expect(result.username).toBe('emilia');
      expect(result.email).toBe('[REDACTED_EMAIL]');
      expect(result.password).toBe('[REDACTED]');
      expect(result.nested.token).toBe('[REDACTED]');
      expect(result.nested.secret).toBe('[REDACTED]');
      expect(result.nested.publicInfo).toBe('visible');
    });

    it('redacts items in arrays', () => {
      const list = [
        'test@test.com',
        { token: 'secret-token', note: 'user note' },
        'plain string',
      ];

      const result = redact(list) as any[];

      expect(result[0]).toBe('[REDACTED_EMAIL]');
      expect(result[1].token).toBe('[REDACTED]');
      expect(result[1].note).toBe('user note');
      expect(result[2]).toBe('plain string');
    });

    it('redacts Error objects message and stack', () => {
      const err = new Error('Failed to login for user test@test.com with password=secret');
      const redactedErr = redact(err) as Record<string, unknown>;

      expect(redactedErr.message).toContain('[REDACTED_EMAIL]');
      expect(redactedErr.message).toContain('password=[REDACTED]');
      expect(redactedErr.message).not.toContain('test@test.com');
      expect(redactedErr.message).not.toContain('secret');
    });

    it('passes through null and undefined unchanged', () => {
      expect(redact(null)).toBeNull();
      expect(redact(undefined)).toBeUndefined();
    });
  });
});
