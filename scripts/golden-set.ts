/**
 * Golden set de calidad del scoring.
 *
 * Toma procesos REALES accionables de la BD, los puntúa contra perfiles fijos con el
 * MatchingService real (Ollama) y escribe un reporte Markdown con el top N y el fondo,
 * para que una persona juzgue si el ranking tiene sentido.
 *
 * Uso: pnpm build && node dist/scripts/golden-set.js [topN]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { Pool } from 'pg';
import { PostgresOpportunityRepository } from '../src/modules/opportunity/infrastructure/adapters/persistence/postgres-opportunity.repository';
import { OllamaAdapter } from '../src/modules/recommendation/infrastructure/adapters/ollama/ollama.adapter';
import { MatchingService } from '../src/modules/recommendation/domain/services/matching.service';
import { Profile } from '../src/modules/profile/domain/entities/profile.entity';
import { asProfileId, asUserId } from '../src/modules/shared/domain/typed-id';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/pliegos';
const TOP_N = Number(process.argv[2]) || 30;
const BOTTOM_N = 5;
const CANDIDATES = Number(process.env.GOLDEN_CANDIDATES) || 5000;

const PROFILES: Profile[] = [
  {
    id: asProfileId('golden-tech'),
    ownerId: asUserId('golden'),
    sector: 'Tecnologías de la Información y Desarrollo de Software',
    capabilities: [
      { name: 'Desarrollo de software a la medida y plataformas web', yearsOfExperience: 7 },
      { name: 'Ciberseguridad y auditoría de sistemas', yearsOfExperience: 5 },
      { name: 'Infraestructura tecnológica y soporte de TI', yearsOfExperience: 6 },
    ],
    preferences: {
      categoryCodes: ['V1.81111500', 'V1.80111600', 'V1.43230000'],
      keywords: ['software', 'sistemas de información', 'ciberseguridad', 'tecnología', 'datos'],
      amountRange: { min: 50_000_000, max: 500_000_000 },
      departments: ['Distrito Capital de Bogotá', 'Cundinamarca', 'Antioquia'],
    },
  },
  {
    id: asProfileId('golden-infra'),
    ownerId: asUserId('golden'),
    sector: 'Infraestructura, Construcción y Obras Civiles',
    capabilities: [
      { name: 'Interventoría técnica de obras', yearsOfExperience: 10 },
      { name: 'Construcción y mantenimiento de vías', yearsOfExperience: 8 },
      { name: 'Estudios de suelos y topografía', yearsOfExperience: 6 },
    ],
    preferences: {
      categoryCodes: ['V1.72141000', 'V1.81101500', 'V1.72121100'],
      keywords: ['interventoría', 'mantenimiento vial', 'pavimentación', 'obras civiles', 'puentes'],
      amountRange: { min: 150_000_000, max: 1_500_000_000 },
      departments: ['Santander', 'Boyacá', 'Cundinamarca', 'Tolima'],
    },
  },
];

const cop = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const repo = new PostgresOpportunityRepository(pool);
    const ai = new OllamaAdapter({
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      embedModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
      chatModel: process.env.OLLAMA_CHAT_MODEL || 'llama3.1',
    });
    const matching = new MatchingService();

    // Only processes that are actionable AND already embedded: semantic similarity is then
    // a single SQL cosine query per profile (no per-pair LLM calls).
    const { rows } = await pool.query<{ id: string }>(
      `SELECT o.id FROM opportunities o
       JOIN opportunity_embeddings e ON e.opportunity_id = o.id
       WHERE o.status IN ('Published','Amended') AND (o.closing_date IS NULL OR o.closing_date >= NOW())
       LIMIT $1`,
      [CANDIDATES],
    );
    const found = await Promise.all(rows.map((r) => repo.findById(r.id as never)));
    const candidates = found.filter((o): o is NonNullable<typeof o> => o !== null);
    console.log(`Candidatos accionables con embedding: ${candidates.length}`);

    const lines: string[] = [
      '# Golden set — calidad del scoring',
      '',
      `Generado: ${new Date().toISOString()} · Candidatos accionables evaluados: ${candidates.length}`,
      '',
      'Marca en cada fila si el ranking tiene sentido: ✅ buena recomendación · ❌ no debería estar · ➖ dudosa.',
      '',
    ];

    for (const profile of PROFILES) {
      console.log(`\nPuntuando perfil ${profile.id}...`);
      const t0 = Date.now();
      const [profileVec] = await ai.embed([MatchingService.buildProfileText(profile)]);
      const sims = await pool.query<{ id: string; cos: number }>(
        `SELECT opportunity_id AS id, 1 - (embedding <=> $1::vector) AS cos
         FROM opportunity_embeddings WHERE opportunity_id = ANY($2)`,
        [`[${profileVec.join(',')}]`, candidates.map((c) => c.id)],
      );
      const cosById = new Map(sims.rows.map((r) => [r.id, Number(r.cos)]));
      const scored: { opp: (typeof candidates)[number]; b: Awaited<ReturnType<typeof matching.computeBreakdown>> }[] = [];
      for (const opp of candidates) {
        const semantic = MatchingService.normalizeCosine(cosById.get(opp.id) ?? 0);
        const b = await matching.computeBreakdown(opp, profile, semantic);
        scored.push({ opp, b });
      }
      scored.sort((a, b) => b.b.combinedScore - a.b.combinedScore);
      console.log(`  ${scored.length} procesos en ${((Date.now() - t0) / 1000).toFixed(1)}s`);

      const dist = [0.8, 0.6, 0.4].map(
        (t) => `≥${t}: ${scored.filter((s) => s.b.combinedScore >= t).length}`,
      );

      lines.push(
        `## Perfil: ${profile.sector}`,
        '',
        `Capacidades: ${profile.capabilities.map((c) => c.name).join('; ')}  `,
        `Rango: ${cop(profile.preferences.amountRange!.min)} – ${cop(profile.preferences.amountRange!.max)} · Deptos: ${profile.preferences.departments.join(', ')}  `,
        `Distribución de scores: ${dist.join(' · ')}`,
        '',
        `### Top ${TOP_N}`,
        '',
        '| # | Score | Sem | Cat | Monto | Ubic | Título | Entidad | Depto | Valor | UNSPSC | Juicio |',
        '|---|---|---|---|---|---|---|---|---|---|---|---|',
      );

      const row = (i: number, s: (typeof scored)[number]) =>
        `| ${i} | ${s.b.combinedScore.toFixed(2)} | ${pct(s.b.semanticSimilarity)} | ${pct(s.b.categoryMatch)} | ${pct(s.b.amountFit)} | ${pct(s.b.locationMatch)} | ${s.opp.title.replace(/\|/g, '/').slice(0, 90)} | ${s.opp.contractingEntity.name.slice(0, 40)} | ${s.opp.location.department ?? '-'} | ${cop(s.opp.amount.amount)} | ${s.opp.categoryCode} |  |`;

      scored.slice(0, TOP_N).forEach((s, i) => lines.push(row(i + 1, s)));

      lines.push('', `### Fondo (${BOTTOM_N} peores, control negativo)`, '');
      lines.push(
        '| # | Score | Sem | Cat | Monto | Ubic | Título | Entidad | Depto | Valor | UNSPSC | Juicio |',
        '|---|---|---|---|---|---|---|---|---|---|---|---|',
      );
      scored
        .slice(-BOTTOM_N)
        .forEach((s, i) => lines.push(row(scored.length - BOTTOM_N + i + 1, s)));
      lines.push('');
    }

    mkdirSync('docs/golden-set', { recursive: true });
    const out = 'docs/golden-set/report.md';
    writeFileSync(out, lines.join('\n'));
    console.log(`\nReporte escrito en ${out}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
