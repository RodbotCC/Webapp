# Comeketo Sales Command Center

Single-page sales dashboard for Andre with live Close CRM sync, Oracle AI drafting, and an action queue.

This repo is scoped to the Comeketo Sales Command Center only.

## Setup

1. Copy `.env.example` to `.env`
2. Add the Close CRM credentials
3. Run `npm start`
4. Open `http://localhost:3141`
5. Put Andre's own CRM user ID, email, phone, ClickUp target, and AI key into Settings

## Config split

- `data/settings.json` is the safe tracked template
- `data/settings.local.json` is machine-local and ignored by git
- Browser-side AI chat and AI outputs are cached in IndexedDB
- `data/ops_tracker.json` is the daily operating memory for this app
- `data/andre_close_focus/` is the focused Andre-only CRM source pack derived from the Close sidebar views we care about most
- Live pipeline/task intelligence now defaults to `CRM_SOURCE=file-tree`: the server sweeps Close directly and writes `data/live_pipeline.json`, `data/live_tasks.json`, `data/live_close_crm.json`, and `data/andre_close_focus/snapshot.json`

## Hosting (team testing & updates)

This app is a **long-running Node server** with a **writable `data/` folder**, SSE, and background jobs. That does **not** map cleanly to **Vercel serverless** (no durable local disk, no always-on process). Use a **container** or **Node web service** platform instead:

| Platform | Why it fits |
|----------|-------------|
| **Render** | `render.yaml` blueprint, GitHub auto-deploy, add a **Persistent Disk** and set `DATA_DIR` to the mount path so JSON state survives redeploys. |
| **Railway** | Connect repo, add a **volume**, set `DATA_DIR` to the volume path, deploy `Dockerfile` or Nixpacks. |
| **Fly.io** | Machines + volumes for the same pattern. |

**Minimum steps (e.g. Render):**

1. Push this repo to GitHub (company org or private repo as needed).
2. New **Web Service** → connect repo → use `render.yaml` or `build: npm install` / `start: node server.js`.
3. In **Environment**, add `CLOSE_API_KEY`, `CLOSE_USER_ID` (and optionally `DATA_DIR` once a disk exists).
4. **Persistent Disk**: create a disk, mount e.g. `/var/data`, set `DATA_DIR=/var/data`. Without a disk, data resets on each deploy.

**Docker:** `docker build -t comeketo .` then run with `-e CLOSE_API_KEY=... -e CLOSE_USER_ID=... -p 3141:3141`.

## Git workflow

1. `git init`
2. Create a GitHub repo and add it as `origin`
3. Use `main` as Andre's stable testing branch
4. Build on feature branches, merge into `main` when ready for him to pull

## Important

- Rotate any API keys that previously lived in tracked files
- Never commit `.env` or `data/settings.local.json`
