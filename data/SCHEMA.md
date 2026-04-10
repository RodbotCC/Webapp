# Comeketo Sales Command Center — Data Directory Schema

> **This directory is the source of truth.**
> Any tool, AI agent, CLI script, or manual edit that writes valid JSON here
> will be picked up automatically by the running server and pushed live to
> Andre's dashboard via Server-Sent Events (SSE).

## How It Works

1. A file in `data/` is created or modified
2. The server's `fs.watch` detects the change
3. An SSE event fires to all connected browser clients
4. The frontend refetches that specific file and re-renders the active view
5. IndexedDB cache is updated for offline resilience

**Latency:** ~300ms (debounce) from file write → screen update.

## File Map

| File | Slot ID | Used By Views | Description |
|------|---------|---------------|-------------|
| `andre_profile.json` | `profile` | Command, Coaching | Andre's bio, strengths, development areas, conversation insights |
| `andre_kpis.json` | `kpis` | Command, Performance | Full KPI scoreboard, call activity, leading/lagging indicators |
| `andre_pipeline.json` | `pipeline` | Command, Pipeline, Deals | All deals, stages, high-value portfolio, risk patterns, priority distribution |
| `andre_tasks.json` | `tasks` | Command, Actions, Coaching, Automation | Task buckets (today/48h/3-7d/watch), bottlenecks, open loops, coaching plan |
| `ops_tracker.json` | `ops` | Automation, Timeline, Command | Daily operating memory: what happened, what we learned, what we added, what it affected, whether it helped, bottlenecks |
| `oracle_templates.json` | `templates` | Coaching, Automation | Call scripts, email templates, SMS templates |
| `oracle_cadences.json` | `cadences` | Coaching, Automation | Cadence protocols, reality packets, voice guide |
| `oracle_scenarios.json` | `scenarios` | Pipeline, Performance, Deals | Scenario families, objection families, deal-oracle mapping, coaching intel |
| `oracle_doctrine.json` | `doctrine` | Server-side only (AI prompts) | Sales philosophy, conversational mechanics, action templates — NEVER exposed to frontend |
| `live_close_crm.json` | `live` | Command, Automation | Live CRM snapshot: needs_attention, closing_soon, alerts, pipeline_snapshot |
| `action_queue.json` | `queue` | Automation | Pending/completed action items for the automation engine |
| `settings.json` | `settings` | Settings, Oracle | AI config (BYOK key, model), general preferences |

## File Schemas

### andre_profile.json
```json
{
  "name": "string",
  "role": "string",
  "executive_summary": {
    "active_deals": "number",
    "won_deals": "number",
    "win_rate": "number (0-1)",
    "total_revenue": "number"
  },
  "strengths": ["string"],
  "development_areas": [
    {
      "area": "string",
      "description": "string",
      "severity": "critical|warning|info",
      "deals_affected": "number"
    }
  ],
  "conversation_insights": {
    "sample_size": "number",
    "language_breakdown": { "portuguese": "number", "english": "number" },
    "sample_excerpts": [
      { "quote": "string", "context": "string", "note": "string" }
    ]
  }
}
```

### andre_pipeline.json
```json
{
  "summary": {
    "total_pipeline": "number",
    "total_deals": "number",
    "avg_deal_value": "number",
    "locked_in_revenue": "number",
    "at_risk_revenue": "number",
    "largest_deal": "number"
  },
  "stages": [
    {
      "label": "string",
      "count": "number",
      "value": "number",
      "color": "hex string",
      "emoji": "string (legacy, mapped to icon)"
    }
  ],
  "priority_distribution": { "high": "number", "medium": "number", "low": "number" },
  "risk_patterns": [
    { "flag": "string", "count": "number" }
  ],
  "high_value_deals": ["...deal objects"],
  "all_deals": [
    {
      "name": "string",
      "value": "number",
      "stage": "string",
      "event": "string",
      "venue": "string",
      "guests": "number|string",
      "confidence": "number (0-100)",
      "priority": "high|medium|low",
      "status": "active|won|at_risk",
      "risk": ["string"]
    }
  ]
}
```

### andre_kpis.json
```json
{
  "scoreboard": {
    "<metric_key>": {
      "andre": "number|string",
      "team_avg": "number|string",
      "ranking": "number|string",
      "advantage": "number (percent)"
    }
  },
  "call_activity": {
    "total": "number",
    "outbound": "number",
    "inbound": "number",
    "outbound_pct": "number",
    "growth_rate": "number",
    "repeat_contact_rate": "number",
    "february": "number",
    "march": "number",
    "top_contacts": [{ "name": "string", "calls": "number" }]
  },
  "leading_indicators": [
    { "metric": "string", "current": "number", "target": "number", "unit": "string", "status": "string" }
  ],
  "lagging_indicators": ["...same shape"]
}
```

