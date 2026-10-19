import { Pool } from 'pg';
import { requireTestDatabaseUrl } from '../../../../shared/testing/test-database-url';
import { migrateTestDatabase } from '../../../../shared/testing/migrate-test-database';
import { seedProfile, seedOpportunity } from '../../../../shared/testing/seed';
import { PostgresWatchRepository } from './postgres-watch.repository';
import { PostgresRecommendationRepository } from './postgres-recommendation.repository';
import { asProfileId, asOpportunityId, asRecommendationId } from '../../../../shared/domain/typed-id';

const TEST_DATABASE_URL = requireTestDatabaseUrl();

describe('PostgresWatchRepository & Summary (Real Test Database)', () => {
  let pool: Pool;
  let watchRepo: PostgresWatchRepository;
  let recRepo: PostgresRecommendationRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await migrateTestDatabase(pool);
    watchRepo = new PostgresWatchRepository(pool);
    recRepo = new PostgresRecommendationRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM watches;');
    await pool.query('DELETE FROM recommendations;');
    await pool.query('DELETE FROM recommendation_runs;');
    await pool.query('DELETE FROM opportunities;');
    await pool.query('DELETE FROM profiles;');

    await seedProfile(pool, 'prof-watch-1');
    await seedOpportunity(pool, 'opp-watch-1');
    await seedOpportunity(pool, 'opp-watch-2');
    await seedOpportunity(pool, 'opp-watch-3');
  });

  it('adds, checks, lists and removes watches', async () => {
    const profileId = asProfileId('prof-watch-1');
    const oppId1 = asOpportunityId('opp-watch-1');
    const oppId2 = asOpportunityId('opp-watch-2');

    expect(await watchRepo.isWatching(profileId, oppId1)).toBe(false);

    await watchRepo.addWatch(profileId, oppId1);
    await watchRepo.addWatch(profileId, oppId2);
    // Duplicate add should be idempotent
    await watchRepo.addWatch(profileId, oppId1);

    expect(await watchRepo.isWatching(profileId, oppId1)).toBe(true);
    expect(await watchRepo.isWatching(profileId, oppId2)).toBe(true);

    const paged = await watchRepo.findWatchedPaged(profileId, 1, 10);
    expect(paged.total).toBe(2);
    expect(paged.items).toHaveLength(2);
    expect(paged.items.map((i) => i.opportunity.id)).toContain(oppId1);
    expect(paged.items.map((i) => i.opportunity.id)).toContain(oppId2);

    const removed = await watchRepo.removeWatch(profileId, oppId1);
    expect(removed).toBe(true);
    expect(await watchRepo.isWatching(profileId, oppId1)).toBe(false);

    const pagedAfter = await watchRepo.findWatchedPaged(profileId, 1, 10);
    expect(pagedAfter.total).toBe(1);
    expect(pagedAfter.items[0].opportunity.id).toBe(oppId2);
  });

  it('computes profile summary counts (newRecommendations, watching, closingSoon, unreadAlerts)', async () => {
    const profileId = asProfileId('prof-watch-1');
    const opp1 = asOpportunityId('opp-watch-1');
    const opp2 = asOpportunityId('opp-watch-2');
    const opp3 = asOpportunityId('opp-watch-3');

    // Set closing_date for opp1 to in 3 days (closing soon <= 7 days)
    const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await pool.query('UPDATE opportunities SET closing_date = $1 WHERE id = $2;', [
      in3Days,
      opp1,
    ]);

    // Set closing_date for opp2 to in 15 days (> 7 days, not closing soon)
    const in15Days = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    await pool.query('UPDATE opportunities SET closing_date = $1 WHERE id = $2;', [
      in15Days,
      opp2,
    ]);

    // Create 2 recommendations: 1 new (feedback NULL), 1 with feedback
    await recRepo.save({
      id: asRecommendationId('rec-sum-1'),
      profileId,
      opportunityId: opp1,
      score: 0.85,
      explanation: { summary: 'Match 1', matchedFactors: [] },
      feedback: null,
    });
    await recRepo.save({
      id: asRecommendationId('rec-sum-2'),
      profileId,
      opportunityId: opp2,
      score: 0.75,
      explanation: { summary: 'Match 2', matchedFactors: [] },
      feedback: { decision: 'Participate', recordedAt: new Date() },
    });

    // Add watches on opp1 and opp2
    await watchRepo.addWatch(profileId, opp1);
    await watchRepo.addWatch(profileId, opp2);

    const summary = await watchRepo.getProfileSummary(profileId);
    expect(summary).not.toBeNull();
    expect(summary?.newRecommendations).toBe(1);
    expect(summary?.watching).toBe(2);
    expect(summary?.closingSoon).toBe(1);
    expect(summary?.unreadAlerts).toBe(0);

    // Insert an unread alert and verify real unreadAlerts count
    await pool.query(
      `INSERT INTO alerts (id, profile_id, opportunity_id, trigger, change_key)
       VALUES ($1, $2, $3, 'Amendment', 'change-1');`,
      ['alert-test-summary-1', profileId, opp1],
    );
    const summaryWithAlert = await watchRepo.getProfileSummary(profileId);
    expect(summaryWithAlert?.unreadAlerts).toBe(1);

    // Mark alert as read and verify unreadAlerts decreases to 0
    await pool.query(
      `UPDATE alerts SET read_at = NOW() WHERE id = $1;`,
      ['alert-test-summary-1'],
    );
    const summaryRead = await watchRepo.getProfileSummary(profileId);
    expect(summaryRead?.unreadAlerts).toBe(0);
  });

  it('returns null summary when profile does not exist', async () => {
    const summary = await watchRepo.getProfileSummary(asProfileId('00000000-0000-0000-0000-000000000000'));
    expect(summary).toBeNull();
  });

  it('finds watching profiles with their alerts_enabled preference', async () => {
    const profileId1 = asProfileId('prof-watch-1');
    const oppId1 = asOpportunityId('opp-watch-1');

    await seedProfile(pool, 'prof-watch-2');
    const profileId2 = asProfileId('prof-watch-2');

    // Set prof-watch-2 to alerts_enabled = false
    await pool.query('UPDATE profiles SET alerts_enabled = false, contact_email = $1 WHERE id = $2;', [
      'user2@test.com',
      profileId2,
    ]);
    await pool.query('UPDATE profiles SET alerts_enabled = true, contact_email = $1 WHERE id = $2;', [
      'user1@test.com',
      profileId1,
    ]);

    await watchRepo.addWatch(profileId1, oppId1);
    await watchRepo.addWatch(profileId2, oppId1);

    const watchers = await watchRepo.findWatchers(oppId1);
    expect(watchers).toHaveLength(2);
    expect(watchers).toEqual([
      { profileId: profileId1, alertsEnabled: true, contactEmail: 'user1@test.com' },
      { profileId: profileId2, alertsEnabled: false, contactEmail: 'user2@test.com' },
    ]);

    const noWatchers = await watchRepo.findWatchers(asOpportunityId('opp-watch-3'));
    expect(noWatchers).toHaveLength(0);
  });
});
