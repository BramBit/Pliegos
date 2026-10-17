import { isCompetitive, normalizeUnspsc, nullIfPlaceholder, parseAmount } from './normalizers';

describe('nullIfPlaceholder', () => {
  it.each([undefined, null, '', '   '])('returns null for %p', (input) => {
    expect(nullIfPlaceholder(input)).toBeNull();
  });

  it.each(['No Definido', 'No definido', 'No Aplica', 'No aplica', 'NO DEFINIDO'])(
    'returns null for the placeholder %p',
    (input) => {
      expect(nullIfPlaceholder(input)).toBeNull();
    },
  );

  it('ignores surrounding whitespace on placeholders', () => {
    expect(nullIfPlaceholder('  No Aplica  ')).toBeNull();
  });

  it('trims and returns real values unchanged otherwise', () => {
    expect(nullIfPlaceholder('  Bogotá D.C.  ')).toBe('Bogotá D.C.');
    expect(nullIfPlaceholder('Antioquia')).toBe('Antioquia');
  });

  it('does not treat text that merely contains a placeholder as one', () => {
    expect(nullIfPlaceholder('No Definido en pliegos')).toBe('No Definido en pliegos');
  });
});

describe('normalizeUnspsc', () => {
  it('strips the V1. prefix', () => {
    expect(normalizeUnspsc('V1.80111600')).toBe('80111600');
  });

  it('returns codes without a prefix unchanged and trims whitespace', () => {
    expect(normalizeUnspsc('80111600')).toBe('80111600');
    expect(normalizeUnspsc('  V1.80111600 ')).toBe('80111600');
  });

  it.each([undefined, null, '', '   '])('returns null for %p', (input) => {
    expect(normalizeUnspsc(input)).toBeNull();
  });

  it.each(['UNSPECIFIED', 'unspecified', '  UNSPECIFIED  '])('returns null for %p', (input) => {
    expect(normalizeUnspsc(input)).toBeNull();
  });

  it.each(['00000000', 'V1.00000000', '0'])('returns null for the all-zero code %p', (input) => {
    expect(normalizeUnspsc(input)).toBeNull();
  });

  it('keeps codes that only contain some zeros', () => {
    expect(normalizeUnspsc('V1.80101600')).toBe('80101600');
  });
});

describe('isCompetitive', () => {
  it('is false for direct contracting', () => {
    expect(isCompetitive('Contratación directa')).toBe(false);
  });

  it('is false for direct contracting with offers (starts with the same words)', () => {
    expect(isCompetitive('Contratación Directa (con ofertas)')).toBe(false);
  });

  it('ignores accents, casing and whitespace', () => {
    expect(isCompetitive('  CONTRATACION DIRECTA  ')).toBe(false);
    expect(isCompetitive('contratación directa')).toBe(false);
  });

  it('is false for the special regime without offers', () => {
    expect(isCompetitive('Contratación régimen especial')).toBe(false);
    expect(isCompetitive('contratacion regimen especial')).toBe(false);
  });

  it('is true for the special regime with offers', () => {
    expect(isCompetitive('Contratación régimen especial (con ofertas)')).toBe(true);
  });

  it.each([
    'Licitación pública',
    'Mínima cuantía',
    'Selección Abreviada de Menor Cuantía',
    'Concurso de méritos abierto',
    'Solicitud de información a los Proveedores',
  ])('is true for the competitive modality %p', (modality) => {
    expect(isCompetitive(modality)).toBe(true);
  });

  it('is true when the modality is absent', () => {
    expect(isCompetitive(undefined)).toBe(true);
    expect(isCompetitive(null)).toBe(true);
  });
});

describe('parseAmount', () => {
  it('parses numeric strings', () => {
    expect(parseAmount('150000000')).toBe(150000000);
    expect(parseAmount('623560.5')).toBe(623560.5);
  });

  it('keeps zero as a real amount', () => {
    expect(parseAmount('0')).toBe(0);
    expect(parseAmount(0)).toBe(0);
  });

  it('passes through finite numbers', () => {
    expect(parseAmount(2500)).toBe(2500);
  });

  it('trims whitespace before parsing', () => {
    expect(parseAmount('  42  ')).toBe(42);
  });

  it.each([undefined, null, '', '   '])('returns null for the absent value %p', (input) => {
    expect(parseAmount(input)).toBeNull();
  });

  it.each(['abc', '12abc', 'No Definido', 'NaN', 'Infinity'])(
    'returns null for the non-numeric value %p',
    (input) => {
      expect(parseAmount(input)).toBeNull();
    },
  );

  it('returns null for non-finite numbers', () => {
    expect(parseAmount(Number.NaN)).toBeNull();
    expect(parseAmount(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
