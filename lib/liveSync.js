// ═══════════════════════════════════════════════════════
// COMEKETO — Live Sync
// Pulls from Close CRM and writes into Supabase as the
// new source of truth for live operational data.
//
// IMPORTANT: this module replaces the static
// andre_pipeline.json + andre_tasks.json reads.
// It does NOT touch Oracle doctrine, templates, or
// the ops_tracker — those remain file-backed.
//
// Indexing roadmap: opportunities + tasks + activities (+ notes) + leads
// are upserted from Close into Supabase. Scraped JSON snapshots are retired
// for pipeline/tasks; leads give org-wide CRM context without manual entry.
// ═══════════════════════════════════════════════════════
const https = require('https');
const { client: sbClient, isConfigured: sbConfigured } = require('./supabase');

const CLOSE_BASE = 'https://api.close.com/api/v1';

// ─── Close API helper (mirror of server.js) ─────────
function closeRequest(method, endpoint, apiKey, body = null) {
  return new Promise((resolve, reject) => {
    const url  = new URL(CLOSE_BASE + endpoint);
    const auth = Buffer.from(`${apiKey}:`).toString('base64');
    const opts = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', d => (data += d));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data || '{}') }); }
        catch (e) { reject(new Error('Bad JSON from Close: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ─── Task classification ────────────────────────────
// Heuristic-based — read the task text and decide what kind of work it is.
// This is the layer that prevents follow-ups and admin from being marked urgent.
const ADMIN_PATTERNS = [
  /\binvoice\b/i, /\bbilling\b/i, /\breceipt\b/i,
  /\bpaperwork\b/i, /\bcontract\b.*\b(send|sign|mail|paper)/i,
  /\blog (the|a|this|in)\b/i, /\bupdate (crm|close|the system)\b/i,
  /\bschedule (in|on)\b/i, /\bcalendar\b/i,
  /\bfulfillment\b/i, /\bdelivery\b/i, /\blogistics\b/i,
  /\bthank you\b/i, /\bafter (the )?event\b/i,
  /\bwatch (for|the) (final|last) payment\b/i,
  /\bmonitor\b/i, /\bmaintain\b/i,
  /\b(testimonial|review|referral)\b/i,
  /\b(post[- ])?event (recap|wrap|cleanup|notes)\b/i,
];

const FOLLOWUP_PATTERNS = [
  /\bfollow[- ]?up\b/i, /\bfollowup\b/i,
  /\bcheck in\b/i, /\bcheckin\b/i,
  /\bping\b/i, /\bnudge\b/i, /\btouch base\b/i,
];

const CALL_PATTERNS    = [/\bcall\b/i, /\bring\b/i, /\bdial\b/i, /\bvoicemail\b/i];
const EMAIL_PATTERNS   = [/\bemail\b/i, /\bsend.*\b(quote|proposal|reply)\b/i];
const SMS_PATTERNS     = [/\bsms\b/i, /\btext\b/i, /\bmessage\b/i];
const MEETING_PATTERNS = [/\bmeeting\b/i, /\btasting\b/i, /\bappointment\b/i, /\bconsult\b/i];

function classifyTaskText(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return { task_type: 'other', is_admin: false };

  const matchAny = (patterns) => patterns.some(p => p.test(text));

  // Order matters — admin first so admin-flavored follow-ups get tagged admin
  if (matchAny(ADMIN_PATTERNS))    return { task_type: 'admin',     is_admin: true  };
  if (matchAny(MEETING_PATTERNS))  return { task_type: 'meeting',   is_admin: false };
  if (matchAny(CALL_PATTERNS))     return { task_type: 'call',      is_admin: false };
  if (matchAny(SMS_PATTERNS))      return { task_type: 'sms',       is_admin: false };
  if (matchAny(EMAIL_PATTERNS))    return { task_type: 'email',     is_admin: false };
  if (matchAny(FOLLOWUP_PATTERNS)) return { task_type: 'follow_up', is_admin: false };
  return { task_type: 'other', is_admin: false };
}

// ─── Status type normalization ──────────────────────
// Close opportunity status_type is reliable but we also normalize lost variants.
function normalizeStatusType(statusType, statusLabel) {
  const t = String(statusType || '').toLowerCase();
  const l = String(statusLabel || '').toLowerCase();
  if (t === 'won')    return 'won';
  if (t === 'lost')   return 'lost';
  if (t === 'active') return 'active';
  // Fallback by label
  if (/won|booked|closed[- ]won|paid|fulfilled|complete/.test(l)) return 'won';
  if (/lost|cancel|dead|no[- ]go/.test(l))                         return 'lost';
  return 'active';
}

// ─── Sync meta helpers ──────────────────────────────
async function markSyncStart(source) {
  if (!sbConfigured()) return;
  const sb = sbClient();
  const now = new Date().toISOString();
  await sb.from('sync_meta').upsert({
    source,
    last_started_at: now,
    last_status: 'running',
  }, { onConflict: 'source' });
}

async function markSyncFinish(source, status, rowsSynced, errorMsg, details) {
  if (!sbConfigured()) return;
  const sb = sbClient();
  const now = new Date().toISOString();
  await sb.from('sync_meta').upsert({
    source,
    last_finished_at: now,
    last_status: status,
    last_error: errorMsg || null,
    rows_synced: rowsSynced || 0,
    details: details || null,
  }, { onConflict: 'source' });
}

// ─── Leads sync (full org lead index) ───────────────
async function syncLeads({ closeApiKey }) {
  await markSyncStart('close_leads');
  try {
    if (!closeApiKey) throw new Error('Close API key missing');

    const fields = [
      'id', 'name', 'display_name', 'status_id', 'status_label',
      'url', 'description', 'primary_phone', 'primary_email',
      'date_created', 'date_updated', 'custom',
    ].join(',');

    let allLeads = [];
    let cursor = null;
    let safety = 80;
    do {
      const cursorParam = cursor ? `&_cursor=${encodeURIComponent(cursor)}` : '';
      const r = await closeRequest(
        'GET',
        `/lead/?_fields=${fields}&_limit=100${cursorParam}`,
        closeApiKey
      );
      if (r.status !== 200) throw new Error(`Close /lead returned ${r.status}`);
      allLeads = allLeads.concat(r.body.data || []);
      cursor = r.body.cursor || null;
      safety -= 1;
    } while (cursor && safety > 0);

    const sb = sbClient();
    const rows = allLeads.map(l => ({
      id:               l.id,
      name:             l.name || null,
      display_name:     l.display_name || l.name || null,
      status_id:        l.status_id || null,
      status_label:     l.status_label || null,
      primary_phone:    l.primary_phone || null,
      primary_email:    l.primary_email || null,
      url:              l.url || null,
      description:      l.description || null,
      custom:           l.custom || null,
      raw:              l,
      created_at_close: l.date_created || null,
      updated_at_close: l.date_updated || null,
      synced_at:        new Date().toISOString(),
    }));

    if (rows.length) {
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const { error } = await sb.from('leads').upsert(chunk, { onConflict: 'id' });
        if (error) throw new Error(`Supabase upsert leads: ${error.message}`);
      }
    }

    await markSyncFinish('close_leads', 'ok', rows.length, null, {
      total_pulled: rows.length,
    });
    return { ok: true, count: rows.length };
  } catch (e) {
    await markSyncFinish('close_leads', 'error', 0, e.message);
    throw e;
  }
}

// ─── Opportunity sync ───────────────────────────────
async function syncOpportunities({ closeApiKey, closeUserId }) {
  await markSyncStart('close_opportunities');
  try {
    if (!closeApiKey || !closeUserId) throw new Error('Close API key or user_id missing');

    // Pull all opps for the user — Close paginates at 100
    const fields = [
      'id','lead_id','lead_name','status_id','status_label','status_type',
      'pipeline_id','value','value_period','confidence',
      'date_won','date_lost','close_at','date_created','date_updated','note',
    ].join(',');

    let allOpps = [];
    let cursor = null;
    let safety = 50;
    do {
      const cursorParam = cursor ? `&_cursor=${encodeURIComponent(cursor)}` : '';
      const r = await closeRequest(
        'GET',
        `/opportunity/?user_id=${closeUserId}&_fields=${fields}&_limit=100${cursorParam}`,
        closeApiKey
      );
      if (r.status !== 200) throw new Error(`Close /opportunity returned ${r.status}`);
      allOpps = allOpps.concat(r.body.data || []);
      cursor = r.body.cursor || null;
      safety -= 1;
    } while (cursor && safety > 0);

    const sb = sbClient();
    const rows = allOpps.map(o => ({
      id:               o.id,
      lead_id:          o.lead_id,
      lead_name:        o.lead_name || null,
      display_name:     o.lead_name || null,
      status_id:        o.status_id || null,
      status_label:     o.status_label || null,
      status_type:      normalizeStatusType(o.status_type, o.status_label),
      pipeline_id:      o.pipeline_id || null,
      pipeline_label:   null,
      stage_label:      o.status_label || null,
      // Close stores value in cents — keep dollars in our store
      value:            o.value != null ? Math.round((o.value || 0) / 100) : null,
      value_period:     o.value_period || null,
      confidence:       o.confidence ?? null,
      event_date:       o.close_at || null,
      close_date:       o.close_at || null,
      last_activity_at: o.date_updated || null,
      created_at_close: o.date_created || null,
      updated_at_close: o.date_updated || null,
      raw:              o,
      synced_at:        new Date().toISOString(),
    }));

    if (rows.length) {
      // Upsert in chunks of 200
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const { error } = await sb.from('opportunities').upsert(chunk, { onConflict: 'id' });
        if (error) throw new Error(`Supabase upsert opportunities: ${error.message}`);
      }
    }

    await markSyncFinish('close_opportunities', 'ok', rows.length, null, {
      total_pulled: rows.length,
      active: rows.filter(r => r.status_type === 'active').length,
      won:    rows.filter(r => r.status_type === 'won').length,
      lost:   rows.filter(r => r.status_type === 'lost').length,
    });
    return { ok: true, count: rows.length };
  } catch (e) {
    await markSyncFinish('close_opportunities', 'error', 0, e.message);
    throw e;
  }
}

// ─── Tasks sync ─────────────────────────────────────
async function syncTasks({ closeApiKey, closeUserId }) {
  await markSyncStart('close_tasks');
  try {
    if (!closeApiKey || !closeUserId) throw new Error('Close API key or user_id missing');
    const uid = encodeURIComponent(closeUserId);

    // Inbox + future + overdue tasks
    const [inboxR, futureR] = await Promise.all([
      closeRequest('GET', `/task/?view=inbox&assigned_to=${uid}&_limit=100&_order_by=date`, closeApiKey),
      closeRequest('GET', `/task/?view=future&assigned_to=${uid}&_limit=100&_order_by=date`, closeApiKey),
    ]);
    if (inboxR.status !== 200) throw new Error(`Close /task inbox returned ${inboxR.status}`);
    if (futureR.status !== 200) throw new Error(`Close /task future returned ${futureR.status}`);

    const all = [
      ...(inboxR.body.data  || []).map(t => ({ ...t, _view: 'inbox'  })),
      ...(futureR.body.data || []).map(t => ({ ...t, _view: 'future' })),
    ];

    const sb = sbClient();
    const rows = all.map(t => {
      const cls = classifyTaskText(t.text);
      return {
        id:           t.id,
        lead_id:      t.lead_id || null,
        lead_name:    t.lead_name || null,
        opportunity_id: null,
        text:         t.text || '',
        task_type:    cls.task_type,
        is_admin:     cls.is_admin,
        is_complete:  Boolean(t.is_complete),
        due_at:       t.date || null,
        assigned_to:  t.assigned_to || null,
        source:       'close',
        raw:          t,
        synced_at:    new Date().toISOString(),
      };
    });

    if (rows.length) {
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const { error } = await sb.from('tasks').upsert(chunk, { onConflict: 'id' });
        if (error) throw new Error(`Supabase upsert tasks: ${error.message}`);
      }
    }

    await markSyncFinish('close_tasks', 'ok', rows.length, null, {
      total_pulled: rows.length,
      inbox_count:  (inboxR.body.data  || []).length,
      future_count: (futureR.body.data || []).length,
      admin_count:  rows.filter(r => r.is_admin).length,
    });
    return { ok: true, count: rows.length };
  } catch (e) {
    await markSyncFinish('close_tasks', 'error', 0, e.message);
    throw e;
  }
}

// ─── Activities sync (recent comms only) ────────────
async function syncActivities({ closeApiKey, closeUserId }) {
  await markSyncStart('close_activities');
  try {
    if (!closeApiKey || !closeUserId) throw new Error('Close API key or user_id missing');
    const uid = encodeURIComponent(closeUserId);

    const [emailR, smsR, callR, noteR] = await Promise.all([
      closeRequest('GET', `/activity/email/?user_id=${uid}&_limit=80&_order_by=-date_created`, closeApiKey),
      closeRequest('GET', `/activity/sms/?user_id=${uid}&_limit=60&_order_by=-date_created`,   closeApiKey),
      closeRequest('GET', `/activity/call/?user_id=${uid}&_limit=60&_order_by=-date_created`,  closeApiKey),
      closeRequest('GET', `/activity/note/?user_id=${uid}&_limit=80&_order_by=-date_created`,  closeApiKey),
    ]);

    const mapEmail = (e) => ({
      id:             e.id,
      lead_id:        e.lead_id || null,
      lead_name:      e.lead_name || null,
      opportunity_id: null,
      activity_type:  'email',
      direction:      e.direction || null,
      subject:        e.subject || null,
      body_preview:   (e.body_preview || e.body_text || '').toString().substring(0, 500),
      status:         e.status || null,
      occurred_at:    e.date_created || null,
      user_id:        e.user_id || null,
      raw:            e,
      synced_at:      new Date().toISOString(),
    });
    const mapSms = (s) => ({
      id:             s.id,
      lead_id:        s.lead_id || null,
      lead_name:      s.lead_name || null,
      opportunity_id: null,
      activity_type:  'sms',
      direction:      s.direction || null,
      subject:        null,
      body_preview:   (s.text || '').toString().substring(0, 500),
      status:         s.status || null,
      occurred_at:    s.date_created || null,
      user_id:        s.user_id || null,
      raw:            s,
      synced_at:      new Date().toISOString(),
    });
    const mapCall = (c) => ({
      id:             c.id,
      lead_id:        c.lead_id || null,
      lead_name:      c.lead_name || null,
      opportunity_id: null,
      activity_type:  'call',
      direction:      c.direction || null,
      subject:        c.disposition || c.call_outcome || null,
      body_preview:   (c.note || '').toString().substring(0, 500),
      status:         c.status || null,
      occurred_at:    c.date_created || null,
      user_id:        c.user_id || null,
      raw:            c,
      synced_at:      new Date().toISOString(),
    });
    const mapNote = (n) => ({
      id:             n.id,
      lead_id:        n.lead_id || null,
      lead_name:      n.lead_name || null,
      opportunity_id: null,
      activity_type:  'note',
      direction:      null,
      subject:        null,
      body_preview:   (n.note || n.body || '').toString().substring(0, 500),
      status:         null,
      occurred_at:    n.date_created || null,
      user_id:        n.user_id || null,
      raw:            n,
      synced_at:      new Date().toISOString(),
    });

    const noteRows = noteR.status === 200 ? (noteR.body?.data || []) : [];
    if (noteR.status !== 200) {
      console.warn('[SYNC] Close /activity/note returned', noteR.status, '— skipping notes batch');
    }

    const rows = [
      ...(emailR.body?.data || []).map(mapEmail),
      ...(smsR.body?.data   || []).map(mapSms),
      ...(callR.body?.data  || []).map(mapCall),
      ...noteRows.map(mapNote),
    ];

    const sb = sbClient();
    if (rows.length) {
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const { error } = await sb.from('activities').upsert(chunk, { onConflict: 'id' });
        if (error) throw new Error(`Supabase upsert activities: ${error.message}`);
      }
    }

    await markSyncFinish('close_activities', 'ok', rows.length, null, {
      email_count: (emailR.body?.data || []).length,
      sms_count:   (smsR.body?.data   || []).length,
      call_count:  (callR.body?.data  || []).length,
      note_count:  noteRows.length,
    });
    return { ok: true, count: rows.length };
  } catch (e) {
    await markSyncFinish('close_activities', 'error', 0, e.message);
    throw e;
  }
}

// ─── Full sync orchestrator ─────────────────────────
async function runFullLiveSync({ closeApiKey, closeUserId }) {
  if (!sbConfigured()) {
    throw new Error('Supabase not configured — set SUPABASE_URL and SUPABASE_SECRET_KEY in .env');
  }
  const started = new Date().toISOString();
  const results = {};
  // Run sequentially so we can report the first failure cleanly
  results.leads         = await syncLeads({ closeApiKey });
  results.opportunities = await syncOpportunities({ closeApiKey, closeUserId });
  results.tasks         = await syncTasks({ closeApiKey, closeUserId });
  results.activities    = await syncActivities({ closeApiKey, closeUserId });
  return {
    ok: true,
    started_at: started,
    finished_at: new Date().toISOString(),
    results,
  };
}

module.exports = {
  runFullLiveSync,
  syncLeads,
  syncOpportunities,
  syncTasks,
  syncActivities,
  classifyTaskText,
  normalizeStatusType,
};
