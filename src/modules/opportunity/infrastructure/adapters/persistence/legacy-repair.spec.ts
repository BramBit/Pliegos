import { Pool } from 'pg';
import { requireTestDatabaseUrl } from '../../../../shared/testing/test-database-url';
import { migrateTestDatabase } from '../../../../shared/testing/migrate-test-database';
import { asOpportunityId } from '../../../../shared/domain/typed-id';
import { resyncUnknownOpportunities } from '../../../../../../scripts/resync-unknown';
import { RawSecopProcess } from '../secop/secop.adapter';

describe('Legacy Data Repair & Resync Unknown (P7.3)', () => {
  let pool: Pool;

  beforeAll(async () => {
    const testDbUrl = requireTestDatabaseUrl();
    pool = new Pool({ connectionString: testDbUrl });
    await migrateTestDatabase(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM opportunities;');
  });

  it('repairs legacy-shaped rows via SQL (UNSPECIFIED, V1 prefix, zero amount, placeholders)', async () => {
    // Insert legacy-shaped rows
    await pool.query(`
      INSERT INTO opportunities (
        id, title, description, contracting_entity_name, contracting_entity_tax_id,
        city, department, amount, amount_known, currency, contract_type,
        procurement_modality, is_competitive, category_code, published_at,
        is_open_for_submission, status, source_name, source_external_id,
        source_human_reference, source_original_url
      ) VALUES
      ('leg-1', 'Opp 1', 'Desc', 'Entidad', '123', 'Bogota', 'No Definido', 0, true, 'COP', 'Suministro', 'Mod', true, 'UNSPECIFIED', NOW(), true, 'Published', 'SECOP', 'EXT-1', 'REF-1', 'http://url'),
      ('leg-2', 'Opp 2', 'Desc', 'Entidad', '123', 'No Aplica', 'Antioquia', 500, true, 'COP', 'Suministro', 'Mod', true, 'V1.00000000', NOW(), true, 'Published', 'SECOP', 'EXT-2', 'REF-2', 'http://url'),
      ('leg-3', 'Opp 3', 'Desc', 'Entidad', '123', 'Cali', 'Valle', 1000, true, 'COP', 'Suministro', 'Mod', true, 'V1.80111600', NOW(), true, 'Published', 'SECOP', 'EXT-3', 'REF-3', 'http://url');
    `);

    // Run the repair SQL statements from migration 015
    await pool.query(`
      UPDATE opportunities
      SET category_code = NULL
      WHERE upper(coalesce(category_code, '')) = 'UNSPECIFIED'
         OR regexp_replace(coalesce(category_code, ''), '^V1\\.', '') ~ '^0+$';

      UPDATE opportunities
      SET category_code = regexp_replace(category_code, '^V1\\.', '')
      WHERE category_code LIKE 'V1.%';

      UPDATE opportunities
      SET amount_known = false
      WHERE amount = 0;

      UPDATE opportunities
      SET department = NULL
      WHERE department IN ('No Definido', 'No Aplica');

      UPDATE opportunities
      SET city = NULL
      WHERE city IN ('No Definido', 'No Aplica');
    `);

    const res1 = await pool.query('SELECT * FROM opportunities WHERE id = $1', ['leg-1']);
    expect(res1.rows[0].category_code).toBeNull();
    expect(res1.rows[0].department).toBeNull();
    expect(res1.rows[0].amount_known).toBe(false);

    const res2 = await pool.query('SELECT * FROM opportunities WHERE id = $1', ['leg-2']);
    expect(res2.rows[0].category_code).toBeNull();
    expect(res2.rows[0].city).toBeNull();
    expect(res2.rows[0].amount_known).toBe(true);

    const res3 = await pool.query('SELECT * FROM opportunities WHERE id = $1', ['leg-3']);
    expect(res3.rows[0].category_code).toBe('80111600');
  });

  it('resyncs Unknown status rows with a fake source and produces histogram', async () => {
    // Seed 2 unknown rows in DB
    await pool.query(`
      INSERT INTO opportunities (
        id, title, description, contracting_entity_name, contracting_entity_tax_id,
        city, department, amount, amount_known, currency, contract_type,
        procurement_modality, is_competitive, category_code, published_at,
        is_open_for_submission, status, source_name, source_external_id,
        source_human_reference, source_original_url
      ) VALUES
      ('unk-1', 'Opp 1', 'Desc', 'Entidad', '123', 'Bogota', 'Bogota', 100, true, 'COP', 'Suministro', 'Licitación', true, '80111600', NOW(), true, 'Unknown', 'SECOP', 'EXT-UNK-1', 'REF-UNK-1', 'http://url'),
      ('unk-2', 'Opp 2', 'Desc', 'Entidad', '123', 'Bogota', 'Bogota', 200, true, 'COP', 'Suministro', 'Licitación', true, '80111600', NOW(), true, 'Unknown', 'SECOP', 'EXT-UNK-2', 'REF-UNK-2', 'http://url');
    `);

    const fakeSourceRecords: RawSecopProcess[] = [
      {
        id_del_proceso: 'EXT-UNK-1',
        nombre_del_procedimiento: 'Proceso Resuelto',
        entidad: 'Entidad A',
        estado_del_procedimiento: 'Publicado',
        fecha_de_publicacion_del: new Date().toISOString(),
      },
      {
        id_del_proceso: 'EXT-UNK-2',
        nombre_del_procedimiento: 'Proceso Raro',
        entidad: 'Entidad B',
        estado_del_procedimiento: 'EstadoInusualX',
        fecha_de_publicacion_del: new Date().toISOString(),
      },
    ];

    const fakeAdapter = {
      fetchRawByIds: jest.fn().mockResolvedValue(fakeSourceRecords),
      mapToOpportunity: (raw: RawSecopProcess) => {
        const isPublished = raw.estado_del_procedimiento === 'Publicado';
        return {
          ok: true,
          value: {
            id: asOpportunityId(raw.id_del_proceso === 'EXT-UNK-1' ? 'unk-1' : 'unk-2'),
            title: raw.nombre_del_procedimiento,
            description: '',
            contractingEntity: { name: raw.entidad, taxId: '123' },
            location: { city: 'Bogotá', department: 'Bogotá D.C.' },
            amount: { amount: 100, currency: 'COP' as const },
            amountKnown: true,
            contractType: 'Suministro',
            procurementModality: 'Licitación',
            isCompetitive: true,
            categoryCode: '80111600',
            publishedAt: new Date(),
            lastPublishedAt: new Date(),
            closingDate: null,
            isOpenForSubmission: isPublished,
            status: isPublished ? ('Published' as const) : ('Unknown' as const),
            sourceStatus: raw.estado_del_procedimiento,
            source: {
              sourceName: 'SECOP' as const,
              externalId: raw.id_del_proceso,
              humanReference: raw.id_del_proceso,
              originalUrl: 'http://url',
            },
            analysis: null,
            changeHistory: [],
          },
        };
      },
    };

    const resyncResult = await resyncUnknownOpportunities(pool, fakeAdapter, 100);

    expect(resyncResult.totalProcessed).toBe(2);
    expect(resyncResult.updated).toBe(1);
    expect(resyncResult.stillUnknown).toBe(1);
    expect(resyncResult.histogram).toEqual({ EstadoInusualX: 1 });

    const check1 = await pool.query('SELECT status, source_status FROM opportunities WHERE id = $1', ['unk-1']);
    expect(check1.rows[0].status).toBe('Published');
    expect(check1.rows[0].source_status).toBe('Publicado');

    const check2 = await pool.query('SELECT status, source_status FROM opportunities WHERE id = $1', ['unk-2']);
    expect(check2.rows[0].status).toBe('Unknown');
    expect(check2.rows[0].source_status).toBe('EstadoInusualX');
  });
});
