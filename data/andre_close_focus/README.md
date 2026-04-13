# Andre Close Focus

This directory narrows the app's CRM attention to the specific Andre-oriented Close folders/views shown in the screenshot from April 13, 2026.

These are treated as the focused operational surface:

- `01. Today's Leads`
- `02. Day 1-5 Cadence`
- `03. Day 6-10 Cadence`
- `04. Opened Email (24hr)`
- `05. No Connect Made`
- `06. Needs Response`
- `07. Booked Tastings`
- `08. Long-Term / Dormant`
- `09. All Dormant`
- `10. All Other Followup`

Current implementation note:

- These buckets are derived from the Close-direct file-tree snapshots the server writes during sync.
- They use screenshot-defined labels as the canonical focus lanes.
- If we later collect exact Close saved-view IDs, we can swap the derivation logic for direct view-specific API pulls without changing the rest of the app contract.
