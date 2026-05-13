import postgres from 'postgres';
import { env } from './env.js';

let client: ReturnType<typeof postgres> | null = null;

/** Lazily-initialised Postgres client. Returns null if DATABASE_URL is unset. */
export function db(): ReturnType<typeof postgres> | null {
  if (!env.hasDatabase) return null;
  if (!client) {
    client = postgres(env.DATABASE_URL, {
      ssl: env.databaseSsl ? 'require' : false,
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => undefined,
    });
    console.log('[db] Postgres client initialised');
  }
  return client;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = null;
  }
}
