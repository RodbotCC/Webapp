// ═══════════════════════════════════════════════════════
// COMEKETO SALES COMMAND CENTER — Action Server v2
// Run: node server.js   →   http://localhost:3141
// ═══════════════════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const https   = require('https');

// ─── Live data helpers (file-tree first, Supabase optional) ─────────────────────
const sb         = require('./lib/supabase');
const liveSync   = require('./lib/liveSync');
const liveQ      = require('./lib/liveQueries');

const app  = express();
const PORT = process.env.PORT || 3141;
const DATA = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');

try {
  fs.mkdirSync(DATA, { recursive: true });
} catch (e) {
  console.warn('[DATA] Could not ensure data directory:', e.message);
}
const AUTOMATION_STATE_FILE = 'automation_state.json';
const SETTINGS_FILE = 'settings.json';
const SETTINGS_LOCAL_FILE = 'settings.local.json';

const CLOSE_API_KEY  = process.env.CLOSE_API_KEY;
const CLOSE_USER_ID  = process.env.CLOSE_USER_ID;
const CLOSE_BASE     = 'https://api.close.com/api/v1';
const CLOSE_AUTH     = Buffer.from(`${CLOSE_API_KEY}:`).toString('base64');
const CRM_SOURCE     = (process.env.CRM_SOURCE || 'file-tree').toLowerCase();
const LATTICE_EXPERIMENT_FILE = process.env.LATTICE_EXPERIMENT_FILE
  ? path.resolve(process.env.LATTICE_EXPERIMENT_FILE)
  : '/Users/jakeaaron/Desktop/ComeketoClose/ratio_lattice_indexed.json';
const LATTICE_DOCTRINE_FILE = process.env.LATTICE_DOCTRINE_FILE
  ? path.resolve(process.env.LATTICE_DOCTRINE_FILE)
  : '/Users/jakeaaron/Downloads/ratio_lattice_v2.1_comeketo_doctrine_hardened.json';

