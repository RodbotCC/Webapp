# Comeketo Webapp — Full Summary

This summary is only about the Comeketo web app in `/Users/jakeaaron/Documents/Webapp`.

Excluded on purpose:
- Story
- Storie
- any general-agent work outside this webapp

This combines:
- the guided-Oracle / Cursor work now on GitHub `main`
- the local Comeketo-only tracking and handoff work we added in this pass

---

## Executive summary

The app moved in two big directions at once:

1. From a passive dashboard into a guided command surface
2. From a forgetful tool into the beginning of a temporally continuous operating system

Cursor pushed the guided-Oracle, surface-map, automation-catalog, and broader UI/data release.
This pass added safer config separation, operator-specific workspace settings, local AI persistence, daily ops tracking, project-boundary separation, and clearer freshness/verification handling.

Net result:
- Oracle is more actionable
- the app is easier to hand to Andre
- the machine is less stateless
- the system is more observable day to day

---

## A. Cursor / shipped-on-main work

GitHub remote:
- `https://github.com/RodbotCC/Webapp`

Latest guided-Oracle commit:
- `32a78b3 Guided Oracle (HRMR): next-step chips, grades, director context`

### 1. Oracle became guided instead of just chat

What changed:
- Oracle replies can now end with structured next steps
- the UI renders those as tappable chips
- replies can be graded on an `A+` to `F` scale
- recent taps and grades feed back into future Oracle context

What that means:
- answer -> next action -> feedback loop
- better alignment over time
- less “nice paragraph, now what?”

Likely touched files:
- [app.js](/Users/jakeaaron/Documents/Webapp/app.js)
- [server.js](/Users/jakeaaron/Documents/Webapp/server.js)
- [styles.css](/Users/jakeaaron/Documents/Webapp/styles.css)
- [index.html](/Users/jakeaaron/Documents/Webapp/index.html)

### 2. Live CRM verification messaging was clarified

What changed:
- verification wording was tightened so it means pipeline overlap / match quality, not some vague trust score
- richer verification metadata is being produced

What that means:
- users can understand what is live, what is static, and how much overlap there is

### 3. App surface mapping was added for tooling and agents

Observed in repo:
- [data/app_surface.json](/Users/jakeaaron/Documents/Webapp/data/app_surface.json)

What it means:
- agents and tooling can target known UI surfaces consistently
- better automation / internal tooling hooks

### 4. Automation catalog + broader data updates landed

Observed in repo:
- [data/automation_node_catalog.json](/Users/jakeaaron/Documents/Webapp/data/automation_node_catalog.json)

Reported changes included:
- automation/catalog support
- queue/activity/automation/live-data updates
- fixture and schema refreshes

What it means:
- the blueprint/graph side of the system is getting more formal and machine-addressable

### 5. Front-end expansion

Reported changes included:
- a much larger `app.js`
- updated shell structure in `index.html`
- major styling work in `styles.css`

What it means:
- the command-center UX is broader than before
- Oracle, deal flows, and automation flows are more central in the UI

### 6. Product intent was written down

Observed in repo:
- [INTENT.md](/Users/jakeaaron/Documents/Webapp/INTENT.md)

What it means:
- the product direction is now more explicit
- easier to align future work around “unified intelligence surface” instead of a generic CRM clone

---

## B. Comeketo-only work added in this pass

These are the local changes we made in this webapp pass to improve handoff, persistence, observability, and project separation.

### 1. Safer config split

Added:
- [.gitignore](/Users/jakeaaron/Documents/Webapp/.gitignore)
- [.env.example](/Users/jakeaaron/Documents/Webapp/.env.example)

Updated:
- [data/settings.json](/Users/jakeaaron/Documents/Webapp/data/settings.json)
- [server.js](/Users/jakeaaron/Documents/Webapp/server.js)
- [README.md](/Users/jakeaaron/Documents/Webapp/README.md)

What changed:
- safe tracked settings now live in `data/settings.json`
- machine-local live settings now live in `data/settings.local.json`
- `.env` and local settings are ignored by git

Why it matters:
- Andre can have his own machine-local setup
- local secrets stop riding around in tracked config
- the repo is much safer to share and deploy

### 2. Operator-specific workspace settings

Updated:
- [app.js](/Users/jakeaaron/Documents/Webapp/app.js)
- [server.js](/Users/jakeaaron/Documents/Webapp/server.js)

What changed:
- Settings now support operator-level fields:
  - name
  - role
  - email
  - phone
  - Close CRM user ID
  - ClickUp target
  - email sender identity
  - SMS sender identity

