/**
 * Pure redaction utilities for structured and unstructured logs.
 * Masks emails, passwords, secrets, JWT tokens, and Bearer authorization headers.
 */

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const JWT_REGEX = /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g;
const BEARER_REGEX = /Bearer\s+[a-zA-Z0-9._~+/-]+=*/gi;
const DB_URL_PASSWORD_REGEX = /(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/gi;
const KEY_VALUE_PASSWORD_REGEX =
  /\b(password|pass|secret|token|authorization|apiKey|appToken)\b(\s*[:=]\s*["']?)([^"',;\s]+)(["']?)/gi;

const SENSITIVE_KEY_NAMES = new Set([
  'password',
  'pass',
  'secret',
  'currentpassword',
  'newpassword',
  'token',
  'refreshtoken',
  'accesstoken',
  'authorization',
  'apikey',
  'apptoken',
  'jwt_secret',
  'smtp_pass',
]);

/**
 * Redacts sensitive substrings in a plain text message.
 */
export function redactString(text: string): string {
  if (!text || typeof text !== 'string') return text;

  return text
    .replace(DB_URL_PASSWORD_REGEX, '$1[REDACTED]$3')
    .replace(BEARER_REGEX, 'Bearer [REDACTED]')
    .replace(JWT_REGEX, '[REDACTED_TOKEN]')
    .replace(KEY_VALUE_PASSWORD_REGEX, '$1$2[REDACTED]$4')
    .replace(EMAIL_REGEX, '[REDACTED_EMAIL]');
}

/**
 * Deeply redacts an arbitrary object, array, or primitive.
 */
export function redact(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return redactString(value);
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (value instanceof Error) {
    const errorObj: Record<string, unknown> = {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
    for (const [k, v] of Object.entries(value)) {
      if (k !== 'name' && k !== 'message' && k !== 'stack') {
        errorObj[k] = SENSITIVE_KEY_NAMES.has(k.toLowerCase()) ? '[REDACTED]' : redact(v);
      }
    }
    return errorObj;
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_NAMES.has(k.toLowerCase())) {
      result[k] = '[REDACTED]';
    } else {
      result[k] = redact(v);
    }
  }

  return result;
}
