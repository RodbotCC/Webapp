# Andre Close Focus Lattice Catalog

This directory is the Andre-focused version of the Ratio Lattice-style catalog.

It is generated from:

- `data/andre_close_focus/saved_views_export/leads.json`
- `data/andre_close_focus/saved_views_export/contacts.json`
- `data/andre_close_focus/saved_views_export/activities_by_lead.json`
- `data/andre_close_focus/saved_views_export/saved_views.json`

The catalog keeps two layers side by side:

- Raw Close mirrors: `Raw_close_*.txt`
- Normalized sales objects: `Leads.txt`, `Contacts.txt`, `Conversations.txt`, `Emails.txt`, `Sms.txt`, `Calls.txt`, `Opportunity.txt`, `Tasks:Promise.txt`, `Signal_event.txt`, and `Next_best_action.txt`

The single shareable bundle is:

- `ANDRE_CLOSE_FOCUS_LATTICE_FULL_BUNDLE.txt`

Regenerate it with:

```bash
node scripts/build_andre_lattice_catalog.js
```

This is intentionally file-backed for now. Once the shape feels right, the same objects can be promoted into SQLite, Supabase, or an app API without changing the core vocabulary.
