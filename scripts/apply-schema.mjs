// One-shot: apply src/lib/supabase/schema.sql to the Supabase DB.
// Uses POSTGRES_URL_NON_POOLING from .env.local (direct connection — the
// pooler rejects DDL over prepared statements).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const ENV_PATH = resolve(process.cwd(), '.env.local');
const SQL_PATH = resolve(process.cwd(), 'src/lib/supabase/schema.sql');

// Minimal .env parser — avoids pulling dotenv just for this.
const env = {};
for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m) env[m[1]] = m[2];
}

const connectionString = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL;
if (!connectionString) {
  console.error('No POSTGRES_URL_NON_POOLING in .env.local');
  process.exit(1);
}

const sql = readFileSync(SQL_PATH, 'utf8');

// Supabase's direct endpoint presents a self-signed chain — we trust it
// for this one-shot DDL run. Parse the URL so our ssl override actually
// wins over sslmode in the query string (new pg treats that as verify-full).
const u = new URL(connectionString);
const client = new pg.Client({
  host: u.hostname,
  port: Number(u.port || 5432),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.replace(/^\//, ''),
  ssl: { rejectUnauthorized: false },
});
await client.connect();
console.log('Connected. Applying schema...');
try {
  await client.query(sql);
  console.log('✓ Schema applied.');
} catch (err) {
  console.error('✗ Schema failed:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
