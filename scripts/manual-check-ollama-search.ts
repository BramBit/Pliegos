import { SecopAdapter } from '../src/modules/opportunity/infrastructure/adapters/secop/secop.adapter';
import { OllamaAdapter } from '../src/modules/recommendation/infrastructure/adapters/ollama/ollama.adapter';
import * as path from 'node:path';
import * as fs from 'node:fs';

async function main() {
  console.log('=====================================================');
  console.log('  Pliegos — Manual End-to-End Check con Ollama Local');
  console.log('=====================================================\n');

  const ollama = new OllamaAdapter({
    baseUrl: 'http://localhost:11434',
    embedModel: 'nomic-embed-text',
    chatModel: 'llama3.1',
  });

  const secop = new SecopAdapter();

  console.log('1. [SECOP] Obteniendo oportunidad...');
  let sourceOpp;
  try {
    const list = await secop.fetchLatest();
    sourceOpp = list[0];
    console.log(`   ✓ Obtenido desde API en vivo: ID ${sourceOpp.externalId}`);
  } catch (err) {
    console.log(`   ℹ Fallback a fixture local (red no disponible): ${(err as Error).message}`);
    const fixturePath = path.join(
      __dirname,
      '../src/modules/opportunity/infrastructure/adapters/secop/fixtures/secop-sample.fixture.json',
    );
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    sourceOpp = secop.mapToSourceOpportunity(fixture[0]);
    if (!sourceOpp) {
      console.error('   ✗ Error mapeando oportunidad desde fixture');
      process.exit(1);
    }
  }

  const opp = {
    title: sourceOpp.title,
    contractingEntity: { name: sourceOpp.entityName, taxId: sourceOpp.entityTaxId },
    location: { city: sourceOpp.city, department: sourceOpp.department },
    amount: { amount: sourceOpp.amount ?? 0, currency: 'COP' as const },
    procurementModality: sourceOpp.procurementModality,
    categoryCode: sourceOpp.categoryCode,
    status: sourceOpp.status,
    source: { originalUrl: sourceOpp.originalUrl },
  };
  console.log(`   ✓ Mapeado a Opportunity: "${opp.title}"`);
  console.log(`     - Entidad: ${opp.contractingEntity.name} (NIT: ${opp.contractingEntity.taxId})`);
  console.log(`     - Monto: $${opp.amount.amount.toLocaleString()} ${opp.amount.currency}`);
  console.log(`     - Modalidad: ${opp.procurementModality}`);
  console.log(`     - Categoria UNSPSC: ${opp.categoryCode}`);
  console.log(`     - Estado: ${opp.status}`);
  console.log(`     - URL proceso: ${opp.source.originalUrl}\n`);

  console.log('2. [OLLAMA - nomic-embed-text] Generando embedding vectorial...');
  const textToIndex = `${opp.title}. Entidad: ${opp.contractingEntity.name}. Categoria: ${opp.categoryCode}. Modalidad: ${opp.procurementModality}.`;
  const [embedding] = await ollama.embed([textToIndex]);
  console.log(`   ✓ Embedding generado con exito.`);
  console.log(`     - Longitud del vector: ${embedding.length} dimensiones (esperado: 768)`);
  console.log(`     - Primeras 5 componentes: [${embedding.slice(0, 5).map((n) => n.toFixed(5)).join(', ')}, ...]`);
  console.log(`     - Norma euclidiana: ${Math.sqrt(embedding.reduce((acc, v) => acc + v * v, 0)).toFixed(4)}\n`);

  console.log('3. [OLLAMA - llama3.1] Generando resumen analitico del proceso...');
  const summary = await ollama.summarize(
    `${opp.title}. Contratado por ${opp.contractingEntity.name} en ${opp.location.city ?? opp.location.department}. Modalidad: ${opp.procurementModality}. Valor estimado: ${opp.amount.amount} COP.`,
  );
  console.log(`   ✓ Resumen generado por llama3.1:\n     "${summary}"\n`);

  console.log('4. [SEMANTIC SEARCH] Simulacion de busqueda por distancia coseno (<=> en pgvector)...');
  const userProfileQuery = 'Suministro e instalacion de bombas hidraulicas y maquinaria electromecanica';
  const [queryEmbedding] = await ollama.embed([userProfileQuery]);

  let dotProduct = 0;
  let normQuery = 0;
  let normOpp = 0;
  for (let i = 0; i < embedding.length; i++) {
    dotProduct += queryEmbedding[i] * embedding[i];
    normQuery += queryEmbedding[i] * queryEmbedding[i];
    normOpp += embedding[i] * embedding[i];
  }
  const cosineSim = dotProduct / (Math.sqrt(normQuery) * Math.sqrt(normOpp));
  const cosineDistance = 1 - cosineSim;

  console.log(`   - Distancia coseno (embedding <=> queryVector): ${cosineDistance.toFixed(4)} (0.0 = identico)`);
  console.log(`   - Similitud coseno: ${(cosineSim * 100).toFixed(1)}%`);
  console.log('\n=====================================================');
  console.log('  ✓ Verificacion completada exitosamente con Ollama local');
  console.log('=====================================================');
}

main().catch((err) => {
  console.error('Error durante la verificacion:', err);
  process.exit(1);
});
