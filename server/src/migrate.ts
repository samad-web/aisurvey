// Tiny migration runner: applies every .sql file in ../migrations in
// filename order, idempotently. Idempotency comes from the SQL itself
// (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS) plus a
// schema_migrations bookkeeping table that records which files have run.
//
// Usage:
//   npm run migrate
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { db, closeDb } from './db.js';
import { env } from './env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');

async function main(): Promise<void> {
  if (!env.hasDatabase) {
    console.error('[migrate] DATABASE_URL is not set; aborting.');
    process.exit(1);
  }
  const sql = db()!;

  await sql`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const applied = new Set(
    (await sql<{ filename: string }[]>`select filename from schema_migrations`)
      .map((r) => r.filename),
  );

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[migrate] skip   ${file} (already applied)`);
      continue;
    }
    const ddl = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`[migrate] apply  ${file}`);
    await sql.unsafe(ddl);
    await sql`insert into schema_migrations (filename) values (${file})`;
  }

  console.log('[migrate] done');
  await closeDb();
}

main().catch(async (err) => {
  console.error('[migrate] failed', err);
  await closeDb();
  process.exit(1);
});
