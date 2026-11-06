const { ApiError } = require('../middleware/error_handler');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

const REST = `${SUPABASE_URL}/rest/v1`;
const MGMT_QUERY = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

function restHeaders(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

// Executes raw SQL through Supabase Management API (used for auto schema creation).
async function execSql(query) {
  const res = await fetch(MGMT_QUERY, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(502, 'SUPABASE_SQL_ERROR', `Schema init failed (${res.status}): ${text}`);
  }
  return res.json();
}

// Creates all tables/indexes if they do not exist yet (idempotent).
async function ensureSchema() {
  const sql = `
    create table if not exists public.users (
      id uuid primary key default gen_random_uuid(),
      login text unique not null,
      password_hash text not null,
      created_at timestamptz not null default now()
    );

    create table if not exists public.tickets (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references public.users(id) on delete cascade,
      title text,
      description text,
      category text,
      status text not null default 'draft',
      created_at timestamptz,
      updated_at timestamptz not null default now()
    );

    create table if not exists public.refresh_tokens (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references public.users(id) on delete cascade,
      token text unique not null,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    );

    -- exactly one draft per user (DB-level protection against duplicates)
    create unique index if not exists tickets_one_draft_per_user
      on public.tickets (user_id) where status = 'draft';

    create index if not exists tickets_user_idx on public.tickets (user_id);

    -- server-only access (service_role bypasses RLS, no policies = nobody else can read)
    alter table public.users enable row level security;
    alter table public.tickets enable row level security;
    alter table public.refresh_tokens enable row level security;
  `;
  await execSql(sql);
  console.log('Database schema ensured (users, tickets, refresh_tokens).');
}

async function handleRestError(res, table) {
  const text = await res.text();
  console.error(`Supabase REST error on ${table}: ${res.status} ${text}`);
  throw new ApiError(502, 'SUPABASE_ERROR', `Storage error on "${table}" (${res.status})`);
}

// SELECT rows. `qs` is a PostgREST query string like "login=eq.john&limit=1".
async function select(table, qs = '') {
  const res = await fetch(`${REST}/${table}?${qs}`, { headers: restHeaders() });
  if (!res.ok) await handleRestError(res, table);
  return res.json();
}

// SELECT exactly one row (or null when not found).
async function selectOne(table, qs = '') {
  const res = await fetch(`${REST}/${table}?${qs}`, {
    headers: restHeaders({ Accept: 'application/vnd.pgrst.object+json' }),
  });
  if (res.status === 406) return null; // PGRST116 - zero rows
  if (!res.ok) await handleRestError(res, table);
  return res.json();
}

// INSERT one row, returns created object.
async function insert(table, body) {
  const res = await fetch(`${REST}/${table}`, {
    method: 'POST',
    headers: restHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) await handleRestError(res, table);
  const rows = await res.json();
  return rows[0];
}

// UPDATE rows matching `qs`, returns array of updated rows (empty if nothing matched).
async function update(table, qs, body) {
  const res = await fetch(`${REST}/${table}?${qs}`, {
    method: 'PATCH',
    headers: restHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) await handleRestError(res, table);
  return res.json();
}

// DELETE rows matching `qs`, returns deleted rows.
async function remove(table, qs) {
  const res = await fetch(`${REST}/${table}?${qs}`, {
    method: 'DELETE',
    headers: restHeaders({ Prefer: 'return=representation' }),
  });
  if (!res.ok) await handleRestError(res, table);
  return res.json();
}

module.exports = { ensureSchema, select, selectOne, insert, update, remove };