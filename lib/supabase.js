// ═══════════════════════════════════════════════════════
// COMEKETO — Supabase client
// Single shared client, server-side only.
// Uses the secret key, which bypasses RLS.
// ═══════════════════════════════════════════════════════
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL        = process.env.SUPABASE_URL || '';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || '';
const SUPABASE_SCHEMA     = process.env.SUPABASE_SCHEMA || 'comeketo';

let _client = null;

function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY);
}

function client() {
  if (_client) return _client;
  if (!isConfigured()) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env (see .env.example).'
    );
  }
  _client = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db:   { schema: SUPABASE_SCHEMA },
    global: { headers: { 'X-Client-Info': 'comeketo-server/1.0' } },
  });
  return _client;
}

module.exports = {
  client,
  isConfigured,
  SUPABASE_URL,
  SUPABASE_SCHEMA,
};
