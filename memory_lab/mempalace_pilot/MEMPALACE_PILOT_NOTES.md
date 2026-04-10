# MemPalace Pilot Notes

## What I tested

- Installed `mempalace==3.1.0` in an isolated virtualenv at `memory_lab/mempalace_pilot/.venv`
- Created a separate pilot palace at `memory_lab/mempalace_pilot/palace`
- Initialized and mined:
  - `/Users/jakeaaron/Documents/Webapp`
  - `/Users/jakeaaron/Documents/Webapp/data/andre_language_map`

## Commands used

```bash
cd /Users/jakeaaron/Documents/Webapp/memory_lab/mempalace_pilot
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python mempalace==3.1.0

.venv/bin/mempalace --palace /Users/jakeaaron/Documents/Webapp/memory_lab/mempalace_pilot/palace init /Users/jakeaaron/Documents/Webapp --yes
.venv/bin/mempalace --palace /Users/jakeaaron/Documents/Webapp/memory_lab/mempalace_pilot/palace mine /Users/jakeaaron/Documents/Webapp

.venv/bin/mempalace --palace /Users/jakeaaron/Documents/Webapp/memory_lab/mempalace_pilot/palace init /Users/jakeaaron/Documents/Webapp/data/andre_language_map --yes
.venv/bin/mempalace --palace /Users/jakeaaron/Documents/Webapp/memory_lab/mempalace_pilot/palace mine /Users/jakeaaron/Documents/Webapp/data/andre_language_map
```

## What worked well

- Install was clean in an isolated env.
- Local embedding model downloaded and indexing completed.
- `status` worked and showed the palace was populated.
- Search did a solid job on structured operational memory:
  - searching for `critical review Mary McGahan wedding is off` surfaced the exact packet in `action_queue.json`
  - the result included the cancellation text and the recommended Close action
- Drawer count increased from `497` to `727` after adding the Andre language corpus, so the second ingest did land.

## What was weak or weird

- `wake-up` was not very useful for this use case out of the box.
  - It mostly surfaced app scaffolding and automation runner text, not the highest-value Andre/operator memory.
- Voice-style retrieval was weak.
  - Searches like `Andre pricing 35 per person` and `all right` did not reliably surface the best Andre-language examples first.
- I hit index/runtime warnings during one filtered search:
  - `database is locked`
  - `Index with capacity 100 and 100 current entries cannot add 1 records`
- The tool also wants a `mempalace.yaml` in each directory you want to mine, so the setup is a little less plug-and-play than the README makes it sound.

## Current pilot state

- Palace path:
  - `/Users/jakeaaron/Documents/Webapp/memory_lab/mempalace_pilot/palace`
- Pilot env:
  - `/Users/jakeaaron/Documents/Webapp/memory_lab/mempalace_pilot/.venv`
- Current status at test time:
  - `727 drawers`
  - `WING: webapp`
  - `ROOM: data`
  - `ROOM: general`

## Verdict

- Worth experimenting with for:
  - searchable ops history
  - queue/review/event memory
  - structured CRM artifacts
- Not yet convincing for:
  - Andre voice retrieval
  - best-of corpus surfacing
  - wake-up context quality

## Best next move if we keep going

- Create a cleaner MemPalace corpus just for:
  - `action_queue.json`
  - `live_close_crm.json`
  - `automation_morning_brief.json`
  - `automation_cadence_report.json`
  - `data/andre_language_map/*.md`
  - selected Andre CSV/JSON artifacts instead of the whole app codebase
- Then test whether a smaller, higher-signal palace beats the broad ingest.
