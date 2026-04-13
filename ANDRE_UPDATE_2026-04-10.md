# Andre Update — Webapp Only

This note is only about the Comeketo web app in `/Users/jakeaaron/Documents/Webapp`.
It does not include Story/Storie or any general-agent work.

## What changed

### 1. Safer config split

- The app now separates safe tracked config from machine-local config.
- `data/settings.json` is now the safe template.
- `data/settings.local.json` is now the local machine file for live keys and local operator settings.
- `.gitignore` now excludes `.env` and `data/settings.local.json`.
- `.env.example` was added so setup is clearer.

Why this matters:
- Andre's setup can stop piggybacking on Jake's machine state.
- We can put this repo on Git/GitHub without immediately leaking local config files.

### 2. Git bootstrapping started

- The `Webapp` folder is now initialized as its own git repository.
- The default branch was set to `main`.
- A `README.md` was added with setup notes and the intended Git workflow.

Why this matters:
- Jake can build on branches and Andre can test from a stable branch.
- We now have a clean starting point for GitHub handoff.

### 3. BYO-key AI was made more usable

- The OpenAI BYO-key flow still runs server-side, so the key stays off the browser.
- The Settings page was expanded so the workspace can store:
  - operator name
  - operator role
  - operator email
  - operator phone
  - Close CRM user ID
  - ClickUp list target
  - email sender identity
  - SMS sender identity

Why this matters:
- The app is now closer to Andre's real operational identity instead of using shared defaults.

### 4. AI conversations and outputs now persist locally

- Oracle chat history is now saved into browser IndexedDB.
- AI outputs such as follow-up drafts, deal analysis, objection playbooks, coaching notes, and recovery plans are now saved into browser IndexedDB as artifacts.

Why this matters:
- The AI no longer behaves like it starts from zero every time.
- We now have the first layer of local memory and temporal continuity.

### 5. Data freshness and verification were added

- Live Close CRM sync now records verification metadata.
- The app now compares live Close opportunity names against the static pipeline snapshot.
- A freshness indicator was added in the UI top bar.
- The Settings page now shows:
  - last sync time
  - verification status
  - coverage percentage
  - verification warnings when the static pipeline drifts from live CRM

Why this matters:
- Andre can see whether the app is current or stale.
- We can detect when static pipeline JSON needs to be rebuilt from live CRM.

### 6. Private files are no longer exposed through the generic data route

- Raw settings files are no longer available from the generic `/data/:file` endpoint.
- `oracle_doctrine.json` is also blocked from that generic route.
- Settings updates over live refresh now use the masked `/settings` endpoint instead of raw JSON loading.

Why this matters:
- This closes a bad leak path for secrets and internal doctrine files.

### 7. Daily operating memory was added

- A new file was added: `data/ops_tracker.json`
- This is now wired into the app as a dedicated operating-memory layer.
- The app now tracks:
  - what happened
  - what we learned
  - what we added
  - what it affected
  - whether it helped
  - bottlenecks
- A new “Daily Operating Memory” panel was added in the Automation view.
- Timeline now shows ops-memory notes for each day.
- Activity log events now also roll up into daily operating metrics automatically.

Why this matters:
- We now have a real day-by-day memory layer instead of only raw automation logs.
- This gives the app the start of temporal continuity and observability.

### 8. Project boundary is now explicit

- The app now explicitly marks this workspace as `Comeketo`.
- `Story` and `Storie` are explicitly marked as not-this-project inside the ops tracker.

Why this matters:
- It reduces the chance of the Comeketo app getting mixed up with Jake's general agent work.

## What is now easier for Andre

- Seeing whether live CRM data is fresh or stale
- Using the AI with a real persistent local memory layer
- Keeping daily notes on what the machine is doing
- Understanding what changed and what those changes affect
- Preparing this app for a real Git/GitHub workflow

## What still is not fully wired yet

### Text messaging

The app has SMS templates and drafting logic, but not real sending yet.
To finish texting, we still need a real outbound provider and credentials.

Most likely needs:
- a Twilio account or equivalent SMS provider
- a sending phone number
- account SID / auth token or API key
- webhook URL for delivery status and inbound replies
- confirmation of whether replies should sync back into the app, Close CRM, or both

### Gmail / email sending

The app has email templates and drafting logic, but not real sending yet.
To finish Gmail sending, we still need either:
- Gmail API access through Google Workspace OAuth, or
- SMTP details for the sending mailbox

Most likely needs:
- the exact sender mailbox Andre should use
- Google Workspace admin approval if using Gmail API
- OAuth client credentials for Gmail API, or SMTP host/port/user/pass
- decision on whether sent mail should also write back into Close CRM

### Google Workspace query + write access

If we want the app to query and push into Google Workspace, we need:
- which Google Workspace account / tenant to use
- whether we need Gmail only, or also Drive / Docs / Sheets
- OAuth client credentials with the right scopes
- approval from whoever administers the Workspace
- the exact targets we should read from or write to

Examples:
- specific Google Sheets IDs
- specific shared drives or folders
- specific Docs
- specific mailboxes

## Biggest practical result

The web app is now much closer to being:
- easier for Andre to understand
- safer to sync across machines
- more honest about freshness
- less forgetful over time
- ready for proper Git/GitHub collaboration

## Immediate next recommended steps

1. Rotate any real API keys that previously lived in tracked config.
2. Connect this local git repo to GitHub.
3. Decide the real outbound SMS provider.
4. Decide the real outbound email path for Andre.
5. Decide which Google Workspace assets the app needs to query and write to first.
