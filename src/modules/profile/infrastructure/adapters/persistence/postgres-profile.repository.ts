import { Injectable } from '@nestjs/common';
import { Pool, QueryResult } from 'pg';
import { ProfileRepositoryPort } from '../../../domain/ports/profile.repository.port';
import { Profile } from '../../../domain/entities/profile.entity';
import { ProfileId, asProfileId, asUserId } from '../../../../shared/domain/typed-id';

interface ProfileRow {
  id: string;
  owner_id: string;
  sector: string;
  capabilities: any;
  preferences: any;
}

@Injectable()
export class PostgresProfileRepository implements ProfileRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async save(profile: Profile): Promise<void> {
    const query = `
      INSERT INTO profiles (id, owner_id, sector, capabilities, preferences, updated_at)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        owner_id = EXCLUDED.owner_id,
        sector = EXCLUDED.sector,
        capabilities = EXCLUDED.capabilities,
        preferences = EXCLUDED.preferences,
        updated_at = CURRENT_TIMESTAMP;
    `;

    const values = [
      profile.id,
      profile.ownerId,
      profile.sector,
      JSON.stringify(profile.capabilities ?? []),
      JSON.stringify(profile.preferences ?? {}),
    ];

    await this.pool.query(query, values);
  }

  async findById(id: ProfileId): Promise<Profile | null> {
    const res: QueryResult<ProfileRow> = await this.pool.query(
      'SELECT * FROM profiles WHERE id = $1',
      [id],
    );

    if (res.rows.length === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
  }

  private mapRowToEntity(row: ProfileRow): Profile {
    const capabilities =
      typeof row.capabilities === 'string'
        ? JSON.parse(row.capabilities)
        : row.capabilities;
    const preferences =
      typeof row.preferences === 'string'
        ? JSON.parse(row.preferences)
        : row.preferences;

    return {
      id: asProfileId(row.id),
      ownerId: asUserId(row.owner_id),
      sector: row.sector,
      capabilities: Array.isArray(capabilities) ? capabilities : [],
      preferences: {
        categoryCodes: preferences?.categoryCodes ?? [],
        keywords: preferences?.keywords ?? [],
        amountRange: preferences?.amountRange ?? null,
        departments: preferences?.departments ?? [],
      },
    };
  }
}