Why it matters:
- the app can stop pretending Jake and Andre are the same operator
- easier handoff and easier machine-by-machine setup

### 3. AI persistence in the browser

Updated:
- [app.js](/Users/jakeaaron/Documents/Webapp/app.js)

What changed:
- Oracle chat history is saved in IndexedDB
- AI artifacts are also saved locally:
  - follow-up drafts
  - deal analyses
  - objection playbooks
  - coaching outputs
  - recovery outputs

Why it matters:
- the AI stops feeling like it wakes up with amnesia every time
- this is the first real local memory layer for Oracle inside the app

### 4. Daily operating memory

Added:
- [data/ops_tracker.json](/Users/jakeaaron/Documents/Webapp/data/ops_tracker.json)

Updated:
- [server.js](/Users/jakeaaron/Documents/Webapp/server.js)
- [app.js](/Users/jakeaaron/Documents/Webapp/app.js)
- [data/SCHEMA.md](/Users/jakeaaron/Documents/Webapp/data/SCHEMA.md)

What changed:
- there is now a dedicated operations tracker for:
  - what happened
  - what we learned
  - what we added
  - what it affected
  - whether it helped
  - bottlenecks
- activity events now also roll up into daily metrics automatically
- a Daily Operating Memory panel was added to the Automation view
- Timeline now shows day-level ops memory alongside event logs

Why it matters:
- this gives the app the beginning of temporal continuity
- you can now track the machine’s day instead of only watching raw events fly by

### 5. Project boundary separation

Added/updated:
- [data/ops_tracker.json](/Users/jakeaaron/Documents/Webapp/data/ops_tracker.json)
- [README.md](/Users/jakeaaron/Documents/Webapp/README.md)

What changed:
- this workspace is explicitly marked as `Comeketo`
- `Story` and `Storie` are explicitly marked as outside this project

Why it matters:
- avoids cross-contamination between the sales app and your general agent system

### 6. Freshness + verification visibility

Updated:
- [server.js](/Users/jakeaaron/Documents/Webapp/server.js)
- [app.js](/Users/jakeaaron/Documents/Webapp/app.js)
- [index.html](/Users/jakeaaron/Documents/Webapp/index.html)

What changed:
- top-bar freshness indicator
- live verification info shown in Settings
- live Close data now records sync/coverage status more clearly

Why it matters:
- Andre can tell whether he is looking at current information
- static-vs-live drift is easier to spot

### 7. Private file exposure tightened

Updated:
- [server.js](/Users/jakeaaron/Documents/Webapp/server.js)

What changed:
- generic `/data/:file` no longer exposes:
  - raw settings files
  - doctrine/internal config files

Why it matters:
- better local security hygiene

### 8. Andre-facing handoff note

Added:
- [ANDRE_UPDATE_2026-04-10.md](/Users/jakeaaron/Documents/Webapp/ANDRE_UPDATE_2026-04-10.md)

Why it matters:
- you now have a clean handoff note that explains the Comeketo app changes without mixing in Story

---

## C. What this means for Andre specifically

Andre should notice:
- Oracle feels more guided
- the app is more explicit about next actions
- there is better visibility into whether CRM data is fresh
- the app has the start of memory and continuity
- the workspace can now be configured around his operator identity instead of Jake’s default environment
- daily change tracking is now part of the product instead of living outside it

---

## D. What is still not fully wired

### Text messaging

Still needed:
- real SMS provider
- sending number
- API credentials
- webhook path for inbound replies and delivery status

### Gmail / email sending

Still needed:
- Gmail API or SMTP path
- sender mailbox choice
- credentials / OAuth
- decision on whether sent mail should sync back into Close CRM

### Google Workspace query + write access

Still needed:
- exact Workspace account / tenant
- scope decision:
  - Gmail
  - Drive
  - Docs
  - Sheets
- OAuth credentials
- exact documents/sheets/folders/mailboxes we should target first

### Shared temporal continuity

Right now:
- Oracle learning persistence is local-browser
- not yet a shared server-side memory corpus
- not yet a full calendar/journal retrieval pipeline for AI context

That means:
- we started continuity
- we have not finished continuity

---

## E. Bottom line

Comeketo moved from:
- dashboard + AI helper

toward:
- guided operator surface
- observable automation system
- early memory-bearing sales agent workspace

Cursor/main delivered the big guided-Oracle and surface-map push.
This pass made the app safer to hand off, less forgetful, more separable from Story, and much better at tracking what the machine is actually doing day by day.
