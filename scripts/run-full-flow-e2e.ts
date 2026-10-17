import { Pool } from 'pg';
import * as path from 'node:path';
import { runMigrations } from '../src/modules/shared/infrastructure/persistence/migrator';
import { SecopAdapter } from '../src/modules/opportunity/infrastructure/adapters/secop/secop.adapter';
import { OllamaAdapter } from '../src/modules/recommendation/infrastructure/adapters/ollama/ollama.adapter';
import { PgVectorAdapter } from '../src/modules/opportunity/infrastructure/adapters/search/pgvector.adapter';
import { EmailAdapter } from '../src/modules/alert/infrastructure/adapters/email/email.adapter';
import { PostgresOpportunityRepository } from '../src/modules/opportunity/infrastructure/adapters/persistence/postgres-opportunity.repository';
import { PostgresProfileRepository } from '../src/modules/profile/infrastructure/adapters/persistence/postgres-profile.repository';
import { PostgresRecommendationRepository } from '../src/modules/recommendation/infrastructure/adapters/persistence/postgres-recommendation.repository';
import { PostgresAlertRepository } from '../src/modules/alert/infrastructure/adapters/persistence/postgres-alert.repository';

import { SyncOpportunitiesUseCase } from '../src/modules/opportunity/application/use-cases/sync-opportunities.use-case';
import { ConfigureProfileUseCase } from '../src/modules/profile/application/use-cases/configure-profile.use-case';
import { GetRecommendationsUseCase } from '../src/modules/recommendation/application/use-cases/get-recommendations.use-case';
import { RegisterFeedbackUseCase } from '../src/modules/recommendation/application/use-cases/register-feedback.use-case';
import { ReviewFollowUpUseCase } from '../src/modules/alert/application/use-cases/review-follow-up.use-case';
import { MatchingService } from '../src/modules/recommendation/domain/services/matching.service';

import { asUserId, asProfileId, asOpportunityId, asAlertId } from '../src/modules/shared/domain/typed-id';
import { withOpportunityAnalysis } from '../src/modules/opportunity/domain/entities/opportunity.entity';

