// ═══════════════════════════════════════════════════════
// COMEKETO — Live Queries
// Reads from Supabase and returns shapes that match the
// EXISTING frontend rendering code, so we don't have to
// rewrite all the views. This is the adapter layer.
//
// All urgency rules live here, in one place. The five
// hard-coded urgency stamps that used to live in the
// frontend get computed here instead.
// ═══════════════════════════════════════════════════════
const { client: sbClient, isConfigured: sbConfigured } = require('./supabase');

// ─── Urgency rules ──────────────────────────────────
const DEFAULT_RULES = {
  operator_key:           'andre',
  follow_ups_auto_urgent: false,
  admin_auto_urgent:      false,
  hide_won_from_main:     true,
  hide_lost_from_main:    true,
  high_value_threshold:   5000,
  urgent_value_threshold: 10000,
  urgent_days_to_event:   7,
};

async function getUrgencyRules(operatorKey = 'andre') {
  if (!sbConfigured()) return { ...DEFAULT_RULES, operator_key: operatorKey };
  const sb = sbClient();
  const { data, error } = await sb
    .from('urgency_rules')
    .select('*')
    .eq('operator_key', operatorKey)
    .maybeSingle();
  if (error || !data) return { ...DEFAULT_RULES, operator_key: operatorKey };
  return { ...DEFAULT_RULES, ...data };
}

