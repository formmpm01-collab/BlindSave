import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { pgtap } from '@electric-sql/pglite-pgtap';
import { expect, it } from 'vitest';

it('applies the real migration and passes the pgTAP security suite in embedded Postgres', async () => {
  const db = new PGlite({ extensions: { vector, pgtap } });
  try {
    // Minimal Supabase Auth contract. Remote Auth, PostgREST and the gateway are not emulated.
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create schema extensions;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
          nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
      $$;
      grant usage on schema auth, public, extensions to anon, authenticated, service_role;
      set search_path = public, extensions;
    `);
    await db.exec(await readFile('supabase/migrations/202610040001_initial_market.sql', 'utf8'));
    const results = await db.exec(await readFile('supabase/tests/market.test.sql', 'utf8'));
    const tap = results.flatMap(result => result.rows.flatMap(row => Object.values(row))).filter((value): value is string => typeof value === 'string');
    expect(tap.filter(line => line.startsWith('not ok'))).toEqual([]);
    expect(tap.filter(line => /^ok \d+/.test(line))).toHaveLength(12);
    expect(tap).toContain('1..12');
  } finally { await db.close(); }
}, 30_000);
