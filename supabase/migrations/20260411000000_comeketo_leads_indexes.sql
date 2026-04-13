-- Comeketo — extend indexed Close CRM data in schema `comeketo`
-- Apply in Supabase SQL editor (or supabase db push) after connecting the project.
-- Safe to re-run: uses IF NOT EXISTS where supported.

CREATE SCHEMA IF NOT EXISTS comeketo;

-- Full lead records from Close (replaces reliance on scraped snapshots for org context)
CREATE TABLE IF NOT EXISTS comeketo.leads (
  id                  text PRIMARY KEY,
  name                text,
  display_name        text,
  status_id           text,
  status_label        text,
  primary_phone       text,
  primary_email       text,
  url                 text,
  description         text,
  custom              jsonb,
  raw                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_close    timestamptz,
  updated_at_close    timestamptz,
  synced_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON comeketo.leads (status_label);
CREATE INDEX IF NOT EXISTS idx_leads_updated ON comeketo.leads (updated_at_close DESC);

-- Speed up joins from opportunities / activities → lead
CREATE INDEX IF NOT EXISTS idx_opportunities_lead_id ON comeketo.opportunities (lead_id);
CREATE INDEX IF NOT EXISTS idx_activities_lead_id ON comeketo.activities (lead_id);
CREATE INDEX IF NOT EXISTS idx_tasks_lead_id ON comeketo.tasks (lead_id);

COMMENT ON TABLE comeketo.leads IS 'Close CRM leads — populated by lib/liveSync.syncLeads; raw retains full API payload.';
