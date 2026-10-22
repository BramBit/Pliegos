/**
 * Pure normalization functions for raw SECOP values. They have no side effects
 * and are not wired anywhere yet: SecopAdapter will be the only caller.
 */

const PLACEHOLDERS = new Set(['', 'no definido', 'no aplica']);

/** Lower-cases and strips accents so comparisons ignore both. */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Returns null for undefined, null, blank text and SECOP placeholders
 * ('No Definido', 'No Aplica', any casing). Otherwise returns the trimmed value.
 */
export function nullIfPlaceholder(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return PLACEHOLDERS.has(trimmed.toLowerCase()) ? null : trimmed;
}

export { normalizeUnspsc } from '../../../domain/value-objects/opportunity.value-objects';

/**
 * Whether a procurement modality is open to competing offers. Anything that
 * starts with 'Contratación directa' is not (including its '(con ofertas)'
 * variant), and neither is 'Contratación régimen especial' without offers.
 * Every other modality, including 'Contratación régimen especial (con ofertas)',
 * is competitive. Comparison ignores accents, casing and surrounding whitespace.
 */
export function isCompetitive(modality: string | null | undefined): boolean {
  if (modality === undefined || modality === null) return true;
  const folded = fold(modality);
  if (folded.startsWith('contratacion directa')) return false;
  if (folded === 'contratacion regimen especial') return false;
  return true;
}

/**
 * Parses a raw amount (number or numeric string). Returns null when the value
 * is absent, empty or not a finite number.
 */
export function parseAmount(
  value: string | number | null | undefined,
): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
