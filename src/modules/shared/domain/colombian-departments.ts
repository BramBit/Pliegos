export const CANONICAL_COLOMBIAN_DEPARTMENTS = [
  'Amazonas',
  'Antioquia',
  'Arauca',
  'Atlántico',
  'Bogotá D.C.',
  'Bolívar',
  'Boyacá',
  'Caldas',
  'Caquetá',
  'Casanare',
  'Cauca',
  'Cesar',
  'Chocó',
  'Córdoba',
  'Cundinamarca',
  'Guainía',
  'Guaviare',
  'Huila',
  'La Guajira',
  'Magdalena',
  'Meta',
  'Nariño',
  'Norte de Santander',
  'Putumayo',
  'Quindío',
  'Risaralda',
  'San Andrés y Providencia',
  'Santander',
  'Sucre',
  'Tolima',
  'Valle del Cauca',
  'Vaupés',
  'Vichada',
] as const;

export type CanonicalDepartment =
  (typeof CANONICAL_COLOMBIAN_DEPARTMENTS)[number];

const normalizeForMatching = (str: string): string =>
  str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const CANONICAL_MAP = new Map<string, CanonicalDepartment>();

for (const dept of CANONICAL_COLOMBIAN_DEPARTMENTS) {
  CANONICAL_MAP.set(normalizeForMatching(dept), dept);
}

// Common aliases in procurement datasets and user input
CANONICAL_MAP.set('bogota', 'Bogotá D.C.');
CANONICAL_MAP.set('bogota dc', 'Bogotá D.C.');
CANONICAL_MAP.set('bogota d c', 'Bogotá D.C.');
CANONICAL_MAP.set('distrito capital', 'Bogotá D.C.');
CANONICAL_MAP.set('distrito capital de bogota', 'Bogotá D.C.');
CANONICAL_MAP.set('santa fe de bogota', 'Bogotá D.C.');

CANONICAL_MAP.set('guajira', 'La Guajira');
CANONICAL_MAP.set('valle', 'Valle del Cauca');
CANONICAL_MAP.set('san andres', 'San Andrés y Providencia');
CANONICAL_MAP.set(
  'archipielago de san andres providencia y santa catalina',
  'San Andrés y Providencia',
);
CANONICAL_MAP.set(
  'san andres providencia y santa catalina',
  'San Andrés y Providencia',
);
CANONICAL_MAP.set('san andres y providencia', 'San Andrés y Providencia');
CANONICAL_MAP.set('norte santander', 'Norte de Santander');

export function canonicalizeDepartment(
  input: string,
): CanonicalDepartment | null {
  if (!input || typeof input !== 'string') return null;
  const key = normalizeForMatching(input);
  return CANONICAL_MAP.get(key) ?? null;
}

export function getDepartmentSearchTerms(input: string): string[] {
  if (!input || typeof input !== 'string') return [];
  const canonical = canonicalizeDepartment(input);
  const terms = new Set<string>();
  terms.add(input.trim().toLowerCase());
  terms.add(normalizeForMatching(input));
  if (canonical) {
    terms.add(canonical.toLowerCase());
    terms.add(normalizeForMatching(canonical));
    for (const [alias, mapped] of CANONICAL_MAP.entries()) {
      if (mapped === canonical) {
        terms.add(alias);
        terms.add(mapped.toLowerCase());
      }
    }
  }
  return Array.from(terms);
}