async function setUrgencyRules(operatorKey, updates) {
  if (!sbConfigured()) throw new Error('Supabase not configured');
  const sb = sbClient();
  const payload = {
    ...DEFAULT_RULES,
    ...(updates || {}),
    operator_key: operatorKey,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb
    .from('urgency_rules')
    .upsert(payload, { onConflict: 'operator_key' })
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// ─── Urgency computation ────────────────────────────
function daysUntil(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function daysSince(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function normText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function computeOpportunityUrgency(opp, rules) {
  if (!opp) return 'low';
  if (opp.status_type === 'won' || opp.status_type === 'lost') return 'low';

  const value      = Number(opp.value || 0);
  const days       = daysUntil(opp.event_date || opp.close_date);
  const confidence = Number(opp.confidence || 0);

  // Urgent: high-confidence high-value with a near-term event
  if (value >= rules.urgent_value_threshold && days != null && days <= rules.urgent_days_to_event) return 'urgent';
  if (value >= rules.urgent_value_threshold && confidence >= 80) return 'urgent';
  if (days != null && days >= 0 && days <= rules.urgent_days_to_event && value >= rules.high_value_threshold) return 'urgent';

  // High: high-value active deals
  if (value >= rules.high_value_threshold) return 'high';

  // Medium: low-confidence active deals (at-risk signal)
  if (confidence > 0 && confidence < 50) return 'medium';

  return 'low';
}

function computeTaskUrgency(task, rules) {
  if (!task) return 'low';
  if (task.is_complete) return 'low';

  // Admin: never auto-urgent unless rules say otherwise
  if (task.is_admin && !rules.admin_auto_urgent) return 'low';

  // Follow-ups: never auto-urgent unless rules say otherwise
  if (task.task_type === 'follow_up' && !rules.follow_ups_auto_urgent) return 'low';

  const days = daysUntil(task.due_at);
  if (days == null) return 'low';
  if (days < 0)  return 'urgent';            // overdue
  if (days === 0) return 'urgent';
  if (days <= 2) return 'high';
  if (days <= 7) return 'medium';
  return 'low';
}

// ─── Icon mapping ───────────────────────────────────
const TASK_ICON = {
  call:      'call',
  email:     'mail',
  sms:       'sms',
  meeting:   'event',
  follow_up: 'reply',
  admin:     'task_alt',
  other:     'check_circle',
};

function pickTaskIcon(task) {
  return TASK_ICON[task.task_type] || 'check_circle';
}

function pickTaskCategory(task) {
  return task.task_type || 'other';
}

// ─── Pipeline shape (matches andre_pipeline.json) ───
async function getPipelineShape({ operatorKey = 'andre' } = {}) {
  if (!sbConfigured()) return emptyPipelineShape();
  const sb = sbClient();
  const rules = await getUrgencyRules(operatorKey);

  const { data: opps, error } = await sb
    .from('opportunities')
    .select('*');
  if (error) throw new Error(`getPipelineShape: ${error.message}`);

  const all = (opps || []);
  const active = all.filter(o => o.status_type === 'active');
  const won    = all.filter(o => o.status_type === 'won');
  const lost   = all.filter(o => o.status_type === 'lost');

  // The MAIN pipeline view shows only active. Won/lost are excluded.
  const mainView = active;

  const sumValue = arr => arr.reduce((s, o) => s + Number(o.value || 0), 0);

  // Build all_deals in the shape the frontend wants
  const all_deals = mainView.map(o => {
    const urgency = computeOpportunityUrgency(o, rules);
    return {
      id:         o.id,
      lead_id:    o.lead_id,
      name:       o.display_name || o.lead_name || 'Unknown',
      value:      Number(o.value || 0),
      stage:      o.stage_label || o.status_label || '',
      event:      '',
      venue:      '',
      guests:     '',
      confidence: Number(o.confidence || 0),
      priority:   urgency === 'urgent' ? 'high' : urgency,
      urgency,
      status:     'active',
      risk:       Number(o.confidence || 0) > 0 && Number(o.confidence || 0) < 50 ? ['low confidence'] : [],
      close_at:   o.close_date || null,
      event_date: o.event_date || null,
    };
  }).sort((a, b) => (b.value || 0) - (a.value || 0));

  // Stage groupings — group by stage_label
  const stageMap = new Map();
  for (const o of mainView) {
    const label = o.stage_label || o.status_label || 'Unstaged';
    if (!stageMap.has(label)) stageMap.set(label, { label, count: 0, value: 0, color: '#A8D8EA', emoji: '🔹' });
    const s = stageMap.get(label);
    s.count += 1;
    s.value += Number(o.value || 0);
  }
  const stages = Array.from(stageMap.values()).sort((a, b) => b.value - a.value);

  // Priority distribution from computed urgency
  const priority_distribution = { high: 0, medium: 0, low: 0 };
  for (const d of all_deals) {
    if (d.urgency === 'urgent' || d.urgency === 'high') priority_distribution.high += 1;
    else if (d.urgency === 'medium') priority_distribution.medium += 1;
    else priority_distribution.low += 1;
  }

  // High-value deals: top 12 by value
  const high_value_deals = all_deals.slice(0, 12);

  // Risk patterns: count low-confidence and stalled
  const risk_patterns = [];
  const lowConf = all_deals.filter(d => d.confidence > 0 && d.confidence < 50).length;
  if (lowConf) risk_patterns.push({ flag: 'Low confidence (<50%)', count: lowConf, severity: 'warning' });
  const noEventDate = all_deals.filter(d => !d.event_date).length;
  if (noEventDate) risk_patterns.push({ flag: 'No event date set', count: noEventDate, severity: 'info' });

  return {
    summary: {
      total_pipeline:     sumValue(active),
      total_deals:        active.length,
      avg_deal_value:     active.length ? Math.round(sumValue(active) / active.length) : 0,
      locked_in_revenue:  sumValue(won),
      at_risk_revenue:    sumValue(active.filter(o => Number(o.confidence || 0) < 50)),
      largest_deal:       Math.max(0, ...active.map(o => Number(o.value || 0))),
      won_count:          won.length,
      lost_count:         lost.length,
    },
    stages,
    priority_distribution,
    risk_patterns,
    high_value_deals,
    all_deals,
    _meta: {
      source: 'supabase:comeketo.opportunities',
      generated_at: new Date().toISOString(),
      rules_applied: { hide_won_from_main: rules.hide_won_from_main, hide_lost_from_main: rules.hide_lost_from_main },
    },
  };
}

function emptyPipelineShape() {
  return {
    summary: { total_pipeline: 0, total_deals: 0, avg_deal_value: 0, locked_in_revenue: 0, at_risk_revenue: 0, largest_deal: 0, won_count: 0, lost_count: 0 },
    stages: [],
    priority_distribution: { high: 0, medium: 0, low: 0 },
    risk_patterns: [],
    high_value_deals: [],
    all_deals: [],
    _meta: { source: 'empty', generated_at: new Date().toISOString() },
  };
}

// ─── Tasks shape (matches andre_tasks.json) ─────────
async function getTasksShape({ operatorKey = 'andre' } = {}) {
  if (!sbConfigured()) return emptyTasksShape();
  const sb = sbClient();
  const rules = await getUrgencyRules(operatorKey);

  const { data: tasks, error } = await sb
    .from('tasks')
    .select('*')
    .eq('is_complete', false);
  if (error) throw new Error(`getTasksShape: ${error.message}`);

  // Bucket by due date
  const buckets = { today: [], within_48h: [], within_3_7d: [], watch_list: [] };
  for (const t of (tasks || [])) {
    const days = daysUntil(t.due_at);
    const urgency = computeTaskUrgency(t, rules);
    const item = {
      id:          t.id,
      lead:        t.lead_name || 'Unknown',
      lead_id:     t.lead_id,
      value:       null, // we'd need a join with opportunities to populate this; left null for now
      action:      t.text || '',
      category:    pickTaskCategory(t),
      task_type:   t.task_type,
      is_admin:    Boolean(t.is_admin),
      urgency,
      icon:        pickTaskIcon(t),
      due_at:      t.due_at,
      days_until:  days,
    };
    if (days == null || days > 7)  buckets.watch_list.push(item);
    else if (days <= 0)            buckets.today.push(item);
    else if (days <= 2)            buckets.within_48h.push(item);
    else                           buckets.within_3_7d.push(item);
  }

  // Sort each bucket: urgent → high → medium → low, then by due date
  const rank = { urgent: 0, high: 1, medium: 2, low: 3 };
  const sortBucket = (b) => b.sort((a, b) => (rank[a.urgency] ?? 9) - (rank[b.urgency] ?? 9) || ((a.days_until ?? 999) - (b.days_until ?? 999)));
  Object.values(buckets).forEach(sortBucket);

  return {
    task_summary: {
      total:        (tasks || []).length,
      today:        buckets.today.length,
      within_48h:   buckets.within_48h.length,
      within_3_7d:  buckets.within_3_7d.length,
      watch_list:   buckets.watch_list.length,
    },
    tasks: buckets,
    bottlenecks: [], // derived from old static scrape — no live equivalent yet
    open_loops: [],  // derived from old static scrape — no live equivalent yet
    coaching_plan: {}, // static scrape only — kept empty in live mode
    automation_hooks: {}, // moved to /automation/status
    _meta: {
      source: 'supabase:comeketo.tasks',
      generated_at: new Date().toISOString(),
      rules_applied: {
        follow_ups_auto_urgent: rules.follow_ups_auto_urgent,
        admin_auto_urgent: rules.admin_auto_urgent,
      },
    },
  };
}

function emptyTasksShape() {
  return {
    task_summary: { total: 0, today: 0, within_48h: 0, within_3_7d: 0, watch_list: 0 },
    tasks: { today: [], within_48h: [], within_3_7d: [], watch_list: [] },
    bottlenecks: [], open_loops: [], coaching_plan: {}, automation_hooks: {},
    _meta: { source: 'empty', generated_at: new Date().toISOString() },
  };
}

// ─── Live snapshot shape (matches live_close_crm.json) ──
// Built entirely from Supabase data, no static comparison.
async function getLiveSnapshotShape({ operatorKey = 'andre' } = {}) {
  if (!sbConfigured()) return emptyLiveShape();
  const sb = sbClient();
  const rules = await getUrgencyRules(operatorKey);

  const { data: opps, error } = await sb
    .from('opportunities')
    .select('*');
  if (error) throw new Error(`getLiveSnapshotShape: ${error.message}`);

  const all = opps || [];
  const active = all.filter(o => o.status_type === 'active');

  const now = Date.now();
  const sevenDays = now + 7 * 24 * 60 * 60 * 1000;

  const closing_soon = active
    .filter(o => o.event_date && new Date(o.event_date).getTime() >= now && new Date(o.event_date).getTime() <= sevenDays)
    .map(o => {
      const urgency = computeOpportunityUrgency(o, rules);
      return {
        id: o.id,
        lead_id: o.lead_id,
        name: o.display_name || o.lead_name || 'Unknown',
        value: Number(o.value || 0),
        stage: o.stage_label || o.status_label || '',
        confidence: Number(o.confidence || 0),
        close_at: o.event_date || o.close_date,
        days_until_close: daysUntil(o.event_date || o.close_date),
        urgency,
        note: `${Number(o.confidence || 0)}% confidence — ${o.stage_label || o.status_label || ''}`,
      };
    });

  // Needs attention: active deals with low confidence OR no recent activity (>14d)
  const fourteenDaysAgo = now - 14 * 24 * 60 * 60 * 1000;
  const needs_attention = active
    .filter(o => {
      const stale = !o.last_activity_at || new Date(o.last_activity_at).getTime() < fourteenDaysAgo;
      const lowConf = Number(o.confidence || 0) > 0 && Number(o.confidence || 0) < 50;
      return stale || lowConf;
    })
    .sort((a, b) => Number(b.value || 0) - Number(a.value || 0))
    .slice(0, 50)
    .map(o => {
      const urgency = computeOpportunityUrgency(o, rules);
      return {
        id: o.id,
        lead_id: o.lead_id,
        name: o.display_name || o.lead_name || 'Unknown',
        value: Number(o.value || 0),
        stage: o.stage_label || o.status_label || '',
        confidence: Number(o.confidence || 0),
        close_at: o.event_date || o.close_date,
        urgency,
        reason: !o.last_activity_at || new Date(o.last_activity_at).getTime() < fourteenDaysAgo
          ? 'Stalled — no activity in 14+ days'
          : 'Low confidence — at risk',
      };
    });

  const top_opportunities = active
    .sort((a, b) => Number(b.value || 0) - Number(a.value || 0))
    .slice(0, 10)
    .map(o => ({
      id: o.id,
      lead_id: o.lead_id,
      name: o.display_name || o.lead_name || 'Unknown',
      value: Number(o.value || 0),
      stage: o.stage_label || o.status_label || '',
      confidence: Number(o.confidence || 0),
      close_at: o.event_date || o.close_date,
    }));

  // Pull last sync metadata
  const { data: meta } = await sb
    .from('sync_meta')
    .select('*')
    .eq('source', 'close_opportunities')
    .maybeSingle();

  return {
    _meta: {
      last_synced: meta?.last_finished_at || null,
      synced_by:   'liveSync.runFullLiveSync',
      source:      'supabase:comeketo.opportunities',
    },
    pipeline_snapshot: {
      total_active_opportunities: active.length,
      needs_attention_count:      needs_attention.length,
      closing_this_week:          closing_soon.length,
      top_deal_value:             top_opportunities[0]?.value || 0,
      top_deal_name:              top_opportunities[0]?.name  || '—',
    },
    needs_attention,
    closing_soon,
    top_opportunities,
    alerts: [], // alerts surface elsewhere; we don't fabricate them from Supabase
    verification: {
      checked_at: new Date().toISOString(),
      status: 'ok',
      metric: 'supabase_live_data',
      coverage_pct: 100,
      notes: ['Live Supabase data — no static comparison performed.'],
    },
  };
}

function emptyLiveShape() {
  return {
    _meta: { last_synced: null, synced_by: 'liveSync', source: 'empty' },
    pipeline_snapshot: { total_active_opportunities: 0, needs_attention_count: 0, closing_this_week: 0, top_deal_value: 0, top_deal_name: '—' },
    needs_attention: [],
    closing_soon: [],
    top_opportunities: [],
    alerts: [],
    verification: { checked_at: new Date().toISOString(), status: 'unknown', notes: ['Supabase not configured.'] },
  };
}

// ─── Wins archive (low-priority section) ────────────
async function getWinsShape({ operatorKey = 'andre' } = {}) {
  if (!sbConfigured()) return { wins: [], summary: { count: 0, total_value: 0 } };
  const sb = sbClient();
  const { data, error } = await sb
    .from('opportunities')
    .select('*')
    .eq('status_type', 'won')
    .order('updated_at_close', { ascending: false })
    .limit(200);
  if (error) throw new Error(`getWinsShape: ${error.message}`);
  const wins = (data || []).map(o => ({
    id: o.id,
    lead_id: o.lead_id,
    name: o.display_name || o.lead_name || 'Unknown',
    value: Number(o.value || 0),
    stage: o.stage_label || o.status_label || '',
    won_at: o.updated_at_close || o.last_activity_at || null,
    confidence: Number(o.confidence || 0),
  }));
  return {
    wins,
    summary: {
      count: wins.length,
      total_value: wins.reduce((s, w) => s + (w.value || 0), 0),
    },
    _meta: { source: 'supabase:comeketo.opportunities[status_type=won]', generated_at: new Date().toISOString() },
  };
}

// ─── Leads index (for search, CRM context, future joins) ─
async function getLeadsShape({ limit = 500 } = {}) {
  if (!sbConfigured()) return { leads: [], count: 0, _meta: { source: 'empty' } };
  const sb = sbClient();
  const { data, error, count } = await sb
    .from('leads')
    .select('id, name, display_name, status_label, primary_email, primary_phone, updated_at_close', { count: 'exact' })
    .order('updated_at_close', { ascending: false })
    .limit(Math.min(limit, 2000));
  if (error) throw new Error(`getLeadsShape: ${error.message}`);
  const leads = (data || []).map(l => ({
    id: l.id,
    name: l.display_name || l.name || 'Unknown',
    status: l.status_label || '',
    email: l.primary_email || null,
    phone: l.primary_phone || null,
    updated_at: l.updated_at_close || null,
  }));
  return {
    leads,
    count: count ?? leads.length,
    _meta: {
      source: 'supabase:comeketo.leads',
      generated_at: new Date().toISOString(),
    },
  };
}

// ─── Sync metadata for the freshness indicator ──────
async function getSyncMeta() {
  if (!sbConfigured()) return [];
  const sb = sbClient();
  const { data } = await sb.from('sync_meta').select('*');
  return data || [];
}

async function getAndreFocusShape({ operatorKey = 'andre' } = {}) {
  if (!sbConfigured()) return { _meta: { source: 'empty', generated_at: new Date().toISOString() }, views: [] };
  const sb = sbClient();
  const rules = await getUrgencyRules(operatorKey);

  const [{ data: opps, error: oppErr }, { data: tasks, error: taskErr }, { data: acts, error: actErr }] = await Promise.all([
    sb.from('opportunities').select('*').eq('status_type', 'active'),
    sb.from('tasks').select('*').eq('is_complete', false),
    sb.from('activities').select('*').order('occurred_at', { ascending: false }).limit(600),
  ]);
  if (oppErr) throw new Error(`getAndreFocusShape opportunities: ${oppErr.message}`);
  if (taskErr) throw new Error(`getAndreFocusShape tasks: ${taskErr.message}`);
  if (actErr) throw new Error(`getAndreFocusShape activities: ${actErr.message}`);

  const activeOpps = opps || [];
  const openTasks = tasks || [];
  const activities = acts || [];

  const leadActivity = new Map();
  for (const a of activities) {
    const lid = a.lead_id || null;
    if (!lid) continue;
    if (!leadActivity.has(lid)) leadActivity.set(lid, []);
    leadActivity.get(lid).push(a);
  }

  const taskLeadIdsDueToday = new Set(
    openTasks
      .filter(t => {
        const d = daysUntil(t.due_at);
        return d != null && d <= 0;
      })
      .map(t => t.lead_id)
      .filter(Boolean)
  );

  const toItem = (o, reason) => ({
    id: o.id,
    lead_id: o.lead_id,
    name: o.display_name || o.lead_name || 'Unknown',
    value: Number(o.value || 0),
    stage: o.stage_label || o.status_label || '',
    confidence: Number(o.confidence || 0),
    urgency: computeOpportunityUrgency(o, rules),
    close_at: o.event_date || o.close_date || null,
    updated_at: o.updated_at_close || o.last_activity_at || null,
    reason,
  });

  const viewBuckets = {
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

  for (const o of activeOpps) {
    const stage = normText(o.stage_label || o.status_label || '');
    const age = daysSince(o.created_at_close);
    const actsForLead = leadActivity.get(o.lead_id) || [];
    const last24h = actsForLead.filter(a => a.occurred_at && (Date.now() - new Date(a.occurred_at).getTime()) <= 24 * 60 * 60 * 1000);
    const inboundRecent = actsForLead.find(a => (a.activity_type === 'email' || a.activity_type === 'sms') && normText(a.direction) === 'inbound' && a.occurred_at && (Date.now() - new Date(a.occurred_at).getTime()) <= 72 * 60 * 60 * 1000);
    const anyConnect = actsForLead.some(a => ['call', 'email', 'sms'].includes(a.activity_type));
    const dormant = stage.includes('dormant') || (!!o.last_activity_at && daysSince(o.last_activity_at) >= 30);
    const bookedTasting = stage.includes('booked for tasting') || stage.includes('setting tasting appointment');

    if (taskLeadIdsDueToday.has(o.lead_id)) viewBuckets.todays_leads.push(toItem(o, 'Open task due today'));
    if (age != null && age >= 1 && age <= 5) viewBuckets.day_1_5_cadence.push(toItem(o, `Lead age ${age} days`));
    if (age != null && age >= 6 && age <= 10) viewBuckets.day_6_10_cadence.push(toItem(o, `Lead age ${age} days`));
    if (last24h.some(a => a.activity_type === 'email')) viewBuckets.opened_email_24h.push(toItem(o, 'Recent email activity in the last 24h'));
    if (!anyConnect) viewBuckets.no_connect_made.push(toItem(o, 'No email / SMS / call activity found'));
    if (inboundRecent) viewBuckets.needs_response.push(toItem(o, 'Inbound email/SMS in the last 72h'));
    if (bookedTasting) viewBuckets.booked_tastings.push(toItem(o, 'Tasting-stage opportunity'));
    if (dormant) viewBuckets.long_term_dormant.push(toItem(o, 'Dormant or no recent activity'));
    if (stage.includes('dormant')) viewBuckets.all_dormant.push(toItem(o, 'Explicit dormant stage'));
  }

  const claimed = new Set();
  for (const key of ['todays_leads', 'day_1_5_cadence', 'day_6_10_cadence', 'opened_email_24h', 'no_connect_made', 'needs_response', 'booked_tastings', 'long_term_dormant', 'all_dormant']) {
    for (const row of viewBuckets[key]) claimed.add(row.id);
  }
  viewBuckets.all_other_followup = activeOpps
    .filter(o => !claimed.has(o.id))
    .map(o => toItem(o, 'Active follow-up not captured by a more specific Andre focus bucket'));

  const labels = {
    todays_leads: "01. Today's Leads",
    day_1_5_cadence: '02. Day 1-5 Cadence',
    day_6_10_cadence: '03. Day 6-10 Cadence',
    opened_email_24h: '04. Opened Email (24hr)',
    no_connect_made: '05. No Connect Made',
    needs_response: '06. Needs Response',
    booked_tastings: '07. Booked Tastings',
    long_term_dormant: '08. Long-Term / Dormant',
    all_dormant: '09. All Dormant',
    all_other_followup: '10. All Other Followup',
  };

  const views = Object.entries(viewBuckets).map(([id, items]) => ({
    id,
    label: labels[id],
    count: items.length,
    total_value: items.reduce((sum, item) => sum + Number(item.value || 0), 0),
    items: items
      .sort((a, b) => (b.value || 0) - (a.value || 0))
      .slice(0, 150),
  }));

  return {
    _meta: {
      source: 'supabase:comeketo.andre_focus_derived',
      generated_at: new Date().toISOString(),
      operator_key: operatorKey,
      note: 'Derived from screenshot-defined Andre Close folders using synced opportunities/tasks/activities.',
    },
    views,
  };
}

module.exports = {
  // Rules
  getUrgencyRules,
  setUrgencyRules,
  DEFAULT_RULES,
  // Computation
  computeOpportunityUrgency,
  computeTaskUrgency,
  // Shapes
  getPipelineShape,
  getTasksShape,
  getLiveSnapshotShape,
  getWinsShape,
  getLeadsShape,
  getSyncMeta,
  getAndreFocusShape,
};