const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.TEST_DATABASE_URL ||
  'postgres://postgres:postgres@localhost:5433/pliegos_test';

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║       Pliegos — Flujo Completo End-to-End (Fase 1 MVP)           ║');
  console.log('║  Sync → Analyze → Recommend (Explicado) → Feedback → Alert       ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    console.log('0. [INFRA] Conectando a PostgreSQL e inicializando esquema...');
    await runMigrations(pool, path.resolve(__dirname, '../../migrations'));
    console.log('   ✓ Extension pgvector y tablas de base de datos verificadas.\n');

    // Inicializar Adaptadores
    const secopAdapter = new SecopAdapter();
    const ollamaAdapter = new OllamaAdapter({
      baseUrl: 'http://localhost:11434',
      embedModel: 'nomic-embed-text',
      chatModel: 'llama3.1',
    });
    const pgvectorAdapter = new PgVectorAdapter({ pool, aiProvider: ollamaAdapter });
    const emailAdapter = new EmailAdapter();

    const opportunityRepo = new PostgresOpportunityRepository(pool);
    const profileRepo = new PostgresProfileRepository(pool);
    const recommendationRepo = new PostgresRecommendationRepository(pool);
    const alertRepo = new PostgresAlertRepository(pool);

    // ─────────────────────────────────────────────────────────────
    // PASO 1: SYNC OPPORTUNITIES
    // ─────────────────────────────────────────────────────────────
    console.log('─────────────────────────────────────────────────────────────────');
    console.log('PASO 1: Sincronizacion de Procesos desde SECOP II (Sync)');
    console.log('─────────────────────────────────────────────────────────────────');
    const syncUseCase = new SyncOpportunitiesUseCase(secopAdapter, opportunityRepo);
    const syncResult = await syncUseCase.execute({});

    if (!syncResult.ok) {
      throw new Error(`Sync fallo: ${syncResult.error.sourceName}`);
    }
    console.log(`✓ Sincronizacion completada:`);
    console.log(`  - Nuevas oportunidades creadas: ${syncResult.value.created}`);
    console.log(`  - Oportunidades actualizadas: ${syncResult.value.updated}`);

    const allOpportunities = await opportunityRepo.findByFilters({});
    console.log(`  - Total oportunidades almacenadas en Postgres: ${allOpportunities.length}\n`);

    if (allOpportunities.length === 0) {
      throw new Error('No se encontraron oportunidades en la base de datos tras la sincronizacion.');
    }

    const sampleOpp = allOpportunities[0];
    console.log(`  Detalle de oportunidad de muestra:`);
    console.log(`  * ID: ${sampleOpp.id}`);
    console.log(`  * Titulo: "${sampleOpp.title}"`);
    console.log(`  * Entidad: ${sampleOpp.contractingEntity.name} (NIT: ${sampleOpp.contractingEntity.taxId})`);
    console.log(`  * Monto: $${sampleOpp.amount.amount.toLocaleString()} COP`);
    console.log(`  * UNSPSC: ${sampleOpp.categoryCode}`);
    console.log(`  * Modalidad: ${sampleOpp.procurementModality}\n`);

    // ─────────────────────────────────────────────────────────────
    // PASO 2: ANALYZE & INDEX OPPORTUNITIES
    // ─────────────────────────────────────────────────────────────
    console.log('─────────────────────────────────────────────────────────────────');
    console.log('PASO 2: Analisis con IA e Indexacion Vectorial (Analyze & Embed)');
    console.log('─────────────────────────────────────────────────────────────────');
    console.log('Generando resumen en espanol con llama3.1 y embedding de 768 dims con nomic-embed-text...');

    const summary = await ollamaAdapter.summarize(
      `${sampleOpp.title}. Entidad: ${sampleOpp.contractingEntity.name}. Monto: ${sampleOpp.amount.amount} COP. Modalidad: ${sampleOpp.procurementModality}.`,
    );

    const analyzedOpp = withOpportunityAnalysis(sampleOpp, {
      summary: summary || 'Analisis tecnico y administrativo del proceso contractual.',
      requirements: [
        { text: 'Capacidad residual financiera acorde al monto', type: 'financial' },
        { text: 'Experiencia acreditada en contratos similares', type: 'technical' },
      ],
      embeddingGeneratedAt: new Date(),
    });

    await opportunityRepo.save(analyzedOpp);
    await pgvectorAdapter.indexOpportunity(analyzedOpp);
    console.log('✓ Oportunidad analizada y almacenada en Postgres con embedding vectorial pgvector(768).');
    console.log(`  Resumen analitico: "${analyzedOpp.analysis?.summary}"\n`);

    // ─────────────────────────────────────────────────────────────
    // PASO 3: CONFIGURE USER PROFILE
    // ─────────────────────────────────────────────────────────────
    console.log('─────────────────────────────────────────────────────────────────');
    console.log('PASO 3: Configuracion de Perfil de Contratista (Profile)');
    console.log('─────────────────────────────────────────────────────────────────');
    const profileUseCase = new ConfigureProfileUseCase(profileRepo);
    const profileResult = await profileUseCase.execute({
      profileId: null,
      data: {
        ownerId: asUserId('user-brayan-01'),
        sector: 'Tecnologia, Consultoria y Servicios Profesionales',
        capabilities: [
          { name: 'Desarrollo e integracion de sistemas', yearsOfExperience: 6 },
          { name: 'Gestion y consultoria administrativa', yearsOfExperience: 4 },
        ],
        preferences: {
          categoryCodes: [
            ...(sampleOpp.categoryCode ? [sampleOpp.categoryCode] : []),
            'V1.80111600',
            'V1.43230000',
          ],
          keywords: [sampleOpp.title.split(' ')[0], 'servicios', 'gestion', 'tecnologia'],
          amountRange: { min: 5_000_000, max: 200_000_000 },
          departments: sampleOpp.location.department ? [sampleOpp.location.department] : [],
        },
      },
    });

    if (!profileResult.ok) {
      throw new Error('Fallo la configuracion del perfil');
    }
    const profile = profileResult.value;
    console.log(`✓ Perfil de contratista creado con ID: ${profile.id}`);
    console.log(`  - Sector: ${profile.sector}`);
    console.log(`  - Categorias de interes: ${profile.preferences.categoryCodes.join(', ')}`);
    console.log(`  - Rango presupuestal: $${profile.preferences.amountRange?.min.toLocaleString()} - $${profile.preferences.amountRange?.max.toLocaleString()} COP\n`);

    // ─────────────────────────────────────────────────────────────
    // PASO 4: GET RECOMMENDATIONS (MATCHING SERVICE)
    // ─────────────────────────────────────────────────────────────
    console.log('─────────────────────────────────────────────────────────────────');
    console.log('PASO 4: Motor de Recomendacion Explicada (MatchingService)');
    console.log('─────────────────────────────────────────────────────────────────');
    const matchingService = new MatchingService(ollamaAdapter);
    const getRecommendationsUseCase = new GetRecommendationsUseCase(
      profileRepo,
      opportunityRepo,
      recommendationRepo,
      matchingService,
    );

    console.log('Calculando score ponderado (0.35 semantica + 0.35 categoria + 0.20 monto + 0.10 ubicacion)...');
    const recsResult = await getRecommendationsUseCase.execute({ profileId: profile.id });

    if (!recsResult.ok) {
      throw new Error('Fallo la generacion de recomendaciones');
    }

    const recommendations = recsResult.value;
    console.log(`✓ Se generaron ${recommendations.length} recomendaciones rankeadas.\n`);

    const topRec = recommendations[0];
    console.log(`🏆 Mejor Oportunidad Recomendada:`);
    console.log(`   - Recommendation ID: ${topRec.id}`);
    console.log(`   - Opportunity ID: ${topRec.opportunityId}`);
    console.log(`   - Score final: ${(topRec.score * 100).toFixed(1)}% (${topRec.score.toFixed(4)})`);
    console.log(`   - Explicacion: "${topRec.explanation.summary}"`);
    console.log(`   - Factores coincidentes (>0.6):`);
    for (const factor of topRec.explanation.matchedFactors) {
      console.log(`     * [${factor.factor}] ${(factor.score * 100).toFixed(0)}% -> ${factor.description}`);
    }
    console.log('');

    // ─────────────────────────────────────────────────────────────
    // PASO 5: REGISTER FEEDBACK
    // ─────────────────────────────────────────────────────────────
    console.log('─────────────────────────────────────────────────────────────────');
    console.log('PASO 5: Decision del Usuario y Feedback (RegisterFeedback)');
    console.log('─────────────────────────────────────────────────────────────────');
    const feedbackUseCase = new RegisterFeedbackUseCase(recommendationRepo);
    const feedbackResult = await feedbackUseCase.execute({
      recommendationId: topRec.id,
      decision: 'Participate',
    });

    if (!feedbackResult.ok) {
      throw new Error('Fallo el registro de feedback');
    }

    const updatedRec = await recommendationRepo.findById(topRec.id);
    console.log(`✓ Feedback registrado con exito.`);
    console.log(`  - Decision del usuario: ${updatedRec?.feedback?.decision}`);
    console.log(`  - Fecha de decision: ${updatedRec?.feedback?.recordedAt?.toISOString()}\n`);

    // ─────────────────────────────────────────────────────────────
    // PASO 6: REVIEW FOLLOW-UP & ALERTS
    // ─────────────────────────────────────────────────────────────
    console.log('─────────────────────────────────────────────────────────────────');
    console.log('PASO 6: Seguimiento de Alertas y Notificaciones (ReviewFollowUp)');
    console.log('─────────────────────────────────────────────────────────────────');
    // Generar alerta de seguimiento para la oportunidad
    const alertId = asAlertId('alert-e2e-001');
    await alertRepo.save({
      id: alertId,
      profileId: profile.id,
      opportunityId: sampleOpp.id,
      trigger: 'DeadlineApproaching',
      deliveredAt: null,
    });
    console.log(`✓ Alerta creada por proximo cierre de plazo para ${profile.id}.`);

    const reviewFollowUpUseCase = new ReviewFollowUpUseCase(alertRepo, emailAdapter);
    const alertResult = await reviewFollowUpUseCase.execute();

    console.log(`✓ Revision de seguimiento ejecutada.`);
    const alertsSent = alertResult.ok ? alertResult.value.alertsSent : 0;
    console.log(`  - Alertas enviadas: ${alertsSent}`);

    const sentEmails = emailAdapter.getSentNotifications();
    console.log(`  - Notificaciones por correo despachadas: ${sentEmails.length}`);
    for (const email of sentEmails) {
      console.log(`    ✉ [EMAIL to ${email.profileId}]: "${email.message}"`);
    }

    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║  ✓ FLUJO END-TO-END COMPLETADO EXITOSAMENTE SIN ERRORES          ║');
    console.log('║  Pliegos opera con PostgreSQL nativo, pgvector y Ollama local    ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('\n✗ Error en el flujo end-to-end:', err);
  process.exit(1);
});