### andre_tasks.json
```json
{
  "task_summary": { "total": "number", "today": "number" },
  "tasks": {
    "today": [{ "lead": "string", "action": "string", "urgency": "string", "value": "number", "icon": "string (material symbol)" }],
    "within_48h": ["...same shape"],
    "within_3_7d": ["...same shape"],
    "watch_list": ["...same shape"]
  },
  "bottlenecks": [
    { "lead": "string", "issue": "string", "days_stalled": "number", "action": "string" }
  ],
  "open_loops": [
    { "lead": "string", "question": "string", "status": "string", "days_open": "number" }
  ],
  "automation_hooks": {},
  "coaching_plan": {
    "week_1": { "focus": "string", "activities": ["string"], "goal": "string" },
    "week_2": {},
    "week_3": {},
    "week_4": {}
  }
}
```

### live_close_crm.json
```json
{
  "_meta": { "last_synced": "ISO date string", "source": "string" },
  "pipeline_snapshot": {
    "total_active_opportunities": "number",
    "needs_attention_count": "number",
    "closing_this_week": "number",
    "top_deal_value": "number"
  },
  "needs_attention": [
    {
      "name": "string", "lead_id": "string", "stage": "string",
      "value": "number", "urgency": "string", "reason": "string"
    }
  ],
  "closing_soon": [
    {
      "name": "string", "lead_id": "string", "stage": "string",
      "value": "number", "days_until_close": "number", "note": "string"
    }
  ],
  "alerts": [
    { "name": "string", "value": "number", "message": "string", "action_required": "string" }
  ]
}
```

### action_queue.json
```json
{
  "pending": [
    {
      "id": "string (uuid or timestamp-based)",
      "type": "follow_up|task|morning_brief|cadence_check|pipeline_sync",
      "lead_id": "string (optional)",
      "lead_name": "string",
      "details": "string",
      "created_at": "ISO date string",
      "priority": "high|medium|low"
    }
  ],
  "completed": ["...same shape + completed_at field"]
}
```

### settings.json
```json
{
  "ai": {
    "enabled": "boolean",
    "openai_api_key": "string (stored server-side only)",
    "openai_api_key_set": "boolean",
    "openai_api_key_preview": "string (last 4 chars)",
    "model": "string (e.g. gpt-5.4-nano)",
    "models_available": ["string"]
  },
  "general": {}
}
```

### ops_tracker.json
```json
{
  "context": {
    "active_project": "Comeketo",
    "explicitly_not_this_project": ["Story", "Storie"],
    "note": "string"
  },
  "daily": {
    "YYYY-MM-DD": {
      "summary": "string",
      "what_happened": ["string"],
      "what_we_learned": ["string"],
      "what_we_added": ["string"],
      "what_it_affected": ["string"],
      "wins": ["string"],
      "help_signals": ["string"],
      "bottlenecks": ["string"],
      "metrics": {
        "activity_events": "number",
        "automation_events": "number",
        "ai_events": "number",
        "sync_events": "number"
      }
    }
  }
}
```

### oracle_doctrine.json
**Internal only — never served to the frontend.**
Contains the AI operating doctrine: identity, core sequence, conversational mechanics,
action templates, Comeketo standards, and energy dynamics.
See the file itself for full structure. Any changes here are picked up immediately
by the next AI call (the server reads it fresh on each request).

## Adding New Data Files

1. Create a valid JSON file in `data/`
2. Add its mapping to `FILE_TO_SLOT` in `server.js`
3. Add the corresponding state variable and SLOT_MAP entry in `app.js`
4. Add the fetch to the `boot()` function's `Promise.all`
5. Add it to `IDB.cacheAll()` and `IDB.loadFromCache()`
6. Map it to the correct views in `viewDataDeps` inside `connectDataStream()`

The file watcher will automatically pick up any `.json` file that's mapped in `FILE_TO_SLOT`.

## For AI Agents / CLI Tools

To update Andre's dashboard from outside the app:

```bash
# Example: Update a deal's confidence
cat data/andre_pipeline.json | jq '.all_deals[0].confidence = 95' > data/andre_pipeline.json

# Example: Add a task
cat data/andre_tasks.json | jq '.tasks.today += [{"lead":"New Corp","action":"Send proposal","urgency":"high","icon":"send"}]' > data/andre_tasks.json

# Example: Add an action to the queue
cat data/action_queue.json | jq '.pending += [{"id":"manual-001","type":"follow_up","lead_name":"Big Client","details":"Check in on proposal","created_at":"2026-04-09T12:00:00Z","priority":"high"}]' > data/action_queue.json
```

The dashboard will update within ~300ms of the file write.