// Allow all origins including null (file:// protocol)
app.use(cors({
  origin: (origin, cb) => cb(null, true),
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));
app.options(/(.*)/, cors()); // preflight for all routes (Express 5 regex syntax)
app.use(express.json());
app.use(express.static(__dirname));

// ═══════════════════════════════════════════════════
// FILE WATCHER + SERVER-SENT EVENTS (SSE)
// The data/ directory is the source of truth.
// Any tool, AI agent, or CLI that writes a JSON file
// here triggers an SSE push → the frontend refetches.
// ═══════════════════════════════════════════════════
const sseClients = new Set();
// NOTE: andre_pipeline.json and andre_tasks.json have been retired.
// Pipeline + tasks now come through /api/live/pipeline and /api/live/tasks.
// The default source is Close -> data/live_*.json. Supabase remains an
// optional future mode instead of a requirement for Andre testing.
const FILE_TO_SLOT = {
  'andre_profile.json':    'profile',
  'andre_kpis.json':       'kpis',
  'live_pipeline.json':     'pipeline',
  'live_tasks.json':        'tasks',
  'ops_tracker.json':      'ops',
  'oracle_templates.json': 'templates',
  'oracle_cadences.json':  'cadences',
  'oracle_scenarios.json': 'scenarios',
  'oracle_doctrine.json':  'doctrine',
  'live_close_crm.json':   'live',
  'action_queue.json':     'queue',
  'settings.json':         'settings',
  'settings.local.json':   'settings',
  'activity_log.json':     'activity',
};
const PRIVATE_DATA_FILES = new Set([
  SETTINGS_FILE,
  SETTINGS_LOCAL_FILE,
  'oracle_doctrine.json',
]);

// Debounce per-file — don't flood on rapid writes
const debounceTimers = {};
function broadcastChange(filename) {
  const slot = FILE_TO_SLOT[filename];
  if (!slot) return; // ignore non-mapped files like .DS_Store
  clearTimeout(debounceTimers[filename]);
  debounceTimers[filename] = setTimeout(() => {
    const payload = JSON.stringify({ file: filename, slot, ts: Date.now() });
    console.log(`[WATCH] ${filename} changed → pushing to ${sseClients.size} client(s)`);
    for (const res of sseClients) {
      res.write(`data: ${payload}\n\n`);
    }
  }, 300); // 300ms debounce
}

// Watch the data directory
try {
  const dataWatcher = fs.watch(DATA, { persistent: true }, (eventType, filename) => {
    if (filename && filename.endsWith('.json')) {
      broadcastChange(filename);
    }
  });
  dataWatcher.on('error', (e) => {
    console.warn('[WATCH] Data watcher error (live app continues; refresh manually if needed):', e.message);
  });
  console.log(`[WATCH] Watching ${DATA} for changes`);
} catch(e) {
  console.warn('[WATCH] Could not watch data directory:', e.message);
}

// SSE endpoint — clients connect here for live updates
app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`);
  sseClients.add(res);
  req.on('close', () => { sseClients.delete(res); });
});

// ═══════════════════════════════════════════════════
// ACTIVITY LOG — Records everything for the Timeline
// ═══════════════════════════════════════════════════
function logActivity(type, category, summary, details, related) {
  try {
    const logFile = path.join(DATA, 'activity_log.json');
    let data = { log: [] };
    try { data = JSON.parse(fs.readFileSync(logFile, 'utf8')); } catch(e) {}
    const event = {
      ts: new Date().toISOString(),
      type,        // 'ai', 'sync', 'queue', 'automation', 'system'
      category,    // 'chat', 'draft_followup', 'analyze_deal', 'crm_sync', etc.
      summary,
      details: details || '',
      related: related || []  // deal names, contact names — for the DAG
    };
    data.log.push(event);
    // Keep last 500 entries to prevent unbounded growth
    if (data.log.length > 500) data.log = data.log.slice(-500);
    fs.writeFileSync(logFile, JSON.stringify(data, null, 2));
    noteOpsActivity(event);
  } catch(e) { console.warn('[LOG] Failed to write activity:', e.message); }
}

function defaultOpsTracker() {
  return {
    context: {
      active_project: 'Comeketo',
      note: 'This tracker belongs to the Comeketo Sales Command Center inside /Users/jakeaaron/Documents/Webapp.',
    },
    daily: {},
    _meta: {
      created_at: new Date().toISOString(),
      last_updated: null,
    },
  };
}

function ensureOpsTracker() {
  const target = path.join(DATA, 'ops_tracker.json');
  if (!fs.existsSync(target)) writeData('ops_tracker.json', defaultOpsTracker());
}

function readOpsTracker() {
  ensureOpsTracker();
  const current = readData('ops_tracker.json');
  const base = defaultOpsTracker();
  const context = { ...base.context, ...(current.context || {}) };
  delete context.explicitly_not_this_project;
  return {
    ...base,
    ...current,
    context,
    daily: current.daily || {},
    _meta: { ...base._meta, ...(current._meta || {}) },
  };
}

function writeOpsTracker(data) {
  const prev = readOpsTracker();
  const mergedContext = { ...prev.context, ...(data.context || {}) };
  delete mergedContext.explicitly_not_this_project;
  const next = {
    ...prev,
    ...data,
    context: mergedContext,
    daily: data.daily || prev.daily,
    _meta: { ...prev._meta, ...(data._meta || {}), last_updated: new Date().toISOString() },
  };
  writeData('ops_tracker.json', next);
  return next;
}

function ensureOpsDay(tracker, dayKey) {
  if (!tracker.daily[dayKey]) {
    tracker.daily[dayKey] = {
      summary: '',
      what_happened: [],
      what_we_learned: [],
      what_we_added: [],
      what_it_affected: [],
      wins: [],
      help_signals: [],
      bottlenecks: [],
      metrics: {
        activity_events: 0,
        automation_events: 0,
        ai_events: 0,
        sync_events: 0,
      }
    };
  }
  return tracker.daily[dayKey];
}

function noteOpsActivity(event) {
  try {
    const tracker = readOpsTracker();
    const dayKey = (event.ts || new Date().toISOString()).substring(0, 10);
    const day = ensureOpsDay(tracker, dayKey);
    day.metrics.activity_events += 1;
    if (event.type === 'automation') day.metrics.automation_events += 1;
    if (event.type === 'ai') day.metrics.ai_events += 1;
    if (event.type === 'sync') day.metrics.sync_events += 1;

    const line = `${event.summary}${event.details ? ` — ${event.details}` : ''}`;
    day.what_happened.unshift(line);
    day.what_happened = day.what_happened.slice(0, 20);

    if (event.type === 'sync') {
      day.help_signals.unshift('Fresh CRM sync ran');
      day.help_signals = day.help_signals.slice(0, 10);
    }
    if (event.type === 'automation') {
      day.what_it_affected.unshift('Automation engine state / queue');
      day.what_it_affected = Array.from(new Set(day.what_it_affected)).slice(0, 10);
    }
    writeOpsTracker(tracker);
  } catch(e) {
    console.warn('[OPS] Failed to update ops tracker from activity:', e.message);
  }
}

// ─── Serve activity log ────────────────────────────
app.get('/activity', (req, res) => {
  try { res.json(readData('activity_log.json')); }
  catch(e) { res.json({ log: [] }); }
});

app.get('/ops', (req, res) => {
  try { res.json(readOpsTracker()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/ops/context', (req, res) => {
  try {
    const tracker = readOpsTracker();
    tracker.context = { ...tracker.context, ...(req.body || {}) };
    const saved = writeOpsTracker(tracker);
    res.json({ ok: true, context: saved.context, updated_at: saved._meta.last_updated });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/ops/note', (req, res) => {
  try {
    const tracker = readOpsTracker();
    const dayKey = req.body.day || new Date().toISOString().substring(0, 10);
    const day = ensureOpsDay(tracker, dayKey);
    const pushUnique = (bucket, value) => {
      if (!value) return;
      day[bucket].unshift(value);
      day[bucket] = Array.from(new Set(day[bucket])).slice(0, 20);
    };

    pushUnique('what_happened', req.body.what_happened);
    pushUnique('what_we_learned', req.body.what_we_learned);
    pushUnique('what_we_added', req.body.what_we_added);
    pushUnique('what_it_affected', req.body.what_it_affected);
    pushUnique('help_signals', req.body.help_signal);
    pushUnique('wins', req.body.win);
    pushUnique('bottlenecks', req.body.bottleneck);
    if (typeof req.body.summary === 'string') day.summary = req.body.summary;

    const saved = writeOpsTracker(tracker);
    logActivity('system', 'ops_note', `Ops note saved for ${dayKey}`, req.body.what_happened || req.body.what_we_learned || req.body.what_we_added || 'Manual ops update', []);
    res.json({ ok: true, day: saved.daily[dayKey], updated_at: saved._meta.last_updated });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Close CRM API helper ────────────────────────────
function closeRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const url  = new URL(CLOSE_BASE + endpoint);
    const hasBody = body !== null && body !== undefined;
    const bodyJson = hasBody ? JSON.stringify(body) : '';
    const headers = {
      'Authorization': `Basic ${CLOSE_AUTH}`,
      'Accept':        'application/json',
    };
    if (hasBody) {
      headers['Content-Type'] = 'application/json';
      // Close rejects chunked uploads on some write endpoints. Supplying a
      // length makes Node send a normal buffered request body.
      headers['Content-Length'] = Buffer.byteLength(bodyJson);
    }
    const opts = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method,
      headers,
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data || '{}') }); }
        catch(e) { reject(new Error('Bad JSON: ' + data)); }
      });
    });
    req.on('error', reject);
    if (hasBody) req.write(bodyJson);
    req.end();
  });
}

// ─── Load / save JSON data files ────────────────────
function readData(file)      { return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8')); }
function writeData(file, obj){ fs.writeFileSync(path.join(DATA, file), JSON.stringify(obj, null, 2)); }
function readDataIfExists(file, fallback) {
  const target = path.join(DATA, file);
  if (!fs.existsSync(target)) return fallback;
  try { return readData(file); }
  catch(e) {
    console.warn(`[DATA] Failed to read ${file}:`, e.message);
    return fallback;
  }
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return target;
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = deepMerge(
        target[key] && typeof target[key] === 'object' && !Array.isArray(target[key]) ? target[key] : {},
        value
      );
    } else {
      target[key] = value;
    }
  }
  return target;
}

function defaultSettings() {
  const models = ['gpt-5.4-nano', 'gpt-5.4-mini', 'gpt-5.4', 'gpt-4.1-nano', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-5-mini', 'gpt-5'];
  return {
    ai: {
      provider: 'openai',
      openai_api_key: '',
      model: 'gpt-5.4-nano',
      models_available: models,
      enabled: false,
    },
    general: {
      auto_sync_interval_minutes: 15,
      theme: 'light',
    },
    operator: {
      name: 'Andre Raw',
      role: 'Sales Representative',
      email: '',
      phone: '',
    },
    crm: {
      close_user_id: '',
      verification_compare_static_pipeline: true,
    },
    clickup: {
      workspace_id: '',
      list_id: '',
      assignee_email: '',
      enabled: false,
    },
    messaging: {
      email_from: '',
      sms_from: '',
      enabled: false,
    },
    _meta: {
      version: 2,
      last_updated: null,
    },
  };
}

const LATTICE_DIR = path.join(DATA, 'andre_close_focus', 'lattice_catalog');
const HRMR_DIR = path.join(DATA, 'andre_close_focus', 'hrmr');

function readLatticeFile(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path.join(LATTICE_DIR, file), 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function getLatticeBundle() {
  const index = readLatticeFile('INDEX.txt', {});
  return {
    index,
    leads: readLatticeFile('Leads.txt', []),
    contacts: readLatticeFile('Contacts.txt', []),
    opportunities: readLatticeFile('Opportunity.txt', []),
    conversations: readLatticeFile('Conversations.txt', []),
    tasks: readLatticeFile('Tasks:Promise.txt', []),
    signals: readLatticeFile('Signal_event.txt', []),
    next_best_actions: readLatticeFile('Next_best_action.txt', []),
  };
}

function getLatticeLead(leadId) {
  if (!leadId) return null;
  const b = getLatticeBundle();
  const lead = b.leads.find(l => l.lead_id === leadId);
  if (!lead) return null;
  return {
    lead,
    contacts: b.contacts.filter(c => c.lead_id === leadId),
    opportunities: b.opportunities.filter(o => o.lead_id === leadId),
    tasks: b.tasks.filter(t => t.lead_id === leadId),
    signals: b.signals.filter(s => s.lead_id === leadId),
    next_best_actions: b.next_best_actions.filter(a => a.target_object_id === leadId),
  };
}

function getExperimentLatticeGraph() {
  if (!fs.existsSync(LATTICE_EXPERIMENT_FILE)) {
    throw new Error(`Experiment lattice file not found: ${LATTICE_EXPERIMENT_FILE}`);
  }
  const experiment = JSON.parse(fs.readFileSync(LATTICE_EXPERIMENT_FILE, 'utf8'));
  const contacts = experiment.contacts || [];
  const opportunities = experiment.opportunities || [];
  const queueItems = Object.values(experiment.queues || {}).flat();

  const contactsByLead = new Map();
  for (const c of contacts) {
    if (!contactsByLead.has(c.lead_id)) contactsByLead.set(c.lead_id, []);
    contactsByLead.get(c.lead_id).push(c);
  }
  const oppsByLead = new Map();
  for (const o of opportunities) {
    if (!oppsByLead.has(o.lead_id)) oppsByLead.set(o.lead_id, []);
    oppsByLead.get(o.lead_id).push(o);
  }
  const queueByLead = new Map();
  for (const q of queueItems) {
    const prev = queueByLead.get(q.lead_id);
    if (!prev || Number(q.action_now_score || 0) > Number(prev.action_now_score || 0)) {
      queueByLead.set(q.lead_id, q);
    }
  }

  const rows = (experiment.leads || []).map(lead => {
    const leadContacts = contactsByLead.get(lead.lead_id) || [];
    const leadOpps = oppsByLead.get(lead.lead_id) || [];
    const queue = queueByLead.get(lead.lead_id) || null;
    const score = lead.sales_scoring || {};
    const hasEmail = leadContacts.some(c => (c.email_addresses || []).length);
    const hasPhone = leadContacts.some(c => (c.phone_numbers || []).length);
    const contactability = (hasEmail ? 50 : 0) + (hasPhone ? 50 : 0);
    const value = leadOpps.reduce((sum, o) => sum + Number(o.estimated_value || o.value || 0), 0);
    const balanced = Math.round(
      (Number(score.priority_score || 0) * 0.26) +
      (Number(score.action_now_score || 0) * 0.24) +
      (Number(score.saveability_score || 0) * 0.18) +
      (Number(score.revenue_value || 0) * 0.12) +
      (Number(score.close_probability || 0) * 0.10) +
      (contactability * 0.10) -
      (Number(score.decay_risk_score || 0) * 0.08)
    );
    const action = lead.next_best_action || {};
    const reasoningTags = [
      ...(lead.recommended_outputs?.reasoning_tags || []),
      ...(queue?.reasoning_tags || []),
    ];

    return {
      lead_id: lead.lead_id,
      name: lead.display_name || lead.company_name || lead.lead_id,
      status_label: lead.lead_status || '',
      url: lead.url || null,
      value,
      contacts: leadContacts.length,
      has_email: hasEmail,
      has_phone: hasPhone,
      contactability,
      activity_volume: leadContacts.length + leadOpps.length + (lead.task_ids || []).length + (reasoningTags.length || 0),
      tasks_open: (lead.task_ids || []).length,
      opportunities: leadOpps.length,
      signals: reasoningTags.slice(0, 8).map((tag, i) => ({
        id: `${lead.lead_id}:reason:${i}`,
        event_type: 'reasoning_tag',
        summary: tag.replace(/_/g, ' '),
        urgency_impact: 0,
        momentum_impact: 0,
        friction_impact: 0,
        relationship_impact: 0,
      })),
      signal_totals: {
        urgency: Number(score.urgency || 0),
        momentum: Number(score.momentum || 0),
        friction: Number(score.friction || 0),
        relationship: Number(score.relationship_strength || 0),
      },
      action: {
        next_best_action_id: queue?.queue_item_id || `${lead.lead_id}:experiment_nba`,
        target_object_id: lead.lead_id,
        action_type: action.action_type || queue?.recommended_next_action || lead.recommended_outputs?.recommended_next_action || 'review',
        title: action.title || queue?.nba_title || 'Review next best action',
        recommended_channel: action.channel || queue?.recommended_channel || lead.recommended_outputs?.recommended_channel || 'review',
        human_review_required: Boolean(lead.derived_flags?.needs_human_review || queue?.needs_human_review),
        reasoning: action.reasoning || queue?.nba_reasoning || '',
        sales_scoring: score,
      },
      scores: {
        balanced_lattice: balanced,
        action_now_score: Number(score.action_now_score || 0),
        priority_score: Number(score.priority_score || 0),
        saveability_score: Number(score.saveability_score || 0),
        decay_risk_score: Number(score.decay_risk_score || 0),
        urgency: Number(score.urgency || 0),
        momentum: Number(score.momentum || 0),
        friction: Number(score.friction || 0),
        relationship_strength: Number(score.relationship_strength || 0),
        close_probability: Number(score.close_probability || 0),
        revenue_value: Number(score.revenue_value || 0),
        attention_cost: Number(score.attention_cost || 0),
        next_action_clarity: Number(score.next_action_clarity || 0),
        contactability,
        activity_volume: leadContacts.length + leadOpps.length + (lead.task_ids || []).length + (reasoningTags.length || 0),
      },
    };
  });

  return {
    _meta: {
      generated_at: new Date().toISOString(),
      source: 'external-experiment:ratio_lattice_indexed',
      file: LATTICE_EXPERIMENT_FILE,
      experiment_generated_at: experiment._meta?.generated_at || null,
      lattice_version: experiment._meta?.lattice_version || null,
      scoring_profile: experiment._meta?.scoring_profile || null,
      formulas: experiment._meta?.composite_formulas || {},
      invariants_checked: experiment._meta?.invariants_checked || [],
    },
    counts: {
      leads: experiment._meta?.leads_indexed || rows.length,
      contacts: experiment._meta?.contacts_indexed || contacts.length,
      opportunities: experiment._meta?.opportunities_indexed || opportunities.length,
      queues: Object.values(experiment.queues || {}).reduce((sum, q) => sum + (q?.length || 0), 0),
    },
    source_summary: {
      source_data: experiment._meta?.source_data || 'external ratio lattice experiment',
      queues: Object.fromEntries(Object.entries(experiment.queues || {}).map(([k, v]) => [k, v.length])),
    },
    comparators: [
      { id: 'balanced_lattice', label: 'Balanced Lattice', description: 'Hybrid blend derived from the experiment scores plus contactability.' },
      { id: 'action_now_score', label: 'Action Now', description: experiment._meta?.composite_formulas?.action_now_score || 'Who should move first right now.' },
      { id: 'priority_score', label: 'Priority', description: experiment._meta?.composite_formulas?.priority_score || 'Overall priority score from the experiment.' },
      { id: 'saveability_score', label: 'Saveability', description: experiment._meta?.composite_formulas?.saveability_score || 'How recoverable or worth saving this lead appears.' },
      { id: 'decay_risk_score', label: 'Decay Risk', description: experiment._meta?.composite_formulas?.decay_risk_score || 'Risk that this lead decays if not handled.' },
      { id: 'revenue_value', label: 'Revenue Value', description: 'Revenue weight in the experiment scoring model.' },
      { id: 'close_probability', label: 'Close Probability', description: 'Likelihood this lead can close.' },
      { id: 'urgency', label: 'Urgency', description: 'Time sensitivity from the experiment base score.' },
      { id: 'momentum', label: 'Momentum', description: 'Current movement and engagement strength.' },
      { id: 'relationship_strength', label: 'Relationship Strength', description: 'Relationship warmth and trust signal.' },
      { id: 'next_action_clarity', label: 'Next Action Clarity', description: 'How obvious the next sales move is.' },
      { id: 'attention_cost', label: 'Attention Cost', description: 'How expensive this lead is to work.' },
      { id: 'contactability', label: 'Contactability', description: 'Whether usable email/phone coordinates exist.' },
    ],
    rows,
  };
}

function normalizeQueueEntries(queues = {}) {
  return Object.entries(queues).flatMap(([queueId, queue]) => {
    const items = Array.isArray(queue) ? queue : (queue?.items || []);
    return items.map(item => ({
      ...item,
      queue_id: queueId,
      queue_label: queue?.label || queueId,
      queue_purpose: queue?.doctrine_purpose || '',
    }));
  });
}

function getDoctrineLatticeGraph() {
  if (!fs.existsSync(LATTICE_DOCTRINE_FILE)) {
    throw new Error(`Doctrine lattice file not found: ${LATTICE_DOCTRINE_FILE}`);
  }
  const doctrine = JSON.parse(fs.readFileSync(LATTICE_DOCTRINE_FILE, 'utf8'));
  const contacts = doctrine.contacts || [];
  const opportunities = doctrine.opportunities || [];
  const queueItems = normalizeQueueEntries(doctrine.queues || {});

  const contactsByLead = new Map();
  for (const c of contacts) {
    if (!contactsByLead.has(c.lead_id)) contactsByLead.set(c.lead_id, []);
    contactsByLead.get(c.lead_id).push(c);
  }
  const oppsByLead = new Map();
  for (const o of opportunities) {
    if (!oppsByLead.has(o.lead_id)) oppsByLead.set(o.lead_id, []);
    oppsByLead.get(o.lead_id).push(o);
  }
  const queuesByLead = new Map();
  for (const item of queueItems) {
    if (!queuesByLead.has(item.lead_id)) queuesByLead.set(item.lead_id, []);
    queuesByLead.get(item.lead_id).push(item);
  }

  const rows = (doctrine.leads || []).map(lead => {
    const leadContacts = contactsByLead.get(lead.lead_id) || [];
    const leadOpps = oppsByLead.get(lead.lead_id) || [];
    const leadQueues = queuesByLead.get(lead.lead_id) || [];
    const score = lead.sales_scoring || {};
    const action = lead.next_best_action || {};
    const hasEmail = leadContacts.some(c => (c.email_addresses || []).length);
    const hasPhone = leadContacts.some(c => (c.phone_numbers || []).length);
    const contactability = (hasEmail ? 50 : 0) + (hasPhone ? 50 : 0);
    const value = leadOpps.reduce((sum, o) => sum + Number(o.estimated_value || o.value || 0), 0)
      || Number(lead.revenue_doctrine?.estimated_deal_value || 0);
    const tastingReadiness = Number(lead.tasting_readiness?.tasting_readiness_score || 0);
    const venueCommitment = lead.venue_signal?.has_venue_locked ? 100
      : lead.venue_signal?.has_location ? 55
        : 15;
    const sourceTrust = ({ high_trust: 100, warm_contact: 78, digital_inbound: 45, unclassified: 20 })[lead.source_intelligence?.source_quality] || 25;
    const timelineUrgency = ({
      immediate: 100,
      urgent: 92,
      near_term: 78,
      planning_window: 62,
      long_horizon: 28,
      no_date: 20,
    })[lead.event_timeline?.event_urgency_tier] || 25;
    const todayTask = lead.andre_action_context?.andre_tasks_today?.length ? 100 : 0;
    const exceptionPenalty = lead.has_exceptions ? Math.min(25, (lead.exception_states || []).length * 9) : 0;
    const doctrineFit = Math.round(
      (tastingReadiness * 0.22) +
      (sourceTrust * 0.14) +
      (venueCommitment * 0.12) +
      (timelineUrgency * 0.12) +
      (Number(score.relationship_strength || 0) * 0.14) +
      (Number(score.next_action_clarity || 0) * 0.14) +
      (todayTask * 0.12) -
      exceptionPenalty
    );
    const balanced = Math.round(
      (Number(score.action_now_score || 0) * 0.24) +
      (Number(score.priority_score || 0) * 0.18) +
      (Number(score.saveability_score || 0) * 0.14) +
      (Number(score.close_probability || 0) * 0.10) +
      (Number(score.revenue_value || 0) * 0.08) +
      (doctrineFit * 0.18) +
      (contactability * 0.08) -
      (Number(score.attention_cost || 0) * 0.06)
    );
    const doctrineSignals = [
      lead.event_doctrine?.classification_source && `event: ${lead.event_doctrine.event_category} (${lead.event_doctrine.emotional_weight || 'unknown'} weight)`,
      lead.tasting_readiness?.doctrine_note,
      lead.source_intelligence?.source_doctrine_note,
      lead.venue_signal?.venue_doctrine_note,
      lead.event_timeline?.timeline_doctrine_note,
      lead.revenue_doctrine?.cash_forecast_note,
      lead.andre_action_context?.action_doctrine_note,
      lead.relationship_doctrine?.relationship_doctrine_note,
      lead.decay_doctrine?.decay_doctrine_note,
      (lead.exception_states || []).length ? `exceptions: ${lead.exception_states.join(', ')}` : '',
    ].filter(Boolean);

    return {
      lead_id: lead.lead_id,
      name: lead.display_name || lead.company_name || lead.lead_id,
      status_label: lead.lead_status || '',
      url: lead.url || null,
      value,
      contacts: leadContacts.length,
      has_email: hasEmail,
      has_phone: hasPhone,
      contactability,
      activity_volume: leadContacts.length + leadOpps.length + (lead.task_ids || []).length + leadQueues.length + doctrineSignals.length,
      tasks_open: (lead.task_ids || []).length,
      opportunities: leadOpps.length,
      queues: leadQueues.map(q => ({ id: q.queue_id, label: q.queue_label, purpose: q.queue_purpose })),
      doctrine: {
        event: lead.event_doctrine || {},
        tasting: lead.tasting_readiness || {},
        source: lead.source_intelligence || {},
        venue: lead.venue_signal || {},
        timeline: lead.event_timeline || {},
        revenue: lead.revenue_doctrine || {},
        andre_action: lead.andre_action_context || {},
        relationship: lead.relationship_doctrine || {},
        decay: lead.decay_doctrine || {},
        exceptions: lead.exception_states || [],
        contact_structure: lead.contact_structure || '',
      },
      signals: doctrineSignals.slice(0, 10).map((summary, i) => ({
        id: `${lead.lead_id}:doctrine:${i}`,
        event_type: 'doctrine_layer',
        summary,
        urgency_impact: 0,
        momentum_impact: 0,
        friction_impact: 0,
        relationship_impact: 0,
      })),
      signal_totals: {
        urgency: Number(score.urgency || 0),
        momentum: Number(score.momentum || 0),
        friction: Number(score.friction || 0),
        relationship: Number(score.relationship_strength || 0),
      },
      action: {
        next_best_action_id: `${lead.lead_id}:doctrine:${action.action_type || 'review'}`,
        target_object_id: lead.lead_id,
        action_type: action.action_type || lead.recommended_outputs?.recommended_next_action || 'review',
        title: action.title || 'Review doctrine next action',
        recommended_channel: action.channel || lead.recommended_outputs?.recommended_channel || 'review',
        human_review_required: Boolean(lead.derived_flags?.needs_human_review || lead.has_exceptions),
        reasoning: action.reasoning || '',
        sales_scoring: score,
      },
      scores: {
        balanced_lattice: balanced,
        doctrine_fit: Math.max(0, doctrineFit),
        action_now_score: Number(score.action_now_score || 0),
        priority_score: Number(score.priority_score || 0),
        saveability_score: Number(score.saveability_score || 0),
        decay_risk_score: Number(score.decay_risk_score || 0),
        urgency: Number(score.urgency || 0),
        momentum: Number(score.momentum || 0),
        friction: Number(score.friction || 0),
        relationship_strength: Number(score.relationship_strength || 0),
        close_probability: Number(score.close_probability || 0),
        revenue_value: Number(score.revenue_value || 0),
        attention_cost: Number(score.attention_cost || 0),
        next_action_clarity: Number(score.next_action_clarity || 0),
        tasting_readiness: tastingReadiness,
        venue_commitment: venueCommitment,
        source_trust: sourceTrust,
        timeline_urgency: timelineUrgency,
        today_task: todayTask,
        contactability,
        activity_volume: leadContacts.length + leadOpps.length + (lead.task_ids || []).length + leadQueues.length + doctrineSignals.length,
      },
    };
  });

  return {
    _meta: {
      generated_at: new Date().toISOString(),
      source: 'doctrine:comeketo_v2_1',
      file: LATTICE_DOCTRINE_FILE,
      doctrine_generated_at: doctrine._meta?.generated_at || null,
      lattice_version: doctrine._meta?.lattice_version || null,
      scoring_profile: doctrine._meta?.scoring_profile || null,
      business_identity: doctrine._meta?.business_identity || {},
      formulas: doctrine._meta?.composite_formulas || {},
      doctrine_layers_added: doctrine._meta?.doctrine_layers_added || [],
      invariants_checked: doctrine._meta?.invariants_checked || [],
      fixes_applied: doctrine._meta?.fixes_applied || [],
    },
    counts: {
      leads: doctrine._meta?.leads_indexed || rows.length,
      contacts: doctrine._meta?.contacts_indexed || contacts.length,
      opportunities: doctrine._meta?.opportunities_indexed || opportunities.length,
      active_pipeline_deals: doctrine._meta?.active_pipeline_deals || 0,
      active_pipeline_value: doctrine._meta?.active_pipeline_value || 0,
      queues: queueItems.length,
    },
    source_summary: {
      source_data: doctrine._meta?.source_data || {},
      weekly_briefing: doctrine.weekly_briefing || {},
      queues: Object.fromEntries(Object.entries(doctrine.queues || {}).map(([k, q]) => [k, q.count ?? q.items?.length ?? 0])),
    },
    comparators: [
      { id: 'balanced_lattice', label: 'Balanced Lattice', description: 'Action score blended with Comeketo doctrine fit and contactability.' },
      { id: 'doctrine_fit', label: 'Doctrine Fit', description: 'How strongly this lead matches Comeketo operating doctrine: tasting, trust, venue, timeline, source, and Andre task context.' },
      { id: 'action_now_score', label: 'Action Now', description: doctrine._meta?.composite_formulas?.action_now_score || 'Who should move first right now.' },
      { id: 'priority_score', label: 'Priority', description: doctrine._meta?.composite_formulas?.priority_score || 'Overall priority score.' },
      { id: 'tasting_readiness', label: 'Tasting Readiness', description: 'How close this is to Comeketo’s primary conversion engine.' },
      { id: 'decay_risk_score', label: 'Decay Risk', description: doctrine._meta?.composite_formulas?.decay_risk_score || 'Risk that this lead decays if ignored.' },
      { id: 'revenue_value', label: 'Revenue Value', description: 'Revenue weight in the scoring model.' },
      { id: 'close_probability', label: 'Close Probability', description: 'Likelihood this lead can close.' },
      { id: 'source_trust', label: 'Source Trust', description: 'Referral, expo, and partner source quality.' },
      { id: 'venue_commitment', label: 'Venue Commitment', description: 'Whether the lead has operational planning coordinates.' },
      { id: 'timeline_urgency', label: 'Timeline Urgency', description: 'Event date pressure and forward visibility.' },
      { id: 'relationship_strength', label: 'Relationship Strength', description: 'Relationship warmth and trust signal.' },
      { id: 'next_action_clarity', label: 'Next Action Clarity', description: 'How obvious the next move is.' },
      { id: 'attention_cost', label: 'Attention Cost', description: 'How expensive this lead is to work.' },
      { id: 'contactability', label: 'Contactability', description: 'Whether usable email/phone coordinates exist.' },
    ],
    rows,
  };
}

function latticeContactDefaults(leadId) {
  const row = getLatticeLead(leadId);
  const contacts = row?.contacts || [];
  const contact = contacts.find(c => c.email_addresses?.length || c.phone_numbers?.length) || contacts[0] || null;
  const rawSms = readLatticeFile('Raw_close_sms.txt', []);
  const localSms = (rawSms.find(s => s.lead_id === leadId && s.local_phone)?.local_phone)
    || (rawSms.find(s => s.local_phone)?.local_phone)
    || '';
  return {
    contact_id: contact?.contact_id || '',
    email: contact?.email_addresses?.[0] || '',
    phone: contact?.phone_numbers?.[0] || '',
    local_sms: localSms,
  };
}

function ensureHrmrStore() {
  fs.mkdirSync(HRMR_DIR, { recursive: true });
  for (const [file, fallback] of [
    ['oracle_turns.json', { turns: [] }],
    ['ratings.json', { ratings: [] }],
    ['conversation_archive.json', { conversations: [] }],
    ['index.json', { _meta: { created_at: new Date().toISOString() }, counts: {}, recent_signal: [] }],
  ]) {
    const target = path.join(HRMR_DIR, file);
    if (!fs.existsSync(target)) fs.writeFileSync(target, JSON.stringify(fallback, null, 2));
  }
}

function readHrmrFile(file, fallback) {
  try {
    ensureHrmrStore();
    return JSON.parse(fs.readFileSync(path.join(HRMR_DIR, file), 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeHrmrFile(file, value) {
  ensureHrmrStore();
  fs.writeFileSync(path.join(HRMR_DIR, file), JSON.stringify(value, null, 2));
}

function rebuildHrmrIndex() {
  const turns = readHrmrFile('oracle_turns.json', { turns: [] }).turns || [];
  const ratings = readHrmrFile('ratings.json', { ratings: [] }).ratings || [];
  const conversations = readHrmrFile('conversation_archive.json', { conversations: [] }).conversations || [];
  const gradeCounts = ratings.reduce((acc, r) => {
    acc[r.grade] = (acc[r.grade] || 0) + 1;
    return acc;
  }, {});
  const actionCounts = ratings.reduce((acc, r) => {
    const key = r.action_type || 'oracle_chat';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const noteSignals = ratings
    .filter(r => r.note)
    .slice(0, 40)
    .map(r => ({
      ts: r.created_at,
      grade: r.grade,
      note: r.note,
      action_type: r.action_type || null,
      lattice_action_id: r.lattice_action_id || null,
      lead_id: r.lead_id || null,
    }));
  const index = {
    _meta: {
      updated_at: new Date().toISOString(),
      source: 'file-tree:andre_close_focus/hrmr',
    },
    counts: {
      turns: turns.length,
      ratings: ratings.length,
      conversations: conversations.length,
      notes: ratings.filter(r => r.note).length,
      graded_lattice_actions: ratings.filter(r => r.lattice_action_id).length,
    },
    grades: gradeCounts,
    action_types: actionCounts,
    recent_signal: noteSignals,
  };
  writeHrmrFile('index.json', index);
  return index;
}

function getHrmrSummary(limit = 12) {
  const index = rebuildHrmrIndex();
  const ratings = readHrmrFile('ratings.json', { ratings: [] }).ratings || [];
  return {
    ...index,
    recent_ratings: ratings.slice(0, limit),
  };
}

function saveOracleTurnFile(row) {
  const store = readHrmrFile('oracle_turns.json', { turns: [] });
  const turns = store.turns || [];
  const idx = turns.findIndex(t => t.id === row.id);
  if (idx >= 0) turns[idx] = { ...turns[idx], ...row, updated_at: new Date().toISOString() };
  else turns.unshift(row);
  store.turns = turns.slice(0, 1000);
  store._meta = { updated_at: new Date().toISOString(), source: 'file-tree' };
  writeHrmrFile('oracle_turns.json', store);
  rebuildHrmrIndex();
  return row;
}

function writeLatticeConversationArchive(conversations) {
  try {
    fs.mkdirSync(LATTICE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(LATTICE_DIR, 'Oracle_conversations.txt'),
      JSON.stringify(conversations, null, 2)
    );
  } catch (e) {
    console.warn('[HRMR] Could not mirror Oracle conversations into lattice catalog:', e.message);
  }
}

function archiveOracleConversationFile(payload) {
  const store = readHrmrFile('conversation_archive.json', { conversations: [] });
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  const userMessages = messages.filter(m => m.role === 'user');
  const grades = assistantMessages
    .filter(m => m.oracleGrade)
    .map(m => ({
      turn_id: m.turnId || null,
      grade: m.oracleGrade,
      note: m.oracleGradeNote || null,
      action_type: m.oracleMeta?.action_type || null,
      lattice_action_id: m.oracleMeta?.lattice_action_id || null,
      lead_id: m.oracleMeta?.lead_id || null,
    }));
  const row = {
    id: payload.id || `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: payload.title || userMessages[0]?.content?.slice(0, 90) || 'Oracle conversation',
    archived_at: new Date().toISOString(),
    operator_key: payload.operator_key || 'andre',
    source: payload.source || 'oracle_thread_archive',
    message_count: messages.length,
    user_message_count: userMessages.length,
    assistant_message_count: assistantMessages.length,
    grade_count: grades.length,
    lattice_action_ids: Array.from(new Set(messages.map(m => m.oracleMeta?.lattice_action_id).filter(Boolean))),
    lead_ids: Array.from(new Set(messages.map(m => m.oracleMeta?.lead_id).filter(Boolean))),
    grades,
    messages,
  };
  store.conversations = [row, ...(store.conversations || [])].slice(0, 500);
  store._meta = { updated_at: row.archived_at, source: 'file-tree' };
  writeHrmrFile('conversation_archive.json', store);
  writeLatticeConversationArchive(store.conversations);
  rebuildHrmrIndex();
  return row;
}

