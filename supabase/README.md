# Supabase — Comeketo CRM index

**Canonical operational data** for deals, tasks, activities (email / SMS / call / note), and **leads** lives in the Postgres schema `comeketo`, filled by **Close → `lib/liveSync.js`** on each sync. The webapp reads it through `/api/live/*` and `liveQueries.js`.

## Apply migrations

1. Open the Supabase project → **SQL Editor**.
2. Paste and run the SQL file(s) under `supabase/migrations/` in order.
3. Ensure `.env` has `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SUPABASE_SCHEMA=comeketo`.

After `20260411000000_comeketo_leads_indexes.sql`, run a Close sync (`POST /close/sync` or the in-app control) so `leads` and expanded `activities` populate.