function saveHrmrRatingFile(row) {
  const store = readHrmrFile('ratings.json', { ratings: [] });
  store.ratings = [row, ...(store.ratings || [])].slice(0, 2000);
  store._meta = { updated_at: new Date().toISOString(), source: 'file-tree' };
  writeHrmrFile('ratings.json', store);
  rebuildHrmrIndex();
  return row;
}

function readSettings() {
  const base = defaultSettings();
  for (const file of [SETTINGS_FILE, SETTINGS_LOCAL_FILE]) {
    const target = path.join(DATA, file);
    if (!fs.existsSync(target)) continue;
    try {
      deepMerge(base, JSON.parse(fs.readFileSync(target, 'utf8')));
    } catch(e) {
      console.warn(`[SETTINGS] Failed to read ${file}:`, e.message);
    }
  }
  if (!base.ai?.openai_api_key && process.env.OPENAI_API_KEY) {
    base.ai.openai_api_key = process.env.OPENAI_API_KEY;
  }
  base.ai.enabled = Boolean(base.ai.openai_api_key);
  return base;
}

function writeSettings(updates) {
  const next = deepMerge(readSettings(), updates || {});
  next.ai.enabled = Boolean(next.ai.openai_api_key);
  next._meta = { ...(next._meta || {}), version: 2, last_updated: new Date().toISOString() };
  writeData(SETTINGS_LOCAL_FILE, next);
  return next;
}

function getCloseUserId() {
  return readSettings().crm?.close_user_id || CLOSE_USER_ID || '';
}

function normText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function daysUntil(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function fallbackOpportunityUrgency(opp) {
  const value = Number(opp.value || 0);
  const confidence = Number(opp.confidence || 0);
  const days = daysUntil(opp.event_date || opp.close_date || opp.close_at);
  if (value >= 10000 && (confidence >= 80 || (days != null && days <= 7))) return 'urgent';
  if (value >= 5000) return 'high';
  if (confidence > 0 && confidence < 50) return 'medium';
  return 'low';
}

function fallbackTaskUrgency(task) {
  const cls = liveSync.classifyTaskText(task.text || '');
  if (cls.is_admin || cls.task_type === 'follow_up') return 'low';
  const days = daysUntil(task.date || task.due_at);
  if (days == null) return 'low';
  if (days <= 0) return 'urgent';
  if (days <= 2) return 'high';
  if (days <= 7) return 'medium';
  return 'low';
}

async function closePaginate(endpoint, { limit = 100, safety = 50 } = {}) {
  const rows = [];
  let cursor = null;
  let remaining = safety;
  do {
    const joiner = endpoint.includes('?') ? '&' : '?';
    const cursorParam = cursor ? `&_cursor=${encodeURIComponent(cursor)}` : '';
    const r = await closeRequest('GET', `${endpoint}${joiner}_limit=${limit}${cursorParam}`);
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`Close ${endpoint} returned ${r.status}`);
    }
    rows.push(...(r.body?.data || []));
    cursor = r.body?.cursor || null;
    remaining -= 1;
  } while (cursor && remaining > 0);
  return rows;
}

function defaultAutomationState() {
  return {
    _meta: {
      description: 'Always-on automation engine state for the sales command center',
      created_at: new Date().toISOString(),
      last_tick: null,
    },
    engine: {
      active: true,
      last_tick: null,
      last_error: null,
    },
    automations: [
      { id: 'close_sync_pulse', name: 'Close Sync Pulse', interval_minutes: 15, last_run: null, last_status: 'idle', last_summary: 'Waiting for first run' },
      { id: 'critical_exception_watch', name: 'Critical Exception Watch', interval_minutes: 20, last_run: null, last_status: 'idle', last_summary: 'Waiting for first run' },
      { id: 'attention_followup_sweep', name: 'Attention Follow-up Sweep', interval_minutes: 30, last_run: null, last_status: 'idle', last_summary: 'Waiting for first run' },
      { id: 'closing_window_sweep', name: 'Closing Window Sweep', interval_minutes: 45, last_run: null, last_status: 'idle', last_summary: 'Waiting for first run' },
      { id: 'cadence_watch', name: 'Cadence Watch', interval_minutes: 60, last_run: null, last_status: 'idle', last_summary: 'Waiting for first run' },
      { id: 'brief_refresh', name: 'Brief Refresh', interval_minutes: 120, last_run: null, last_status: 'idle', last_summary: 'Waiting for first run' },
    ],
    runs: [],
  };
}

function ensureAutomationState() {
  const target = path.join(DATA, AUTOMATION_STATE_FILE);
  if (!fs.existsSync(target)) writeData(AUTOMATION_STATE_FILE, defaultAutomationState());
}

function readAutomationState() {
  ensureAutomationState();
  const state = readData(AUTOMATION_STATE_FILE);
  const defaults = defaultAutomationState();
  const existing = new Map((state.automations || []).map(a => [a.id, a]));
  state.automations = defaults.automations.map(def => ({ ...def, ...(existing.get(def.id) || {}) }));
  state.runs = state.runs || [];
  state.engine = { ...defaults.engine, ...(state.engine || {}) };
  state._meta = { ...defaults._meta, ...(state._meta || {}) };
  return state;
}

function writeAutomationState(state) {
  writeData(AUTOMATION_STATE_FILE, state);
}

function setAutomationRun(id, status, summary, extra = {}) {
  const state = readAutomationState();
  const target = state.automations.find(a => a.id === id);
  const now = new Date().toISOString();
  if (target) {
    target.last_run = now;
    target.last_status = status;
    target.last_summary = summary;
  }
  state.engine.last_tick = now;
  state.runs.unshift({ id, status, summary, at: now, ...extra });
  state.runs = state.runs.slice(0, 40);
  writeAutomationState(state);
}

function minutesBetween(a, b) {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

function shouldRunAutomation(def, nowIso) {
  if (!def.last_run) return true;
  return minutesBetween(def.last_run, nowIso) >= (def.interval_minutes || 60);
}

function actionTimestamp(action) {
  return action.completed_at || action.queued_at || action.at || null;
}

function hasRecentMatchingAction(queue, type, matcher, withinMinutes = 240) {
  const now = Date.now();
  const pool = [...(queue.pending || []), ...(queue.completed || []), ...(queue.log || [])];
  return pool.some(action => {
    if (action.type !== type) return false;
    if (!matcher(action.payload || {}, action)) return false;
    const ts = actionTimestamp(action);
    if (!ts) return false;
    return now - new Date(ts).getTime() <= withinMinutes * 60000;
  });
}

function queueSignature(action) {
  const payload = action?.payload || {};
  if (action?.type === 'create_clickup_task' || action?.type === 'draft_close_crm_followup' || action?.type === 'prepare_critical_alert_review') {
    return `${action.type}:${payload.lead_id || payload.name || 'unknown'}`;
  }
  if (action?.type === 'generate_morning_brief' || action?.type === 'check_cadences_due') {
    return `${action.type}:${payload.date || 'today'}`;
  }
  if (action?.type === 'sync_close_crm_pipeline' || action?.type === 'full_pipeline_sync') {
    return `${action.type}:global`;
  }
  return `${action?.type || 'unknown'}:${JSON.stringify(payload)}`;
}

function sanitizeActionQueue(queue) {
  let changed = false;
  const latestCompleted = new Map();
  for (const item of queue.completed || []) {
    const sig = queueSignature(item);
    const ts = new Date(actionTimestamp(item) || 0).getTime();
    const existing = latestCompleted.get(sig);
    if (!existing || ts > existing.ts) latestCompleted.set(sig, { ts, item });
  }

  const latestPending = new Map();
  for (const item of queue.pending || []) {
    const sig = queueSignature(item);
    const ts = new Date(actionTimestamp(item) || 0).getTime();
    const existing = latestPending.get(sig);
    if (!existing || ts > existing.ts) latestPending.set(sig, { ts, item });
  }

  const normalizedPending = [];
  for (const item of queue.pending || []) {
    const sig = queueSignature(item);
    const itemTs = new Date(actionTimestamp(item) || 0).getTime();
    const newestPending = latestPending.get(sig);
    if (newestPending && newestPending.item.id !== item.id) {
      changed = true;
      continue;
    }
    const completed = latestCompleted.get(sig);
    if (completed && completed.ts >= itemTs) {
      changed = true;
      continue;
    }
    normalizedPending.push(item);
  }

  queue.pending = normalizedPending;
  return changed;
}

// ─── App surface map (AI / automation selectors) ───
app.get('/app/surface', (req, res) => {
  const surfacePath = path.join(__dirname, 'data', 'app_surface.json');
  try {
    if (!fs.existsSync(surfacePath)) {
      return res.status(404).json({ error: 'app_surface.json not found' });
    }
    res.type('application/json').send(fs.readFileSync(surfacePath, 'utf8'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Serve data files ───────────────────────────────
app.get('/data/:file', (req, res) => {
  if (PRIVATE_DATA_FILES.has(req.params.file)) {
    return res.status(403).json({ error: 'Private file' });
  }
  const p = path.join(DATA, req.params.file);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Not found' });
  res.json(readData(req.params.file));
});

// ═══════════════════════════════════════════════════
// CLOSE CRM DIRECT ROUTES
// ═══════════════════════════════════════════════════

// ─── GET /close/me — verify API key ─────────────────
app.get('/close/me', async (req, res) => {
  try {
    const r = await closeRequest('GET', '/me/');
    res.json({ ok: r.status === 200, user: r.body });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

function taskIconForType(type) {
  return {
    call: 'call',
    email: 'mail',
    sms: 'sms',
    meeting: 'event',
    follow_up: 'reply',
    admin: 'task_alt',
    other: 'check_circle',
  }[type] || 'check_circle';
}

function buildPipelineShapeFromClose(opportunities) {
  const rows = (opportunities || []).map(o => {
    const value = o.value != null ? Math.round(Number(o.value || 0) / 100) : 0;
    const statusType = liveSync.normalizeStatusType(o.status_type, o.status_label);
    const deal = {
      id: o.id,
      lead_id: o.lead_id,
      name: o.lead_name || 'Unknown',
      value,
      stage: o.status_label || '',
      event: '',
      venue: '',
      guests: '',
      confidence: Number(o.confidence || 0),
      priority: 'low',
      urgency: 'low',
      status: statusType,
      risk: [],
      close_at: o.close_at || null,
      event_date: o.close_at || null,
      updated_at: o.date_updated || null,
      created_at: o.date_created || null,
    };
    deal.urgency = fallbackOpportunityUrgency(deal);
    deal.priority = deal.urgency === 'urgent' ? 'high' : deal.urgency;
    deal.risk = deal.confidence > 0 && deal.confidence < 50 ? ['low confidence'] : [];
    return deal;
  });

  const active = rows.filter(d => d.status === 'active');
  const won = rows.filter(d => d.status === 'won');
  const lost = rows.filter(d => d.status === 'lost');
  const sumValue = arr => arr.reduce((sum, d) => sum + Number(d.value || 0), 0);
  const stageMap = new Map();
  for (const d of active) {
    const label = d.stage || 'Unstaged';
    if (!stageMap.has(label)) stageMap.set(label, { label, count: 0, value: 0, color: '#A8D8EA', emoji: '🔹' });
    const stage = stageMap.get(label);
    stage.count += 1;
    stage.value += d.value || 0;
  }

  const all_deals = active.sort((a, b) => (b.value || 0) - (a.value || 0));
  const priority_distribution = { high: 0, medium: 0, low: 0 };
  for (const d of all_deals) {
    if (d.urgency === 'urgent' || d.urgency === 'high') priority_distribution.high += 1;
    else if (d.urgency === 'medium') priority_distribution.medium += 1;
    else priority_distribution.low += 1;
  }
  const lowConf = all_deals.filter(d => d.confidence > 0 && d.confidence < 50).length;
  const noEventDate = all_deals.filter(d => !d.event_date).length;
  const risk_patterns = [];
  if (lowConf) risk_patterns.push({ flag: 'Low confidence (<50%)', count: lowConf, severity: 'warning' });
  if (noEventDate) risk_patterns.push({ flag: 'No event date set', count: noEventDate, severity: 'info' });

  return {
    summary: {
      total_pipeline: sumValue(active),
      total_deals: active.length,
      avg_deal_value: active.length ? Math.round(sumValue(active) / active.length) : 0,
      locked_in_revenue: sumValue(won),
      at_risk_revenue: sumValue(active.filter(d => d.confidence > 0 && d.confidence < 50)),
      largest_deal: Math.max(0, ...active.map(d => Number(d.value || 0))),
      won_count: won.length,
      lost_count: lost.length,
    },
    stages: Array.from(stageMap.values()).sort((a, b) => b.value - a.value),
    priority_distribution,
    risk_patterns,
    high_value_deals: all_deals.slice(0, 12),
    all_deals,
    _meta: {
      source: 'close-api:file-tree',
      generated_at: new Date().toISOString(),
      note: 'Andre-focused file-backed pipeline. Supabase is optional, not required.',
    },
  };
}

function buildTasksShapeFromClose(tasks) {
  const buckets = { today: [], within_48h: [], within_3_7d: [], watch_list: [] };
  for (const t of (tasks || [])) {
    if (t.is_complete) continue;
    const cls = liveSync.classifyTaskText(t.text || '');
    const days = daysUntil(t.date || t.due_at);
    const urgency = fallbackTaskUrgency(t);
    const item = {
      id: t.id,
      lead: t.lead_name || 'Unknown',
      lead_id: t.lead_id || null,
      value: null,
      action: t.text || '',
      category: cls.task_type,
      task_type: cls.task_type,
      is_admin: cls.is_admin,
      urgency,
      icon: taskIconForType(cls.task_type),
      due_at: t.date || t.due_at || null,
      days_until: days,
    };
    if (days == null || days > 7) buckets.watch_list.push(item);
    else if (days <= 0) buckets.today.push(item);
    else if (days <= 2) buckets.within_48h.push(item);
    else buckets.within_3_7d.push(item);
  }
  const rank = { urgent: 0, high: 1, medium: 2, low: 3 };
  Object.values(buckets).forEach(bucket => bucket.sort((a, b) =>
    (rank[a.urgency] ?? 9) - (rank[b.urgency] ?? 9) || ((a.days_until ?? 999) - (b.days_until ?? 999))
  ));
  return {
    task_summary: {
      total: buckets.today.length + buckets.within_48h.length + buckets.within_3_7d.length + buckets.watch_list.length,
      today: buckets.today.length,
      within_48h: buckets.within_48h.length,
      within_3_7d: buckets.within_3_7d.length,
      watch_list: buckets.watch_list.length,
    },
    tasks: buckets,
    bottlenecks: [],
    open_loops: [],
    coaching_plan: {},
    automation_hooks: {},
    _meta: {
      source: 'close-api:file-tree',
      generated_at: new Date().toISOString(),
      note: 'Andre-focused file-backed task intelligence. Supabase is optional, not required.',
    },
  };
}

function buildLiveSnapshotFromPipeline(pipeline, syncSource) {
  const all = pipeline.all_deals || [];
  const now = Date.now();
  const sevenDays = now + 7 * 24 * 60 * 60 * 1000;
  const closing_soon = all
    .filter(d => d.close_at && new Date(d.close_at).getTime() >= now && new Date(d.close_at).getTime() <= sevenDays)
    .slice(0, 50)
    .map(d => ({
      id: d.id,
      lead_id: d.lead_id,
      name: d.name,
      value: d.value,
      stage: d.stage,
      confidence: d.confidence,
      close_at: d.close_at,
      days_until_close: daysUntil(d.close_at),
      urgency: d.urgency,
      note: `${d.confidence || 0}% confidence - ${d.stage || ''}`,
    }));
  const needs_attention = all
    .filter(d => d.urgency === 'urgent' || d.urgency === 'high' || (d.confidence > 0 && d.confidence < 50))
    .slice(0, 50)
    .map(d => ({
      id: d.id,
      lead_id: d.lead_id,
      name: d.name,
      value: d.value,
      stage: d.stage,
      confidence: d.confidence,
      close_at: d.close_at,
      urgency: d.urgency,
      reason: d.confidence > 0 && d.confidence < 50 ? 'Low confidence - at risk' : 'High-priority active opportunity',
    }));
  const top_opportunities = all.slice(0, 10).map(d => ({
    id: d.id,
    lead_id: d.lead_id,
    name: d.name,
    value: d.value,
    stage: d.stage,
    confidence: d.confidence,
    close_at: d.close_at,
  }));
  return {
    _meta: {
      last_synced: new Date().toISOString(),
      synced_by: syncSource,
      source: 'close-api:file-tree',
    },
    pipeline_snapshot: {
      total_active_opportunities: pipeline.summary?.total_deals || all.length,
      needs_attention_count: needs_attention.length,
      closing_this_week: closing_soon.length,
      top_deal_value: top_opportunities[0]?.value || 0,
      top_deal_name: top_opportunities[0]?.name || '—',
    },
    needs_attention,
    closing_soon,
    top_opportunities,
    alerts: [],
    verification: {
      checked_at: new Date().toISOString(),
      status: 'ok',
      metric: 'close_api_file_tree',
      coverage_pct: 100,
      notes: ['Close direct file-tree source is active. Supabase is not required for this path.'],
    },
  };
}

function buildAndreFocusFromFileShapes(pipeline, tasks, live) {
  const defs = readDataIfExists('andre_close_focus/view_definitions.json', { views: [] });
  const all = pipeline.all_deals || [];
  const taskLeadIdsDueToday = new Set((tasks.tasks?.today || []).map(t => t.lead_id).filter(Boolean));
  const buckets = {
    todays_leads: [],
    day_1_5_cadence: [],
    day_6_10_cadence: [],
    opened_email_24h: [],
    no_connect_made: [],
    needs_response: [],
    booked_tastings: [],
    long_term_dormant: [],
    all_dormant: [],
    all_other_followup: [],
  };
  const toItem = (d, reason) => ({
    id: d.id,
    lead_id: d.lead_id,
    name: d.name,
    value: d.value || 0,
    stage: d.stage || '',
    confidence: d.confidence || 0,
    urgency: d.urgency || 'low',
    close_at: d.close_at || null,
    updated_at: d.updated_at || null,
    reason,
  });
  for (const d of all) {
    const stage = normText(d.stage || '');
    const age = d.created_at ? Math.floor((Date.now() - new Date(d.created_at).getTime()) / (1000 * 60 * 60 * 24)) : null;
    if (taskLeadIdsDueToday.has(d.lead_id)) buckets.todays_leads.push(toItem(d, 'Open task due today'));
    if (age != null && age >= 1 && age <= 5) buckets.day_1_5_cadence.push(toItem(d, `Lead age ${age} days`));
    if (age != null && age >= 6 && age <= 10) buckets.day_6_10_cadence.push(toItem(d, `Lead age ${age} days`));
    if (stage.includes('booked for tasting') || stage.includes('setting')) buckets.booked_tastings.push(toItem(d, 'Tasting-stage opportunity'));
    if (stage.includes('dormant')) {
      buckets.long_term_dormant.push(toItem(d, 'Dormant stage'));
      buckets.all_dormant.push(toItem(d, 'Explicit dormant stage'));
    }
  }
  for (const d of live.needs_attention || []) buckets.needs_response.push(toItem(d, d.reason || 'Needs attention'));
  const claimed = new Set(Object.values(buckets).flat().map(item => item.id));
  buckets.all_other_followup = all
    .filter(d => !claimed.has(d.id))
    .map(d => toItem(d, 'Active follow-up not captured by a more specific Andre focus bucket'));

  const labels = Object.fromEntries((defs.views || []).map(v => [v.id, v.label]));
  const order = (defs.views || []).map(v => v.id).filter(id => buckets[id]);
  for (const id of Object.keys(buckets)) if (!order.includes(id)) order.push(id);
  return {
    _meta: {
      source: 'close-api:file-tree-andre-focus',
      generated_at: new Date().toISOString(),
      note: 'Focused Andre source pack generated from Close direct file-backed pipeline/tasks.',
    },
    views: order.map(id => {
      const items = (buckets[id] || []).sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 150);
      return {
        id,
        label: labels[id] || id,
        count: items.length,
        total_value: items.reduce((sum, item) => sum + Number(item.value || 0), 0),
        items,
      };
    }),
  };
}

async function refreshLiveCloseSnapshotFromCloseFiles(syncSource) {
  const closeUserId = getCloseUserId();
  if (!closeUserId) throw new Error('Close CRM user ID is not configured. Add it in Settings.');
  const uid = encodeURIComponent(closeUserId);
  console.log('[SYNC] Starting Close direct file-tree sync...');
  logActivity('sync', 'crm_sync', 'Close direct file-tree sync started', `Source: ${syncSource}`, []);

  const fields = [
    'id','lead_id','lead_name','status_id','status_label','status_type',
    'pipeline_id','value','value_period','confidence',
    'date_won','date_lost','close_at','date_created','date_updated','note',
  ].join(',');
  const [opportunities, inboxTasks, futureTasks] = await Promise.all([
    closePaginate(`/opportunity/?user_id=${uid}&lead_status_type=active&_fields=${fields}&_order_by=-value`, { limit: 100, safety: 50 }),
    closePaginate(`/task/?view=inbox&assigned_to=${uid}&_order_by=date`, { limit: 100, safety: 10 }),
    closePaginate(`/task/?view=future&assigned_to=${uid}&_order_by=date`, { limit: 100, safety: 10 }),
  ]);

  const pipeline = buildPipelineShapeFromClose(opportunities);
  const tasks = buildTasksShapeFromClose([
    ...inboxTasks.map(t => ({ ...t, _view: 'inbox' })),
    ...futureTasks.map(t => ({ ...t, _view: 'future' })),
  ]);
  const live = buildLiveSnapshotFromPipeline(pipeline, syncSource);
  const andreFocus = buildAndreFocusFromFileShapes(pipeline, tasks, live);

  writeData('live_pipeline.json', pipeline);
  writeData('live_tasks.json', tasks);
  writeData('live_close_crm.json', live);
  const focusDir = path.join(DATA, 'andre_close_focus');
  fs.mkdirSync(focusDir, { recursive: true });
  fs.writeFileSync(path.join(focusDir, 'snapshot.json'), JSON.stringify(andreFocus, null, 2));

  return {
    ok: true,
    mode: 'close-direct-file-tree',
    synced_at: live._meta.last_synced,
    counts: live.pipeline_snapshot,
    details: {
      opportunities: { ok: true, count: opportunities.length },
      tasks: { ok: true, count: tasks.task_summary.total },
      activities: { ok: true, count: 0 },
    },
  };
}

// ─── POST /close/sync — full pipeline sync ──────────
// Default path: pull from Close and write focused file-tree snapshots.
// Optional path: when CRM_SOURCE=supabase, sync to Supabase and mirror
// back to files so SSE + legacy consumers keep working.
async function refreshLiveCloseSnapshot(syncSource) {
  const closeUserId = getCloseUserId();
  if (!closeUserId) throw new Error('Close CRM user ID is not configured. Add it in Settings.');
  if (CRM_SOURCE !== 'supabase') {
    return refreshLiveCloseSnapshotFromCloseFiles(syncSource);
  }
  if (!sb.isConfigured()) {
    return refreshLiveCloseSnapshotFromCloseFiles(`${syncSource} (Supabase not configured)`);
  }
  console.log('[SYNC] Starting Close → Supabase sync...');
  logActivity('sync', 'crm_sync', 'Close → Supabase sync started', `Source: ${syncSource}`, []);
  try {
    // 1) Pull from Close, write to Supabase
    const result = await liveSync.runFullLiveSync({
      closeApiKey: CLOSE_API_KEY,
      closeUserId,
    });

    // 2) Read the live snapshot shape back from Supabase
    const live = await liveQ.getLiveSnapshotShape({ operatorKey: 'andre' });
    const andreFocus = await liveQ.getAndreFocusShape({ operatorKey: 'andre' });

    // 3) Mirror to live_close_crm.json for SSE + legacy consumers
    try { writeData('live_close_crm.json', live); } catch(e) { console.warn('[SYNC] mirror to live_close_crm.json failed:', e.message); }
    try {
      const focusDir = path.join(DATA, 'andre_close_focus');
      fs.mkdirSync(focusDir, { recursive: true });
      fs.writeFileSync(path.join(focusDir, 'snapshot.json'), JSON.stringify(andreFocus, null, 2));
    } catch(e) {
      console.warn('[SYNC] mirror to andre_close_focus/snapshot.json failed:', e.message);
    }

    const now = new Date();
    console.log(`[SYNC] Done — ${result.results?.opportunities?.count || 0} opps, ${result.results?.tasks?.count || 0} tasks, ${result.results?.activities?.count || 0} activities`);
    return {
      ok: true,
      synced_at: now.toISOString(),
      counts: live.pipeline_snapshot,
      details: result.results,
    };
  } catch(e) {
    const canUseFileTreeFallback = /Invalid schema|schema cache|Could not find the table|Supabase/.test(e.message || '');
    if (!canUseFileTreeFallback) {
      console.error('[SYNC] Error:', e.message);
      throw e;
    }
    console.warn('[SYNC] Supabase unavailable; switching to Close direct file-tree source:', e.message);
    return refreshLiveCloseSnapshotFromCloseFiles(syncSource);
  }
}

app.post('/close/sync', async (req, res) => {
  try {
    const result = await refreshLiveCloseSnapshot('server.js direct API');
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /close/lead/:id — fetch a single lead ──────
app.get('/close/lead/:id', async (req, res) => {
  try {
    const r = await closeRequest('GET', `/lead/${req.params.id}/`);
    res.json(r.body);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── GET /close/lead/:id/activity — recent activity ─
app.get('/close/lead/:id/activity', async (req, res) => {
  try {
    const r = await closeRequest('GET', `/activity/?lead_id=${req.params.id}&_limit=20&_order_by=-date_created`);
    res.json(r.body);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── POST /close/lead/:id/note — log a note ─────────
app.post('/close/lead/:id/note', async (req, res) => {
  try {
    const r = await closeRequest('POST', '/activity/note/', {
      lead_id: req.params.id,
      note:    req.body.note
    });
    res.json({ ok: r.status === 200, activity: r.body });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── POST /close/lead/:id/status — update lead status
app.post('/close/lead/:id/status', async (req, res) => {
  try {
    const r = await closeRequest('PUT', `/lead/${req.params.id}/`, {
      status_id: req.body.status_id
    });
    res.json({ ok: r.status === 200, lead: r.body });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── POST /close/opportunity/:id/status ─────────────
app.post('/close/opportunity/:id/status', async (req, res) => {
  try {
    const r = await closeRequest('PUT', `/opportunity/${req.params.id}/`, {
      status_id: req.body.status_id,
      ...(req.body.note ? { note: req.body.note } : {})
    });
    res.json({ ok: r.status === 200, opportunity: r.body });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

function closeApiErrorMessage(body) {
  if (!body || typeof body !== 'object') return 'Close API error';
  if (typeof body.error === 'string') return body.error;
  if (body.error && typeof body.error === 'object' && body.error.message) return body.error.message;
  if (body['field-errors']) return JSON.stringify(body['field-errors']);
  return 'Close API error';
}

async function messagingSenderEmail() {
  const settings = readSettings();
  const configured = (settings.messaging?.email_from || settings.operator?.email || '').trim();
  if (configured) return configured;
  try {
    const r = await closeRequest('GET', '/me/');
    return (r.body?.email || '').trim();
  } catch (_) {
    return '';
  }
}

function messagingSmsFrom() {
  return (readSettings().messaging?.sms_from || '').trim();
}

// ─── POST /close/lead/:leadId/email — draft or send via Close (activity/email)
// https://developer.close.com/api/resources/activities/
app.post('/close/lead/:leadId/email', async (req, res) => {
  try {
    const leadId = req.params.leadId;
    const userId = getCloseUserId();
    if (!userId) return res.status(400).json({ error: 'Close CRM user ID is not configured. Add it in Settings.' });
    if (!CLOSE_API_KEY) return res.status(400).json({ error: 'CLOSE_API_KEY is not configured on the server.' });

    const {
      subject,
      body_text,
      body_html,
      to,
      contact_id,
      status,
      sender,
    } = req.body || {};

    const defaults = latticeContactDefaults(leadId);
    const toList = Array.isArray(to) ? to.filter(Boolean) : (to ? [to] : (defaults.email ? [defaults.email] : []));
    if (!toList.length) return res.status(400).json({ error: 'Provide at least one recipient email in `to`.' });

    const sendStatus = status === 'draft' ? 'draft' : 'outbox';
    const senderAddr = (sender || await messagingSenderEmail()).trim();
    if (sendStatus === 'outbox' && !senderAddr) {
      return res.status(400).json({
        error: 'Outbound email needs a `sender` address. Set "Email from" under Messaging in Settings, or pass `sender` in the request.',
      });
    }

    const payload = {
      lead_id: leadId,
      direction: 'outgoing',
      status: sendStatus,
      user_id: userId,
      to: toList,
      subject: subject || '(no subject)',
      body_text: body_text != null ? String(body_text) : '',
      ...(body_html ? { body_html: String(body_html) } : {}),
      ...(contact_id || defaults.contact_id ? { contact_id: contact_id || defaults.contact_id } : {}),
      ...(senderAddr ? { sender: senderAddr } : {}),
    };

    const r = await closeRequest('POST', '/activity/email/', payload);
    if (r.status < 200 || r.status >= 300) {
      return res.status(r.status >= 400 ? r.status : 502).json({ error: closeApiErrorMessage(r.body) });
    }

    logActivity(
      'sync',
      sendStatus === 'outbox' ? 'close_email_sent' : 'close_email_draft',
      sendStatus === 'outbox' ? `Email sent via Close` : `Email draft saved in Close`,
      `${subject || '(no subject)'} → ${toList.join(', ')}`,
      []
    );
    res.json({ ok: true, email: r.body });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /close/lead/:leadId/sms — draft or send via Close (activity/sms)
app.post('/close/lead/:leadId/sms', async (req, res) => {
  try {
    const leadId = req.params.leadId;
    const userId = getCloseUserId();
    if (!userId) return res.status(400).json({ error: 'Close CRM user ID is not configured. Add it in Settings.' });
    if (!CLOSE_API_KEY) return res.status(400).json({ error: 'CLOSE_API_KEY is not configured on the server.' });

    const { text, remote_phone, local_phone, contact_id, status } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: '`text` is required.' });
    const defaults = latticeContactDefaults(leadId);
    const remote = (remote_phone || defaults.phone || '').trim();
    if (!remote) {
      return res.status(400).json({ error: '`remote_phone` is required (buyer number, E.164 recommended).' });
    }

    const sendStatus = status === 'draft' ? 'draft' : 'outbox';
    const local = (local_phone || messagingSmsFrom() || defaults.local_sms).trim();
    if (sendStatus === 'outbox' && !local) {
      return res.status(400).json({
        error: 'Outbound SMS needs `local_phone` (your Close internal sending number). Set "SMS from" in Settings or pass `local_phone`.',
      });
    }

    const payload = {
      lead_id: leadId,
      direction: 'outbound',
      status: sendStatus,
      user_id: userId,
      text: String(text).trim(),
      remote_phone: remote,
      ...(local ? { local_phone: local } : {}),
      ...(contact_id || defaults.contact_id ? { contact_id: contact_id || defaults.contact_id } : {}),
    };

    const r = await closeRequest('POST', '/activity/sms/', payload);
    if (r.status < 200 || r.status >= 300) {
      return res.status(r.status >= 400 ? r.status : 502).json({ error: closeApiErrorMessage(r.body) });
    }

    logActivity(
      'sync',
      sendStatus === 'outbox' ? 'close_sms_sent' : 'close_sms_draft',
      sendStatus === 'outbox' ? `SMS sent via Close` : `SMS draft saved in Close`,
      String(text).substring(0, 120) + (String(text).length > 120 ? '…' : ''),
      []
    );
    res.json({ ok: true, sms: r.body });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function closeListData(resp) {
  if (!resp || resp.status < 200 || resp.status >= 300 || !resp.body) return [];
  return Array.isArray(resp.body.data) ? resp.body.data : [];
}

async function sweepCloseLeadIntel({ leadId, query, source }) {
  if (!CLOSE_API_KEY) throw new Error('CLOSE_API_KEY is not configured on the server.');
  let resolvedLeadId = leadId;
  let searchResults = [];

  if (!resolvedLeadId && query) {
    const q = encodeURIComponent(String(query).trim());
    const sr = await closeRequest('GET', `/lead/?query=${q}&_limit=8`);
    searchResults = closeListData(sr);
    resolvedLeadId = searchResults[0]?.id || '';
  }
  if (!resolvedLeadId) throw new Error('No Close lead id found. Pass lead_id or a searchable lead name.');

  const encoded = encodeURIComponent(resolvedLeadId);
  const [leadResp, oppResp, taskResp, emailResp, smsResp, callResp, noteResp] = await Promise.all([
    closeRequest('GET', `/lead/${encoded}/`),
    closeRequest('GET', `/opportunity/?lead_id=${encoded}&_limit=30&_order_by=-date_updated`),
    closeRequest('GET', `/task/?lead_id=${encoded}&_limit=40&_order_by=date`),
    closeRequest('GET', `/activity/email/?lead_id=${encoded}&_limit=25&_order_by=-date_created`),
    closeRequest('GET', `/activity/sms/?lead_id=${encoded}&_limit=25&_order_by=-date_created`),
    closeRequest('GET', `/activity/call/?lead_id=${encoded}&_limit=25&_order_by=-date_created`),
    closeRequest('GET', `/activity/note/?lead_id=${encoded}&_limit=25&_order_by=-date_created`),
  ]);

  const lead = leadResp.body || {};
  const contacts = Array.isArray(lead.contacts) ? lead.contacts : [];
  const emails = closeListData(emailResp);
  const sms = closeListData(smsResp);
  const calls = closeListData(callResp);
  const notes = closeListData(noteResp);
  const tasks = closeListData(taskResp);
  const opportunities = closeListData(oppResp);

  const packet = {
    _meta: {
      source: source || 'on-demand-close-sweep',
      generated_at: new Date().toISOString(),
      query: query || null,
      resolved_lead_id: resolvedLeadId,
    },
    lead,
    search_results: searchResults.map(l => ({ id: l.id, name: l.name, display_name: l.display_name, status_label: l.status_label })),
    contacts,
    opportunities,
    tasks,
    activities: {
      emails,
      sms,
      calls,
      notes,
    },
    counts: {
      contacts: contacts.length,
      opportunities: opportunities.length,
      tasks: tasks.length,
      emails: emails.length,
      sms: sms.length,
      calls: calls.length,
      notes: notes.length,
    },
    summary: {
      name: lead.display_name || lead.name || searchResults[0]?.display_name || query || resolvedLeadId,
      status: lead.status_label || lead.status_id || 'unknown',
      primary_email: contacts.flatMap(c => c.emails || []).map(e => e.email).filter(Boolean)[0] || '',
      primary_phone: contacts.flatMap(c => c.phones || []).map(p => p.phone).filter(Boolean)[0] || '',
      latest_email: emails[0]?.subject || emails[0]?.body_preview || '',
      latest_sms: sms[0]?.text || '',
      latest_call: calls[0]?.date_created || calls[0]?.activity_at || '',
      latest_note: notes[0]?.note || '',
      next_task: tasks.find(t => !t.is_complete)?.text || '',
    },
  };

  const sweepDir = path.join(DATA, 'andre_close_focus', 'on_demand_sweeps');
  fs.mkdirSync(sweepDir, { recursive: true });
  fs.writeFileSync(path.join(sweepDir, `${resolvedLeadId}.json`), JSON.stringify(packet, null, 2));
  try {
    fs.mkdirSync(LATTICE_DIR, { recursive: true });
    const sweepIndexPath = path.join(LATTICE_DIR, 'On_demand_close_sweeps.txt');
    const previous = fs.existsSync(sweepIndexPath) ? JSON.parse(fs.readFileSync(sweepIndexPath, 'utf8')) : [];
    const slim = {
      lead_id: resolvedLeadId,
      name: packet.summary.name,
      generated_at: packet._meta.generated_at,
      counts: packet.counts,
      summary: packet.summary,
      file: `data/andre_close_focus/on_demand_sweeps/${resolvedLeadId}.json`,
    };
    const next = [slim, ...previous.filter(x => x.lead_id !== resolvedLeadId)].slice(0, 200);
    fs.writeFileSync(sweepIndexPath, JSON.stringify(next, null, 2));
  } catch (e) {
    console.warn('[CLOSE SWEEP] Could not mirror sweep index into lattice catalog:', e.message);
  }
  logActivity('sync', 'close_lead_sweep', `Close lead swept: ${packet.summary.name}`, `${packet.counts.emails} emails · ${packet.counts.sms} SMS · ${packet.counts.calls} calls · ${packet.counts.tasks} tasks`, [packet.summary.name]);
  return packet;
}

app.post('/close/lead/:id/sweep', async (req, res) => {
  try {
    const packet = await sweepCloseLeadIntel({ leadId: req.params.id, source: req.body?.source || 'manual-lead-panel' });
    res.json({ ok: true, packet });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/close/lead/sweep', async (req, res) => {
  try {
    const packet = await sweepCloseLeadIntel({ query: req.body?.query, source: req.body?.source || 'manual-name-search' });
    res.json({ ok: true, packet });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /close/inbox/snapshot — aggregate “inbox-class” intel (tasks + recent comms)
// Mirrors what reps triage in Close Inbox: tasks (view=inbox/future) + recent email/SMS/call activity.
app.get('/close/inbox/snapshot', async (req, res) => {
  try {
    const userId = getCloseUserId();
    if (!userId) return res.status(400).json({ error: 'Close CRM user ID is not configured. Add it in Settings.' });
    if (!CLOSE_API_KEY) return res.status(400).json({ error: 'CLOSE_API_KEY is not configured on the server.' });

    const uid = encodeURIComponent(userId);
    const [ti, tf, em, sm, ca] = await Promise.all([
      closeRequest('GET', `/task/?view=inbox&assigned_to=${uid}&_limit=45&_order_by=date`),
      closeRequest('GET', `/task/?view=future&assigned_to=${uid}&_limit=35&_order_by=date`),
      closeRequest('GET', `/activity/email/?user_id=${uid}&_limit=40&_order_by=-date_created`),
      closeRequest('GET', `/activity/sms/?user_id=${uid}&_limit=30&_order_by=-date_created`),
      closeRequest('GET', `/activity/call/?user_id=${uid}&_limit=25&_order_by=-date_created`),
    ]);

    const tasksInbox = closeListData(ti);
    const tasksFuture = closeListData(tf);
    const emails = closeListData(em);
    const sms = closeListData(sm);
    const calls = closeListData(ca);

    const emailNeedsTriage = emails.filter(e =>
      e.status === 'inbox' || (e.direction === 'inbound' && !['sent', 'draft', 'scheduled'].includes(e.status))
    );
    const smsNeedsTriage = sms.filter(s =>
      s.direction === 'inbound' || s.status === 'inbox'
    );

    const slimTask = (t, view) => ({
      id: t.id,
      text: t.text,
      date: t.date,
      lead_id: t.lead_id,
      lead_name: t.lead_name,
      is_complete: t.is_complete,
      view,
    });

    res.json({
      fetched_at: new Date().toISOString(),
      close_user_id: userId,
      counts: {
        tasks_inbox: tasksInbox.length,
        tasks_future: tasksFuture.length,
        emails_in_queue: emailNeedsTriage.length,
        sms_in_queue: smsNeedsTriage.length,
        calls_recent: calls.length,
      },
      tasks_inbox: tasksInbox.slice(0, 14).map(t => slimTask(t, 'inbox')),
      tasks_future: tasksFuture.slice(0, 10).map(t => slimTask(t, 'future')),
      emails_triage: emailNeedsTriage.slice(0, 10).map(e => ({
        id: e.id,
        subject: e.subject,
        lead_id: e.lead_id,
        lead_name: e.lead_name,
        status: e.status,
        direction: e.direction,
        date_created: e.date_created,
        snippet: (e.body_preview || e.body_text || '').toString().substring(0, 140),
      })),
      sms_triage: smsNeedsTriage.slice(0, 8).map(s => ({
        id: s.id,
        text: (s.text || '').substring(0, 160),
        lead_id: s.lead_id,
        lead_name: s.lead_name,
        status: s.status,
        direction: s.direction,
        date_created: s.date_created,
      })),
      calls_recent: calls.slice(0, 8).map(c => ({
        id: c.id,
        lead_id: c.lead_id,
        lead_name: c.lead_name,
        date_created: c.date_created,
        duration: c.duration,
        disposition: c.disposition || c.call_outcome,
        voicemail_url: c.voicemail_url || null,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /close/lead/:leadId/task — create a lead task (shows in Close task / inbox views)
app.post('/close/lead/:leadId/task', async (req, res) => {
  try {
    const leadId = req.params.leadId;
    const userId = getCloseUserId();
    if (!userId) return res.status(400).json({ error: 'Close CRM user ID is not configured. Add it in Settings.' });
    if (!CLOSE_API_KEY) return res.status(400).json({ error: 'CLOSE_API_KEY is not configured on the server.' });

    const { text, date, contact_id, assigned_to } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'Task text is required.' });

    const assignee = String(assigned_to || userId).trim();
    const due = date && String(date).trim()
      ? String(date).trim()
      : new Date().toISOString().substring(0, 10);

    const payload = {
      _type: 'lead',
      lead_id: leadId,
      assigned_to: assignee,
      text: String(text).trim(),
      date: due,
      is_complete: false,
      ...(contact_id ? { contact_id } : {}),
    };

    const r = await closeRequest('POST', '/task/', payload);
    if (r.status < 200 || r.status >= 300) {
      return res.status(r.status >= 400 ? r.status : 502).json({ error: closeApiErrorMessage(r.body) });
    }

    logActivity(
      'sync',
      'close_task_created',
      `Close task created`,
      `${due} · ${String(text).substring(0, 80)}${String(text).length > 80 ? '…' : ''}`,
      []
    );
    res.json({ ok: true, task: r.body });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// ACTION QUEUE
// ═══════════════════════════════════════════════════

app.get('/queue', (req, res) => {
  const queue = readData('action_queue.json');
  if (sanitizeActionQueue(queue)) writeData('action_queue.json', queue);
  res.json(queue);
});

function buildQueuedAction(type, payload, extra = {}) {
  return {
    id:         `act_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
    type,
    payload,
    queued_at:  new Date().toISOString(),
    status:     'pending',
    ...extra,
  };
}

async function autoExecuteAction(action) {
  if (action.type === 'sync_close_crm_pipeline' || action.type === 'full_pipeline_sync') {
    await executeSync(action.id);
    return { autoExecuted: true, message: 'Sync started' };
  }
  if (action.type === 'draft_close_crm_followup' && action.payload?.lead_id) {
    await executeFetchLead(action.id, action.payload.lead_id, action.payload.name);
    return { autoExecuted: true, message: 'Lead fetched and draft packet created' };
  }
  if (action.type === 'generate_morning_brief') {
    await executeMorningBrief(action.id);
    return { autoExecuted: true, message: 'Morning brief generated' };
  }
  if (action.type === 'check_cadences_due') {
    await executeCadenceReport(action.id);
    return { autoExecuted: true, message: 'Cadence report generated' };
  }
  if (action.type === 'prepare_critical_alert_review') {
    await executeCriticalAlertReview(action.id, action.payload);
    return { autoExecuted: true, message: 'Critical alert packet prepared' };
  }
  return { autoExecuted: false, message: null };
}

async function enqueueAction(type, payload, options = {}) {
  const q = readData('action_queue.json');
  sanitizeActionQueue(q);
  const dedupeMinutes = options.dedupe_minutes || 0;
  if (dedupeMinutes && hasRecentMatchingAction(q, type, options.matcher || ((candidate) => JSON.stringify(candidate) === JSON.stringify(payload)), dedupeMinutes)) {
    return { ok: true, deduped: true, action: null };
  }
  const action = buildQueuedAction(type, payload, {
    source: options.source || 'manual',
    dedupe_key: options.dedupe_key || null,
  });
  q.pending.push(action);
  q.log.push({ ...action, event: 'queued' });
  writeData('action_queue.json', q);
  console.log(`[QUEUE] ${action.type} → ${JSON.stringify(action.payload)}`);
  logActivity('queue', action.type, `Queued: ${action.type.replace(/_/g,' ')}`, JSON.stringify(action.payload || {}), [action.payload?.name || ''].filter(Boolean));
  const exec = await autoExecuteAction(action);
  return { ok: true, action, ...exec };
}

app.post('/queue', async (req, res) => {
  try {
    const result = await enqueueAction(req.body.type, req.body.payload, { source: 'manual' });
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/queue/:id/complete', (req, res) => {
  const q   = readData('action_queue.json');
  const idx = q.pending.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not in pending' });
  const [action] = q.pending.splice(idx, 1);
  action.status       = 'completed';
  action.completed_at = new Date().toISOString();
  action.result       = req.body.result || null;
  q.completed.unshift(action);
  q.log.push({ ...action, event: 'completed' });
  q._meta.last_processed = new Date().toISOString();
  writeData('action_queue.json', q);
  res.json({ ok: true, action });
});

app.post('/queue/:id/review', (req, res) => {
  const q = readData('action_queue.json');
  const target = (q.completed || []).find(a => a.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'Completed action not found' });
  const disposition = req.body.disposition || 'reviewed';
  const note = req.body.note || '';
  target.next_step = disposition === 'approved'
    ? (target.type === 'draft_close_crm_followup'
      ? { kind: 'draft_message', label: 'Ready for message drafting', activated_at: new Date().toISOString() }
      : { kind: 'resolve_exception', label: 'Ready for exception resolution', activated_at: new Date().toISOString() })
    : null;
  target.review = {
    disposition,
    note,
    reviewed_at: new Date().toISOString(),
    reviewed_by: req.body.reviewed_by || 'Andre Raw',
  };
  q._meta.last_processed = new Date().toISOString();
  q.log.push({
    id: target.id,
    type: target.type,
    event: 'reviewed',
    disposition,
    note,
    reviewed_at: target.review.reviewed_at,
  });
  writeData('action_queue.json', q);
  logActivity('automation', 'review_packet', `Packet ${disposition}`, note || `${target.type} marked ${disposition}`, [target.payload?.name || target.result?.lead_name || ''].filter(Boolean));
  res.json({ ok: true, action: target });
});

// ─── Auto-execute helpers ────────────────────────────
// These read the current file-tree snapshots first. If a future Supabase mode
// is enabled and the files are absent, liveQueries can still build the shapes.
async function buildMorningBriefPayload() {
  let live = readDataIfExists('live_close_crm.json', null);
  let tasks = readDataIfExists('live_tasks.json', null);
  let pipeline = readDataIfExists('live_pipeline.json', null);
  if (!live || !tasks || !pipeline) {
    [live, tasks, pipeline] = await Promise.all([
      liveQ.getLiveSnapshotShape({ operatorKey: 'andre' }),
      liveQ.getTasksShape({ operatorKey: 'andre' }),
      liveQ.getPipelineShape({ operatorKey: 'andre' }),
    ]);
  }
  return {
    generated_at: new Date().toISOString(),
    headline: `${tasks.task_summary?.today || 0} tasks today · ${live.pipeline_snapshot?.needs_attention_count || 0} need attention · ${live.pipeline_snapshot?.closing_this_week || 0} closing this week`,
    send_today: (tasks.tasks?.today || []).slice(0, 6),
    needs_attention: (live.needs_attention || []).slice(0, 5),
    closing_soon: (live.closing_soon || []).slice(0, 5),
    pipeline_summary: pipeline.summary || {},
    alerts: live.alerts || [],
  };
}

async function buildCadenceReportPayload() {
  let tasks = readDataIfExists('live_tasks.json', null);
  let live = readDataIfExists('live_close_crm.json', null);
  if (!tasks || !live) {
    [tasks, live] = await Promise.all([
      liveQ.getTasksShape({ operatorKey: 'andre' }),
      liveQ.getLiveSnapshotShape({ operatorKey: 'andre' }),
    ]);
  }
  return {
    generated_at: new Date().toISOString(),
    due_now: tasks.tasks?.today || [],
    within_48h: tasks.tasks?.within_48h || [],
    bottlenecks: tasks.bottlenecks || [],
    open_loops: tasks.open_loops || [],
    needs_attention: live.needs_attention || [],
  };
}

async function executeMorningBrief(actionId) {
  try {
    const brief = await buildMorningBriefPayload();
    writeData('automation_morning_brief.json', brief);
    completeAction(actionId, { file: 'automation_morning_brief.json', headline: brief.headline });
    logActivity('automation', 'generate_morning_brief', 'Morning brief refreshed', brief.headline, []);
  } catch(e) { console.error('executeMorningBrief error:', e.message); }
}

async function executeCadenceReport(actionId) {
  try {
    const report = await buildCadenceReportPayload();
    writeData('automation_cadence_report.json', report);
    completeAction(actionId, {
      file: 'automation_cadence_report.json',
      due_now: report.due_now.length,
      within_48h: report.within_48h.length,
      bottlenecks: report.bottlenecks.length
    });
    logActivity('automation', 'check_cadences_due', 'Cadence watch refreshed', `${report.due_now.length} due now · ${report.within_48h.length} within 48h`, []);
  } catch(e) { console.error('executeCadenceReport error:', e.message); }
}

async function executeSync(actionId) {
  try {
    const result = await refreshLiveCloseSnapshot('server.js auto-execute');
    completeAction(actionId, { synced: result.counts?.total_active_opportunities || 0, timestamp: result.synced_at });
  } catch(e) { console.error('executeSync error:', e.message); }
}

async function executeFetchLead(actionId, leadId, name) {
  try {
    const r = await closeRequest('GET', `/lead/${leadId}/`);
    const lead = r.body;
    const summaries = lead.summaries || [];
    const result = {
      lead_name:    lead.name,
      status:       lead.status_label,
      description:  lead.description,
      last_activity: summaries.find(s => s.includes('Activity History'))?.split('\n')[1] || 'unknown',
      draft_note:   `REVIEW NEEDED: Automation pulled lead data for ${name}. Review activity in Close CRM and draft appropriate follow-up based on current stage.`,
      summaries_preview: summaries.slice(0, 2).join(' | ').substring(0, 300)
    };
    completeAction(actionId, result);
    console.log(`[AUTO] Fetched lead ${name} for follow-up review`);
  } catch(e) { console.error('executeFetchLead error:', e.message); }
}

function completeAction(actionId, result) {
  const q   = readData('action_queue.json');
  sanitizeActionQueue(q);
  const idx = q.pending.findIndex(a => a.id === actionId);
  if (idx === -1) return;
  const [action] = q.pending.splice(idx, 1);
  action.status       = 'completed';
  action.completed_at = new Date().toISOString();
  action.result       = result;
  q.completed.unshift(action);
  q.log.push({ ...action, event: 'completed' });
  q._meta.last_processed = new Date().toISOString();
  writeData('action_queue.json', q);
}

async function executeCriticalAlertReview(actionId, payload = {}) {
  try {
    const live = readData('live_close_crm.json');
    const alerts = live.alerts || [];
    const target = alerts.find(alert =>
      (payload.lead_id && alert.lead_id === payload.lead_id) ||
      (payload.name && alert.name === payload.name)
    );
    if (!target) {
      completeAction(actionId, {
        status: 'NO_ALERT_FOUND',
        draft_note: 'No current critical alert matched this packet. Refresh Close sync and review manually.',
      });
      return;
    }
    const relatedDeal =
      (live.needs_attention || []).find(item => item.lead_id === target.lead_id) ||
      (live.closing_soon || []).find(item => item.lead_id === target.lead_id) ||
      null;
    const result = {
      packet_type: 'critical_alert_review',
      status: 'REVIEW_REQUIRED',
      lead_name: target.name,
      severity: target.severity || 'critical',
      message: target.message,
      action_required: target.action_required,
      recommended_close_action: target.type === 'deal_lost' ? 'Move opportunity to Lost in Close after human confirmation.' : 'Review in Close and resolve.',
      lead_id: target.lead_id || payload.lead_id || null,
      opportunity_id: relatedDeal?.id || null,
      related_stage: relatedDeal?.stage || null,
      related_value: relatedDeal?.value || 0,
      draft_note: `CRITICAL REVIEW: ${target.name} triggered a ${target.type || 'critical'} alert. Confirm in Close, then resolve the opportunity and capture a note.`,
    };
    completeAction(actionId, result);
    logActivity('automation', 'critical_alert_review', `Critical packet prepared for ${target.name}`, target.message, [target.name]);
  } catch(e) {
    console.error('executeCriticalAlertReview error:', e.message);
  }
}

async function runCloseSyncPulse() {
  const tempId = `auto_sync_${Date.now()}`;
  await executeSync(tempId);
  setAutomationRun('close_sync_pulse', 'ok', 'Live Close snapshot refreshed');
}

async function runAttentionFollowupSweep() {
  const live = readData('live_close_crm.json');
  const targets = (live.needs_attention || [])
    .filter(d => d.urgency === 'high' || d.urgency === 'urgent')
    .slice(0, 3);
  let queued = 0;
  for (const target of targets) {
    const result = await enqueueAction('draft_close_crm_followup', {
      lead_id: target.lead_id,
      name: target.name,
      requested_at: new Date().toISOString(),
      automation_reason: target.reason,
    }, {
      source: 'automation_engine',
      dedupe_key: `attention_followup:${target.lead_id}`,
      dedupe_minutes: 240,
      matcher: payload => payload.lead_id === target.lead_id,
    });
    if (!result.deduped) queued += 1;
  }
  setAutomationRun('attention_followup_sweep', 'ok', queued ? `${queued} follow-up packet(s) queued` : 'No new attention follow-ups needed');
}

async function runClosingWindowSweep() {
  const live = readData('live_close_crm.json');
  const targets = (live.closing_soon || []).slice(0, 3);
  let queued = 0;
  for (const target of targets) {
    const result = await enqueueAction('draft_close_crm_followup', {
      lead_id: target.lead_id,
      name: target.name,
      requested_at: new Date().toISOString(),
      automation_reason: target.note || 'Closing soon window',
    }, {
      source: 'automation_engine',
      dedupe_key: `closing_window:${target.lead_id}`,
      dedupe_minutes: 180,
      matcher: payload => payload.lead_id === target.lead_id,
    });
    if (!result.deduped) queued += 1;
  }
  setAutomationRun('closing_window_sweep', 'ok', queued ? `${queued} closing-window follow-up packet(s) queued` : 'No new closing-window actions needed');
}

async function runCadenceWatch() {
  const actionId = `auto_cadence_${Date.now()}`;
  await executeCadenceReport(actionId);
  setAutomationRun('cadence_watch', 'ok', 'Cadence report refreshed');
}

async function runBriefRefresh() {
  const actionId = `auto_brief_${Date.now()}`;
  await executeMorningBrief(actionId);
  setAutomationRun('brief_refresh', 'ok', 'Morning brief refreshed');
}

async function runCriticalExceptionWatch() {
  const live = readData('live_close_crm.json');
  const alerts = (live.alerts || []).filter(alert => (alert.severity || '').toLowerCase() === 'critical');
  let queued = 0;
  for (const alert of alerts.slice(0, 5)) {
    const result = await enqueueAction('prepare_critical_alert_review', {
      lead_id: alert.lead_id,
      name: alert.name,
      alert_type: alert.type,
      requested_at: new Date().toISOString(),
    }, {
      source: 'automation_engine',
      dedupe_key: `critical_alert:${alert.lead_id || alert.name}`,
      dedupe_minutes: 240,
      matcher: payload => (payload.lead_id && payload.lead_id === alert.lead_id) || (payload.name && payload.name === alert.name),
    });
    if (!result.deduped) queued += 1;
  }
  setAutomationRun('critical_exception_watch', 'ok', queued ? `${queued} critical review packet(s) prepared` : 'No new critical exceptions detected');
}

async function runAutomationById(id) {
  if (id === 'close_sync_pulse') return runCloseSyncPulse();
  if (id === 'attention_followup_sweep') return runAttentionFollowupSweep();
  if (id === 'closing_window_sweep') return runClosingWindowSweep();
  if (id === 'cadence_watch') return runCadenceWatch();
  if (id === 'brief_refresh') return runBriefRefresh();
  if (id === 'critical_exception_watch') return runCriticalExceptionWatch();
  throw new Error(`Unknown automation: ${id}`);
}

async function automationEngineTick() {
  const state = readAutomationState();
  const now = new Date().toISOString();
  state.engine.last_tick = now;
  state._meta.last_tick = now;
  writeAutomationState(state);

  for (const def of state.automations) {
    const effectiveInterval = def.id === 'close_sync_pulse'
      ? (readSettings().general?.auto_sync_interval_minutes || def.interval_minutes || 15)
      : def.interval_minutes;
    const runtimeDef = { ...def, interval_minutes: effectiveInterval };
    if (!shouldRunAutomation(runtimeDef, now)) continue;
    try {
      await runAutomationById(def.id);
    } catch(e) {
      const failed = readAutomationState();
      failed.engine.last_error = e.message;
      writeAutomationState(failed);
      setAutomationRun(def.id, 'error', e.message);
      console.error(`[AUTO] ${def.id} failed:`, e.message);
    }
  }
}

app.get('/automation/status', (req, res) => {
  const state = readAutomationState();
  const settings = readSettings();
  res.json({
    ...state,
    hooks: {
      close_configured: Boolean(CLOSE_API_KEY && getCloseUserId()),
      clickup_configured: Boolean(settings.clickup?.enabled && (settings.clickup?.list_id || settings.clickup?.workspace_id)),
      email_configured: Boolean(settings.messaging?.email_from),
      sms_configured: Boolean(settings.messaging?.sms_from),
      sync_interval_minutes: settings.general?.auto_sync_interval_minutes || 15,
    }
  });
});

app.post('/automation/run/:id', async (req, res) => {
  try {
    await runAutomationById(req.params.id);
    res.json({ ok: true, automation: req.params.id });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════

app.get('/settings', (req, res) => {
  const settings = readSettings();
  // Never send the full API key to the frontend — mask it
  const masked = { ...settings };
  if (masked.ai?.openai_api_key) {
    const key = masked.ai.openai_api_key;
    masked.ai.openai_api_key_preview = key.length > 8
      ? key.slice(0, 5) + '...' + key.slice(-4)
      : key ? '••••••••' : '';
    masked.ai.openai_api_key_set = key.length > 0;
    delete masked.ai.openai_api_key;
  } else {
    masked.ai.openai_api_key_preview = '';
    masked.ai.openai_api_key_set = false;
  }
  res.json(masked);
});

app.post('/settings', (req, res) => {
  const next = writeSettings(req.body || {});
  res.json({ ok: true, updated_at: next._meta.last_updated });
});

// ─── Validate OpenAI key ────────────────────────────
app.post('/ai/validate-key', async (req, res) => {
  const key = req.body.key;
  if (!key) return res.json({ valid: false, error: 'No key provided' });
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${key}` }
    });
    if (response.ok) {
      res.json({ valid: true });
    } else {
      const err = await response.json().catch(() => ({}));
      res.json({ valid: false, error: err.error?.message || `HTTP ${response.status}` });
    }
  } catch(e) {
    res.json({ valid: false, error: e.message });
  }
});

// ─── Build Oracle system instructions from doctrine ──
function buildOracleInstructions(actionType) {
  let doctrine;
  try { doctrine = readData('oracle_doctrine.json'); } catch(e) { doctrine = null; }
  if (!doctrine) return 'You are an AI sales assistant for Comeketo Catering. Be concise, actionable, and data-driven.';

  const id = doctrine.identity;
  const seq = doctrine.core_system.sequence.map(s => s.internal_logic).join('\n\n');
  const mechs = doctrine.conversational_mechanics.behaviors.map(b =>
    `When ${b.when}: ${b.what} Example: "${b.example || b.example_anxious || ''}" Anti-pattern: ${b.anti_pattern}`
  ).join('\n\n');
  const standards = doctrine.comeketo_standards;
  const energy = Object.entries(doctrine.energy_dynamics)
    .filter(([k]) => k !== 'description')
    .map(([k,v]) => `${k}: ${v}`).join('\n');

  // Get action-specific template if applicable
  const tmpl = actionType ? doctrine.action_templates[actionType] : null;
  const actionBlock = tmpl
    ? `\n\n=== CURRENT TASK ===\n${tmpl.instruction}\nOutput format: ${tmpl.output_format || 'Natural prose.'}\n${tmpl.banned_phrases ? 'BANNED PHRASES (never use these): ' + tmpl.banned_phrases.join(', ') : ''}`
    : '';
  const lattice = getLatticeBundle();
  const counts = lattice.index?.counts || {};
  const topActions = [...lattice.next_best_actions]
    .sort((a, b) => (b.sales_scoring?.action_now_score || 0) - (a.sales_scoring?.action_now_score || 0))
    .slice(0, 8)
    .map(a => {
      const lead = lattice.leads.find(l => l.lead_id === a.target_object_id);
      return `${lead?.display_name || a.target_object_id}: ${a.title} via ${a.recommended_channel || 'review'} (action_now ${a.sales_scoring?.action_now_score ?? '?'})`;
    })
    .join('\n');
  const h = getHrmrSummary(8);
  const hrmrLines = (h.recent_signal || [])
    .slice(0, 8)
    .map(r => `${r.grade}: ${String(r.note || '').replace(/\s+/g, ' ').slice(0, 220)}${r.action_type ? ` (${r.action_type})` : ''}`)
    .join('\n');

  return `${id.role}

VOICE: ${id.voice}

CONTEXT: ${id.context}

=== OPERATING SEQUENCE (apply silently to every interaction) ===
${seq}

=== CONVERSATIONAL BEHAVIORS (execute naturally, never name or explain) ===
${mechs}

=== COMEKETO STANDARDS (use for alliance-building when appropriate) ===
What we refuse: ${standards.what_we_refuse.join(' | ')}
What makes us different: ${standards.what_makes_comeketo_different.join(' | ')}

=== DEAL ENERGY (internal diagnostic, never mention in output) ===
${energy}

=== ANDRE RATIO LATTICE CATALOG (current operational truth) ===
Use this catalog above stale static briefings when judging priorities.
Indexed scope: ${counts.leads || 0} focused Andre leads, ${counts.contacts || 0} contacts, ${counts.emails || 0} emails, ${counts.sms || 0} SMS, ${counts.calls || 0} calls, ${counts.tasks || 0} tasks, ${counts.next_best_actions || 0} next-best-actions.
Top current next-best-actions:
${topActions || 'No lattice actions loaded.'}

When drafting email/SMS, assume contact coordinates are indexed in the Andre lattice catalog and Close compose can use them. Still require human approval before customer-facing send.

=== HRMR CERTIFICATION MEMORY (Andre feedback loop) ===
Stored ratings: ${h.counts?.ratings || 0}; notes: ${h.counts?.notes || 0}; graded lattice actions: ${h.counts?.graded_lattice_actions || 0}.
Recent Andre grading notes:
${hrmrLines || 'No HRMR notes stored yet. Ask for a grade and a short why after important recommendations.'}

Use A+/A notes as positive exemplars. Treat D/F notes as anti-template constraints. When recommending a next action, explain why this action beats the nearest alternative and make it easy for Andre to approve, reject, or revise.
${actionBlock}

CRITICAL RULES:
- Never mention the names of any techniques, frameworks, or mechanics. Just execute them.
- Never say "As Oracle..." or reference yourself by name unless asked.
- Never use banned phrases in follow-ups.
- Every message you draft must end with a specific, time-bound next step.
- Match the buyer's emotional temperature. Anxious gets calm. Direct gets efficient. Premium gets peer-framed.
- Be brutally honest in deal analysis. If a deal is dead, say so. If the rep is hesitating, call it.
- Keep it tight. Short paragraphs. No filler. Every sentence moves something forward.`;
}

/** Appended for Oracle free chat — structured next steps + future HRMR / sign-off loop. */
function guidedOracleSuffix() {
  return `

=== GUIDED ORACLE — SIGN-OFF NEXT STEPS (required for this session type) ===
After your main reply (helpful markdown for the rep), append EXACTLY:
1) A blank line
2) The line ---ORACLE_NEXT_STEPS--- (three hyphens each side, no spaces)
3) A single JSON object on the next lines (valid JSON, no markdown code fences)

Schema:
{"steps":[{"id":"short_slug","label":"Short button label","action":"navigate|oracle_prompt|open_deal|open_compose|refresh_inbox|open_palette","payload":{}}]}

Provide 3–6 steps. Each label must be under 8 words. Actions:
- navigate → payload {"view":"command|pipeline|deals|automation|oracle|timeline|settings|actions|performance|coaching"}
- oracle_prompt → payload {"text":"The full next user message to send in chat"}
- open_deal → payload {"dealName":"Exact deal name from context"}
- open_compose → payload {"mode":"email|sms","leadId":"Close lead id","dealName":"Lead or deal name"}
- refresh_inbox → payload {}
- open_palette → payload {} (opens search / jump menu)

Do not put ---ORACLE_NEXT_STEPS--- inside the visible answer. The rep sees only the prose above the delimiter; the app strips the JSON.`;
}

/** Turn chat-style message array into one Responses API input string (multi-turn context). */
function flattenMessagesForResponses(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  if (messages.length === 1) return messages[0].content || '';
  return messages.map(m => {
    const label = m.role === 'assistant' ? 'Assistant' : 'User';
    return `${label}: ${m.content || ''}`;
  }).join('\n\n');
}

// ─── AI Chat proxy (keeps key server-side) ──────────
app.post('/ai/chat', async (req, res) => {
  const settings = readSettings();
  const apiKey = settings.ai?.openai_api_key;
  if (!apiKey) return res.status(400).json({ error: 'No OpenAI API key configured. Go to Settings to add one.' });

  const { messages, model, instructions, action_type, guided_oracle } = req.body;
  const useModel = model || settings.ai.model || 'gpt-5.4-nano';

  // Build instructions: use doctrine-powered instructions, allow override
  let systemInstructions = instructions || buildOracleInstructions(action_type || null);
  if (guided_oracle) systemInstructions += guidedOracleSuffix();

  // Responses API: use a single input string. Multi-turn chat = transcript so Oracle remembers context.
  const inputPayload = flattenMessagesForResponses(messages);

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: useModel,
        instructions: systemInstructions,
        input: inputPayload
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || `OpenAI API error: ${response.status}` });
    }

    const data = await response.json();
    // Log the AI interaction
    const userMsg = (messages || []).filter(m => m.role === 'user').pop()?.content || '';
    const dealMatch = userMsg.match(/\[DEAL FOCUS\]\nName: ([^\n]+)/);
    const related = dealMatch ? [dealMatch[1]] : [];
    const reply = data.output_text || data.output?.[0]?.content?.[0]?.text || '';
    logActivity('ai', action_type || 'chat',
      action_type ? `AI ${action_type.replace(/_/g,' ')}` : 'Oracle chat',
      reply.substring(0, 200) + (reply.length > 200 ? '...' : ''),
      related
    );
    res.json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Status ─────────────────────────────────────────
// ═══════════════════════════════════════════════════
// LIVE DATA ENDPOINTS
// Primary path for Andre testing is now Close -> file tree.
// Supabase remains optional; if it is unavailable, these endpoints
// return the latest file-backed snapshots instead of failing.
// These replace the static andre_pipeline.json /
// andre_tasks.json / live_close_crm.json reads.
// They return shapes that match the existing frontend
// rendering code, so the views don't need rewriting.
// ═══════════════════════════════════════════════════

function operatorKeyFrom(req) {
  return (req.query.operator || req.body?.operator || 'andre').toString();
}

app.get('/api/live/pipeline', async (req, res) => {
  const fileData = readDataIfExists('live_pipeline.json', null);
  if (CRM_SOURCE !== 'supabase' && fileData) return res.json(fileData);
  try {
    const data = await liveQ.getPipelineShape({ operatorKey: operatorKeyFrom(req) });
    res.json(data);
  } catch (e) {
    const fallback = readDataIfExists('live_pipeline.json', null);
    if (fallback) return res.json({ ...fallback, _meta: { ...(fallback._meta || {}), fallback_reason: e.message } });
    console.warn('[LIVE] pipeline using empty fallback:', e.message);
    res.json({ ...liveQ.emptyPipelineShape?.() || { summary: {}, stages: [], priority_distribution: {}, risk_patterns: [], high_value_deals: [], all_deals: [] }, _meta: { source: 'empty:file-tree', error: e.message } });
  }
});

app.get('/api/live/tasks', async (req, res) => {
  const fileData = readDataIfExists('live_tasks.json', null);
  if (CRM_SOURCE !== 'supabase' && fileData) return res.json(fileData);
  try {
    const data = await liveQ.getTasksShape({ operatorKey: operatorKeyFrom(req) });
    res.json(data);
  } catch (e) {
    const fallback = readDataIfExists('live_tasks.json', null);
    if (fallback) return res.json({ ...fallback, _meta: { ...(fallback._meta || {}), fallback_reason: e.message } });
    console.warn('[LIVE] tasks using empty fallback:', e.message);
    res.json({ task_summary: { total: 0, today: 0, within_48h: 0, within_3_7d: 0, watch_list: 0 }, tasks: { today: [], within_48h: [], within_3_7d: [], watch_list: [] }, bottlenecks: [], open_loops: [], coaching_plan: {}, automation_hooks: {}, _meta: { source: 'empty:file-tree', error: e.message } });
  }
});

app.get('/api/live/snapshot', async (req, res) => {
  const fileData = readDataIfExists('live_close_crm.json', null);
  if (CRM_SOURCE !== 'supabase' && fileData) return res.json(fileData);
  try {
    const data = await liveQ.getLiveSnapshotShape({ operatorKey: operatorKeyFrom(req) });
    res.json(data);
  } catch (e) {
    const fallback = readDataIfExists('live_close_crm.json', null);
    if (fallback) return res.json({ ...fallback, _meta: { ...(fallback._meta || {}), fallback_reason: e.message } });
    console.warn('[LIVE] snapshot using empty fallback:', e.message);
    res.json({ _meta: { source: 'empty:file-tree', last_synced: null, error: e.message }, pipeline_snapshot: { total_active_opportunities: 0, needs_attention_count: 0, closing_this_week: 0, top_deal_value: 0, top_deal_name: '—' }, needs_attention: [], closing_soon: [], top_opportunities: [], alerts: [], verification: { status: 'unknown', notes: ['No file-backed snapshot exists yet. Run Sync Now.'] } });
  }
});

app.get('/api/live/wins', async (req, res) => {
  try {
    const data = await liveQ.getWinsShape({ operatorKey: operatorKeyFrom(req) });
    res.json(data);
  } catch (e) {
    console.error('[LIVE] wins failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/** Indexed lead rows from Close (comeketo.leads) — search / tooling / future joins */
app.get('/api/live/leads', async (req, res) => {
  try {
    const lim = Math.min(parseInt(req.query.limit || '500', 10) || 500, 2000);
    const data = await liveQ.getLeadsShape({ limit: lim });
    res.json(data);
  } catch (e) {
    console.error('[LIVE] leads failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/live/andre-focus', async (req, res) => {
  const fileData = readDataIfExists('andre_close_focus/snapshot.json', null);
  if (CRM_SOURCE !== 'supabase' && fileData) return res.json(fileData);
  try {
    const data = await liveQ.getAndreFocusShape({ operatorKey: operatorKeyFrom(req) });
    res.json(data);
  } catch (e) {
    const fallback = readDataIfExists('andre_close_focus/snapshot.json', null);
    if (fallback) return res.json({ ...fallback, _meta: { ...(fallback._meta || {}), fallback_reason: e.message } });
    console.warn('[LIVE] andre-focus using empty fallback:', e.message);
    res.json({ _meta: { source: 'empty:file-tree', generated_at: new Date().toISOString(), error: e.message }, views: [] });
  }
});

app.get('/api/live/sync-meta', async (req, res) => {
  try {
    const data = await liveQ.getSyncMeta();
    res.json({ sources: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/lattice/summary', (req, res) => {
  const b = getLatticeBundle();
  const topActions = [...b.next_best_actions]
    .sort((a, c) => (c.sales_scoring?.action_now_score || 0) - (a.sales_scoring?.action_now_score || 0))
    .slice(0, 10);
  const leadById = new Map(b.leads.map(l => [l.lead_id, l]));
  res.json({
    index: b.index,
    counts: b.index?.counts || {},
    top_actions: topActions.map(a => ({
      ...a,
      lead: leadById.get(a.target_object_id) || null,
    })),
  });
});

app.get('/api/lattice/lead/:id', (req, res) => {
  const row = getLatticeLead(req.params.id);
  if (!row) return res.status(404).json({ error: 'Lead not found in Andre lattice catalog' });
  res.json(row);
});

app.get('/api/lattice/graph', (req, res) => {
  try {
    const source = String(req.query.source || 'current').toLowerCase();
    if (source === 'experiment') {
      return res.json(getExperimentLatticeGraph());
    }
    if (source === 'doctrine') {
      return res.json(getDoctrineLatticeGraph());
    }

    const b = getLatticeBundle();
    const contactsByLead = new Map();
    for (const c of b.contacts || []) {
      if (!contactsByLead.has(c.lead_id)) contactsByLead.set(c.lead_id, []);
      contactsByLead.get(c.lead_id).push(c);
    }
    const signalsByLead = new Map();
    for (const s of b.signals || []) {
      if (!signalsByLead.has(s.lead_id)) signalsByLead.set(s.lead_id, []);
      signalsByLead.get(s.lead_id).push(s);
    }
    const tasksByLead = new Map();
    for (const t of b.tasks || []) {
      if (!tasksByLead.has(t.lead_id)) tasksByLead.set(t.lead_id, []);
      tasksByLead.get(t.lead_id).push(t);
    }
    const oppsByLead = new Map();
    for (const o of b.opportunities || []) {
      if (!oppsByLead.has(o.lead_id)) oppsByLead.set(o.lead_id, []);
      oppsByLead.get(o.lead_id).push(o);
    }

    const actionByLead = new Map();
    for (const a of b.next_best_actions || []) actionByLead.set(a.target_object_id, a);

    const rows = (b.leads || []).map(lead => {
      const action = actionByLead.get(lead.lead_id) || null;
      const signals = signalsByLead.get(lead.lead_id) || [];
      const contacts = contactsByLead.get(lead.lead_id) || [];
      const tasks = tasksByLead.get(lead.lead_id) || [];
      const opportunities = oppsByLead.get(lead.lead_id) || [];
      const score = action?.sales_scoring || {};
      const hasEmail = contacts.some(c => (c.email_addresses || []).length);
      const hasPhone = contacts.some(c => (c.phone_numbers || []).length);
      const contactability = (hasEmail ? 50 : 0) + (hasPhone ? 50 : 0);
      const signalTotals = signals.reduce((acc, s) => {
        acc.urgency += Number(s.urgency_impact || 0);
        acc.momentum += Number(s.momentum_impact || 0);
        acc.friction += Number(s.friction_impact || 0);
        acc.relationship += Number(s.relationship_impact || 0);
        return acc;
      }, { urgency: 0, momentum: 0, friction: 0, relationship: 0 });
      const activityVolume = Number(lead.activity_count || 0)
        || signals.length + tasks.length + contacts.length + opportunities.length;
      const value = opportunities.reduce((sum, o) => sum + Number(o.value || o.value_cents || 0), 0);
      const balanced = Math.round(
        (Number(score.action_now_score || 0) * 0.34) +
        (Number(score.priority_score || 0) * 0.24) +
        (Number(score.expected_impact || 0) * 0.18) +
        (Number(score.saveability_score || 0) * 0.14) +
        (contactability * 0.10)
      );
      return {
        lead_id: lead.lead_id,
        name: lead.display_name || lead.name || lead.lead_id,
        status_label: lead.status_label || lead.status_id || '',
        url: lead.url || null,
        value,
        contacts: contacts.length,
        has_email: hasEmail,
        has_phone: hasPhone,
        contactability,
        activity_volume: activityVolume,
        tasks_open: tasks.filter(t => !t.is_complete).length,
        opportunities: opportunities.length,
        signals: signals.slice(0, 8).map(s => ({
          id: s.signal_event_id,
          event_type: s.event_type,
          summary: s.payload_summary,
          urgency_impact: s.urgency_impact,
          momentum_impact: s.momentum_impact,
          friction_impact: s.friction_impact,
          relationship_impact: s.relationship_impact,
        })),
        signal_totals: signalTotals,
        action,
        scores: {
          action_now_score: Number(score.action_now_score || 0),
          priority_score: Number(score.priority_score || 0),
          expected_impact: Number(score.expected_impact || 0),
          saveability_score: Number(score.saveability_score || 0),
          confidence: Number(score.confidence || 0),
          attention_cost: Number(score.attention_cost || 0),
          balanced_lattice: balanced,
          contactability,
          activity_volume: activityVolume,
          urgency_signal: signalTotals.urgency,
          momentum_signal: signalTotals.momentum,
          relationship_signal: signalTotals.relationship,
        },
      };
    });

    res.json({
      _meta: {
        generated_at: new Date().toISOString(),
        source: 'file-tree:lattice_catalog',
        catalog_generated_at: b.index?.generated_at || null,
      },
      counts: b.index?.counts || {},
      source_summary: b.index?.source_summary || {},
      comparators: [
        { id: 'balanced_lattice', label: 'Balanced Lattice', description: 'Weighted blend of action-now, priority, impact, saveability, and contactability.' },
        { id: 'action_now_score', label: 'Action Now', description: 'Who should move first if Andre has limited time right now.' },
        { id: 'priority_score', label: 'Priority', description: 'Strategic importance from the saved-view and opportunity context.' },
        { id: 'expected_impact', label: 'Expected Impact', description: 'Revenue/momentum upside if this move works.' },
        { id: 'saveability_score', label: 'Saveability', description: 'How recoverable the lead appears from current signals.' },
        { id: 'confidence', label: 'Confidence', description: 'Confidence in the recommendation from available evidence.' },
        { id: 'contactability', label: 'Contactability', description: 'Whether usable email/phone coordinates exist.' },
        { id: 'activity_volume', label: 'Activity Volume', description: 'How much Close history exists for the lead.' },
        { id: 'urgency_signal', label: 'Urgency Signal', description: 'Sum of urgency impacts from signal events.' },
        { id: 'momentum_signal', label: 'Momentum Signal', description: 'Sum of momentum impacts from signal events.' },
      ],
      rows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function latticeGraphForSource(source = 'doctrine') {
  const key = String(source || 'doctrine').toLowerCase();
  if (key === 'experiment') return getExperimentLatticeGraph();
  if (key === 'doctrine') return getDoctrineLatticeGraph();
  return getDoctrineLatticeGraph();
}

function clampScore(n) {
  return Math.max(0, Math.round(Number(n || 0) * 10) / 10);
}

function intentWeights(intent = 'today') {
  const presets = {
    today: {
      action_now_score: 0.24,
      doctrine_fit: 0.18,
      next_action_clarity: 0.15,
      contactability: 0.12,
      decay_risk_score: 0.10,
      tasting_readiness: 0.09,
      priority_score: 0.07,
      relationship_strength: 0.05,
      attention_cost: -0.10,
    },
    fastest_money: {
      revenue_value: 0.24,
      close_probability: 0.18,
      action_now_score: 0.16,
      priority_score: 0.15,
      tasting_readiness: 0.10,
      contactability: 0.08,
      doctrine_fit: 0.06,
      attention_cost: -0.08,
    },
    save_risk: {
      decay_risk_score: 0.26,
      saveability_score: 0.18,
      action_now_score: 0.16,
      urgency: 0.12,
      contactability: 0.10,
      relationship_strength: 0.08,
      next_action_clarity: 0.08,
      attention_cost: -0.08,
    },
    tasting: {
      tasting_readiness: 0.26,
      relationship_strength: 0.18,
      action_now_score: 0.16,
      close_probability: 0.12,
      doctrine_fit: 0.12,
      next_action_clarity: 0.10,
      contactability: 0.08,
      attention_cost: -0.08,
    },
    trust_source: {
      source_trust: 0.25,
      relationship_strength: 0.18,
      doctrine_fit: 0.16,
      action_now_score: 0.14,
      next_action_clarity: 0.10,
      contactability: 0.10,
      revenue_value: 0.06,
      attention_cost: -0.06,
    },
  };
  return presets[intent] || presets.today;
}

function scoreLatticeDecision(row, options = {}) {
  const scores = row.scores || {};
  const primary = options.primary || 'action_now_score';
  const secondary = options.secondary || 'doctrine_fit';
  const tertiary = options.tertiary || 'contactability';
  const weights = intentWeights(options.intent);
  let score = 0;
  const contributions = [];

  for (const [key, weight] of Object.entries(weights)) {
    const value = Number(scores[key] || 0);
    const contribution = value * weight;
    score += contribution;
    contributions.push({ key, value, weight, contribution: Math.round(contribution * 10) / 10 });
  }

  const selected = [
    { key: primary, weight: 0.22 },
    { key: secondary, weight: 0.14 },
    { key: tertiary, weight: 0.10 },
  ];
  for (const item of selected) {
    const value = Number(scores[item.key] || 0);
    const contribution = value * item.weight;
    score += contribution;
    contributions.push({ key: item.key, value, weight: item.weight, contribution: Math.round(contribution * 10) / 10, selected: true });
  }

  const action = row.action || {};
  const actionType = action.action_type || 'review';
  const channel = action.recommended_channel || 'review';
  if (row.doctrine?.andre_action?.andre_tasks_today?.length) {
    score += 8;
    contributions.push({ key: 'andre_task_today_bonus', value: 100, weight: 0.08, contribution: 8 });
  }
  if (/call|tasting|consultation/i.test(actionType)) {
    score += 4;
    contributions.push({ key: 'human_trust_action_bonus', value: 100, weight: 0.04, contribution: 4 });
  }
  if ((channel === 'sms' || channel === 'email') && row.contactability < 50) {
    score -= 18;
    contributions.push({ key: 'missing_contact_penalty', value: row.contactability, weight: -0.18, contribution: -18 });
  }
  if (row.doctrine?.exceptions?.length) {
    const penalty = Math.min(16, row.doctrine.exceptions.length * 8);
    score -= penalty;
    contributions.push({ key: 'exception_penalty', value: row.doctrine.exceptions.length, weight: -8, contribution: -penalty });
  }

  const sortedContributions = contributions
    .filter(c => Math.abs(c.contribution) > 0.1)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 8);
  return { score: clampScore(score), contributions: sortedContributions };
}

function decisionVerificationQuestions(row) {
  const questions = [];
  const action = row.action || {};
  if (!row.has_email && !row.has_phone) questions.push('No indexed email or phone. Sweep Close/contact record before drafting or sending.');
  if ((action.recommended_channel === 'sms' || action.recommended_channel === 'email') && row.contactability < 50) questions.push(`Recommended channel is ${action.recommended_channel}, but contactability is weak. Verify usable contact coordinates first.`);
  if (row.doctrine?.timeline?.event_urgency_tier === 'no_date') questions.push('Event date is missing, so cash/timeline urgency may be under-informed.');
  if (row.doctrine?.venue?.commitment_signal === 'actively_shopping') questions.push('Venue is not locked; ask a planning-status question before assuming operational commitment.');
  if (row.doctrine?.exceptions?.length) questions.push(`Exception state present: ${row.doctrine.exceptions.join(', ')}. Fix/verify this before trusting automation.`);
  if (!questions.length) questions.push('Verify latest Close activity before executing, then keep Andre as final human approver.');
  return questions.slice(0, 4);
}

function explainDecision(row, decision) {
  const action = row.action || {};
  const top = decision.contributions.slice(0, 4).map(c => `${c.key.replace(/_/g, ' ')} ${c.contribution >= 0 ? '+' : ''}${c.contribution}`).join(', ');
  const doctrineNotes = [
    row.doctrine?.tasting?.doctrine_note,
    row.doctrine?.revenue?.revenue_doctrine_note,
    row.doctrine?.decay?.decay_doctrine_note,
    row.doctrine?.andre_action?.action_doctrine_note,
  ].filter(Boolean);
  return {
    why_now: `${row.name} scores ${decision.score} because ${top || 'the selected comparators point here'}.`,
    why_this_action: action.reasoning || `Recommended action is ${action.title || action.action_type || 'review'} via ${action.recommended_channel || 'review'}.`,
    doctrine_read: doctrineNotes.slice(0, 3),
    beats: 'This action beats lower-ranked moves because it has the stronger combined action score after intent weights, selected comparators, contactability, and doctrine penalties.',
  };
}

app.get('/api/lattice/decide', (req, res) => {
  try {
    const source = String(req.query.source || 'doctrine').toLowerCase();
    const intent = String(req.query.intent || 'today').toLowerCase();
    const primary = String(req.query.primary || 'action_now_score');
    const secondary = String(req.query.secondary || (source === 'doctrine' ? 'doctrine_fit' : 'priority_score'));
    const tertiary = String(req.query.tertiary || 'contactability');
    const limit = Math.min(Math.max(parseInt(req.query.limit || '8', 10) || 8, 1), 20);
    const graph = latticeGraphForSource(source);
    const rows = graph.rows || [];
    const candidates = rows.map(row => {
      const decision = scoreLatticeDecision(row, { intent, primary, secondary, tertiary });
      return {
        decision_id: `${row.lead_id}:${row.action?.action_type || 'review'}:${intent}`,
        lead_id: row.lead_id,
        lead_name: row.name,
        score: decision.score,
        action: row.action || {},
        value: row.value || 0,
        contactability: row.contactability || 0,
        comparators: {
          intent,
          primary: { id: primary, value: Number(row.scores?.[primary] || 0) },
          secondary: { id: secondary, value: Number(row.scores?.[secondary] || 0) },
          tertiary: { id: tertiary, value: Number(row.scores?.[tertiary] || 0) },
        },
        contributions: decision.contributions,
        evidence: explainDecision(row, decision),
        verification_questions: decisionVerificationQuestions(row),
        doctrine: row.doctrine || null,
        scores: row.scores || {},
      };
    }).sort((a, b) => b.score - a.score).slice(0, limit);

    const winner = candidates[0] || null;
    res.json({
      _meta: {
        generated_at: new Date().toISOString(),
        source,
        graph_source: graph._meta?.source || null,
        intent,
        primary,
        secondary,
        tertiary,
        algebra: 'intent weights + selected comparator boosts + task/action bonuses - contact/exception penalties',
      },
      graph_meta: graph._meta || {},
      comparators: graph.comparators || [],
      winner,
      candidates,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Urgency rules (operator-tunable) ───────────────
app.get('/api/urgency-rules', async (req, res) => {
  try {
    const rules = await liveQ.getUrgencyRules(operatorKeyFrom(req));
    res.json(rules);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/urgency-rules', async (req, res) => {
  try {
    const operator = operatorKeyFrom(req);
    const updates  = req.body || {};
    delete updates.operator_key;
    delete updates.operator;
    const saved = await liveQ.setUrgencyRules(operator, updates);
    res.json(saved);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── HRMR ratings (with notes!) ─────────────────────
// This is the new piece: a place to persist a NOTE
// alongside each grade so Oracle can learn the WHY.
app.post('/api/oracle/turn', async (req, res) => {
  try {
    const { id, operator_key, prompt, response, action_type, model, context, lattice_action_id, lead_id, source } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required (turn id)' });
    const row = {
      id,
      operator_key: operator_key || 'andre',
      prompt:       prompt || null,
      response:     response || null,
      action_type:  action_type || null,
      model:        model || null,
      context:      context || null,
      lattice_action_id: lattice_action_id || null,
      lead_id:      lead_id || null,
      source:       source || 'oracle',
      created_at:   new Date().toISOString(),
    };
    saveOracleTurnFile(row);

    if (sb.isConfigured()) {
      try {
        const client = sb.client();
        await client.from('oracle_turns').upsert(row, { onConflict: 'id' });
      } catch (e) {
        console.warn('[HRMR] Supabase turn mirror skipped:', e.message);
      }
    }

    res.json({ ok: true, turn: row, storage: 'file-tree' });
  } catch (e) {
    console.error('[HRMR] log turn failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/hrmr', async (req, res) => {
  try {
    const turnId = req.query.turn_id;
    const all = readHrmrFile('ratings.json', { ratings: [] }).ratings || [];
    const ratings = turnId ? all.filter(r => r.turn_id === turnId) : all.slice(0, 200);
    res.json({ ratings, source: 'file-tree' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/hrmr', async (req, res) => {
  try {
    const {
      turn_id,
      grade,
      note,
      rated_by,
      query,
      response_snippet,
      action_type,
      lattice_action_id,
      lead_id,
      model,
      source,
    } = req.body || {};
    if (!turn_id) return res.status(400).json({ error: 'turn_id is required' });
    if (!grade)   return res.status(400).json({ error: 'grade is required (A+, A, B, C, D, F, etc.)' });
    const row = {
      id: `hrmr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      turn_id,
      grade,
      note:       note || null,
      rated_by:   rated_by || 'andre',
      query:      query || null,
      response_snippet: response_snippet || null,
      action_type: action_type || null,
      lattice_action_id: lattice_action_id || null,
      lead_id:    lead_id || null,
      model:      model || null,
      source:     source || 'oracle_grade',
      created_at: new Date().toISOString(),
    };
    saveHrmrRatingFile(row);

    if (sb.isConfigured()) {
      try {
        const client = sb.client();
        await client.from('hrmr_ratings').insert(row);
      } catch (e) {
        console.warn('[HRMR] Supabase rating mirror skipped:', e.message);
      }
    }

    logActivity('ai', 'hrmr_rating', `Oracle reply graded ${grade}`, note || 'No note provided', []);
    res.json({ ok: true, rating: row, storage: 'file-tree' });
  } catch (e) {
    console.error('[HRMR] post rating failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/hrmr/summary', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '12', 10) || 12, 50);
    res.json(getHrmrSummary(limit));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/oracle/archive', (req, res) => {
  try {
    const archived = archiveOracleConversationFile(req.body || {});
    logActivity(
      'ai',
      'oracle_conversation_archived',
      `Oracle conversation archived`,
      `${archived.message_count} messages · ${archived.grade_count} grade(s) · ${archived.title}`,
      archived.lead_ids || []
    );
    res.json({ ok: true, conversation: archived, storage: 'file-tree+lattice' });
  } catch (e) {
    console.error('[HRMR] archive conversation failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Manual sync trigger ────────────────────────────
app.post('/api/sync/run', async (req, res) => {
  try {
    if (!CLOSE_API_KEY || !getCloseUserId()) {
      return res.status(400).json({ error: 'Close API key or user_id missing' });
    }
    const result = await refreshLiveCloseSnapshot('manual /api/sync/run');
    // Notify SSE clients to refetch live slots
    const payload = JSON.stringify({ file: 'live_sync', slot: 'live', ts: Date.now() });
    for (const r of sseClients) r.write(`data: ${payload}\n\n`);
    res.json(result);
  } catch (e) {
    console.error('[SYNC] full sync failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/status', (req, res) => {
  const live = readData('live_close_crm.json');
  const q    = readData('action_queue.json');
  const settings = readSettings();
  const automation = readAutomationState();
  res.json({
    server:            'Comeketo Sales Command Center v2',
    close_api:         CLOSE_API_KEY ? 'configured' : 'MISSING',
    close_user_id:     getCloseUserId() ? 'configured' : 'MISSING',
    ai_enabled:        settings.ai?.enabled || false,
    ai_model:          settings.ai?.model || 'none',
    uptime:            Math.round(process.uptime()),
    last_synced:       live._meta?.last_synced,
    verification_status: live.verification?.status || 'unknown',
    verification_coverage_pct: live.verification?.coverage_pct ?? null,
    pending_actions:   q.pending.length,
    completed_actions: q.completed.length,
    automations_active: automation.automations.length,
    automation_last_tick: automation.engine?.last_tick || null,
  });
});

app.listen(PORT, async () => {
  ensureAutomationState();
  ensureOpsTracker();
  console.log(`\n🔥 Comeketo Sales Command Center v2`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Close API: ${CLOSE_API_KEY ? '✅ configured' : '❌ MISSING — check .env'}`);
  // Verify API key on startup
  try {
    const r = await closeRequest('GET', '/me/');
    console.log(`   Close CRM: ✅ Connected as ${r.body.first_name} ${r.body.last_name} (${r.body.email})`);
  } catch(e) {
    console.log(`   Close CRM: ❌ Connection failed — ${e.message}`);
  }
  console.log(`   Automation Engine: ✅ armed`);
  setTimeout(() => automationEngineTick().catch(e => console.error('[AUTO] initial tick failed:', e.message)), 1500);
  setInterval(() => automationEngineTick().catch(e => console.error('[AUTO] tick failed:', e.message)), 60 * 1000);
  console.log('');
});
