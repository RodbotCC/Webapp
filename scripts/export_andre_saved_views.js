#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const FOCUS_DIR = path.join(DATA_DIR, 'andre_close_focus');
const CONFIG_PATH = path.join(FOCUS_DIR, 'saved_views.json');
const OUT_DIR = path.join(FOCUS_DIR, 'saved_views_export');
const VIEWS_DIR = path.join(OUT_DIR, 'views');
const CLOSE_API_KEY = process.env.CLOSE_API_KEY;
const OWNER_FIELD_ID = 'cf_xF8FLufgEx9bsijfRAfHhgIrPBQ5ajuohcazC7OtNmT';
const OWNER_VALUE = '01. 😎 Andre';
const EXCLUDED_LEAD_STATUS_IDS = new Set([
  'stat_X4X2dIPrVwMZDbSGxo1xCbkokk0mjPwaqpF5PjK80F3',
  'stat_bklEUrvZENevA6DXNlfjkaMdRI9e4k5Gp0WIez1Bg13',
  'stat_lFhsqm3auHFu7YqtvgteNRN9bT4EelnKGZrW0pmLGEA',
]);
const ACTIVE_OPPORTUNITY_STATUS_IDS = new Set([
  'stat_P1wq4LXQlbeOdi4dbikgXHzPTZtBypP4BA5fnK0GLWd',
  'stat_XlK8WSBgI3iNiqqb5dGUxoDGfZN4QUvetFI8IM9YAS8',
  'stat_jPXypkYupOtL2e3S27WAmINSS5Wi4kRKeoXDG4CsesG',
  'stat_lFepKqyuTpPICkaKbld2JzXpXt3BHxO1bR4ctWYJRq0',
  'stat_uVWdjD12s4KhTwpOaNVgEYZX0ZRB75fKH2LCICzBYjT',
  'stat_wVjlEhuB44DBwtfg0AG5LidEKPJOVMfLTyVgMUxWKmI',
  'stat_xIEnKeIS7IYyfj8O8IwZxvcBa52QbXJ6zwlkbXTQ00x',
  'stat_yJptDkplCTNffmd56XgEOzD7NOQc96IkTWJccPzBnH5',
]);
const NEEDS_RESPONSE_OPPORTUNITY_STATUS_IDS = new Set([
  ...ACTIVE_OPPORTUNITY_STATUS_IDS,
  'stat_iT5xvidBJs8amQrSj5HFDkZW8wmzdnVAKEr5IH2RmjV',
]);
const BOOKED_TASTING_STATUS_ID = 'stat_iT5xvidBJs8amQrSj5HFDkZW8wmzdnVAKEr5IH2RmjV';
const DORMANT_STATUS_IDS = new Set([
  'stat_P1wq4LXQlbeOdi4dbikgXHzPTZtBypP4BA5fnK0GLWd',
  'stat_WwdLVYybpd3l1KXTy8CJat1RzFgT7LbeuxU4A8jVdA6',
]);
const LOST_OPPORTUNITY_STATUS_ID = 'stat_JsVAn7jtb6qbyxc0j77Kh6SkONCIC6gpsTF21WUkFvs';

if (!CLOSE_API_KEY) {
  console.error('Missing CLOSE_API_KEY in environment.');
  process.exit(1);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJSON(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function writeCSV(file, rows, columns) {
  const lines = [
    columns.map(c => csvCell(c.header)).join(','),
    ...rows.map(row => columns.map(c => csvCell(c.value(row))).join(',')),
  ];
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

function dollars(cents) {
  const value = Number(cents || 0);
  return Number.isFinite(value) ? Math.round(value / 100) : 0;
}

function closeRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const hasBody = body !== null && body !== undefined;
    const data = hasBody ? JSON.stringify(body) : '';
    const headers = {
      Authorization: `Basic ${Buffer.from(`${CLOSE_API_KEY}:`).toString('base64')}`,
      Accept: 'application/json',
    };
    if (hasBody) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = https.request({
      hostname: 'api.close.com',
      path: `/api/v1${endpoint}`,
      method,
      headers,
    }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = raw ? JSON.parse(raw) : {}; }
        catch { parsed = { raw }; }
        if (res.statusCode >= 400) {
          const msg = parsed.error || parsed.errors || parsed.message || raw || `Close returned ${res.statusCode}`;
          reject(new Error(`${method} ${endpoint}: ${res.statusCode} ${JSON.stringify(msg).slice(0, 500)}`));
          return;
        }
        resolve(parsed);
      });
    });
    req.setTimeout(30000, () => {
      req.destroy(new Error(`Timeout calling Close ${method} ${endpoint}`));
    });
    req.on('error', reject);
    if (hasBody) req.write(data);
    req.end();
  });
}

async function paginate(endpoint, { limit = 100, safety = 100 } = {}) {
  const rows = [];
  let cursor = null;
  let guard = safety;
  do {
    const joiner = endpoint.includes('?') ? '&' : '?';
    const cursorParam = cursor ? `&_cursor=${encodeURIComponent(cursor)}` : '';
    const page = await closeRequest('GET', `${endpoint}${joiner}_limit=${limit}${cursorParam}`);
    rows.push(...(page.data || []));
    cursor = page.cursor || null;
    guard -= 1;
  } while (cursor && guard > 0);
  return rows;
}

async function offsetPaginate(endpoint, { limit = 100, safety = 200, label = endpoint } = {}) {
  const rows = [];
  for (let skip = 0, guard = 0; guard < safety; skip += limit, guard += 1) {
    const joiner = endpoint.includes('?') ? '&' : '?';
    const page = await closeRequest('GET', `${endpoint}${joiner}_limit=${limit}&_skip=${skip}`);
    rows.push(...(page.data || []));
    if (guard === 0 || guard % 10 === 0) {
      console.log(`[page] ${label}: skip ${skip}, rows ${rows.length}`);
    }
    if (!page.has_more || !page.data?.length) break;
  }
  return rows;
}

function extractContactIndex(lead, viewIds) {
  const contacts = lead.contacts || [];
  const rows = [];
  for (const contact of contacts) {
    const emails = (contact.emails || []).map(e => ({
      email: e.email,
      type: e.type || null,
      is_unsubscribed: !!e.is_unsubscribed,
    })).filter(e => e.email);
    const phones = (contact.phones || []).map(p => ({
      phone: p.phone,
      phone_formatted: p.phone_formatted || p.phone,
      type: p.type || null,
      country: p.country || null,
    })).filter(p => p.phone);
    rows.push({
      lead_id: lead.id,
      lead_name: lead.display_name || lead.name || '',
      lead_url: lead.html_url || null,
      saved_view_ids: viewIds,
      contact_id: contact.id,
      contact_name: contact.display_name || contact.name || '',
      title: contact.title || '',
      timezone: contact.timezone || null,
      emails,
      phones,
      can_email: emails.some(e => !e.is_unsubscribed),
      can_sms: phones.length > 0,
    });
  }
  return rows;
}

function slimLead(lead, viewIds, viewNames) {
  const opportunities = (lead.opportunities || []).map(o => ({
    id: o.id,
    contact_id: o.contact_id || null,
    contact_name: o.contact_name || null,
    status_id: o.status_id || null,
    status_label: o.status_label || null,
    status_type: o.status_type || null,
    pipeline_id: o.pipeline_id || null,
    value: dollars(o.value),
    value_cents: o.value || 0,
    confidence: o.confidence || 0,
    date_created: o.date_created || null,
    date_updated: o.date_updated || null,
    close_at: o.close_at || null,
    note: o.note || null,
  }));
  return {
    id: lead.id,
    name: lead.display_name || lead.name || '',
    url: lead.html_url || null,
    status_id: lead.status_id || null,
    status_label: lead.status_label || null,
    status_type: lead.status_type || null,
    primary_email: lead.primary_email || null,
    primary_phone: lead.primary_phone || null,
    description: lead.description || '',
    date_created: lead.date_created || null,
    date_updated: lead.date_updated || null,
    saved_view_ids: viewIds,
    saved_view_names: viewNames,
    custom: lead.custom || {},
    contacts: extractContactIndex(lead, viewIds),
    opportunities,
    opportunity_value_total: opportunities.reduce((sum, o) => sum + (o.value || 0), 0),
  };
}

function customValue(lead, label, id) {
  const custom = lead.custom || {};
  return custom[label] ?? custom[`custom.${id}`] ?? custom[id] ?? lead[`custom.${id}`] ?? null;
}

function valueList(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function hasAndreOwner(lead) {
  return valueList(customValue(lead, '00. 🪖 LEAD OWNER', OWNER_FIELD_ID)).includes(OWNER_VALUE);
}

function notRetiredLead(lead) {
  return !EXCLUDED_LEAD_STATUS_IDS.has(lead.status_id);
}

function opps(lead) {
  return Array.isArray(lead.opportunities) ? lead.opportunities : [];
}

function hasOppIn(lead, ids) {
  return opps(lead).some(o => ids.has(o.status_id));
}

function hasNoOppIn(lead, ids) {
  return opps(lead).every(o => !ids.has(o.status_id));
}

function dateMs(value) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function withinHours(value, hours, now = Date.now()) {
  const ms = dateMs(value);
  if (ms == null) return false;
  return ms <= now && ms >= now - hours * 60 * 60 * 1000;
}

function olderThanDays(value, days, now = Date.now()) {
  const ms = dateMs(value);
  if (ms == null) return true;
  return ms < now - days * 24 * 60 * 60 * 1000;
}

function ageDays(value, now = Date.now()) {
  const ms = dateMs(value);
  if (ms == null) return null;
  return Math.floor((now - ms) / (24 * 60 * 60 * 1000));
}

function startedToday(value) {
  const ms = dateMs(value);
  if (ms == null) return false;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return ms >= d.getTime();
}

function callLongerThanTwoMinutes(call) {
  return Number(call.duration || 0) > 120;
}

function viewMatcher(viewName, callsByLead, now = Date.now()) {
  return lead => {
    if (!hasAndreOwner(lead)) return false;
    if (viewName.includes("Today's Leads")) {
      return notRetiredLead(lead) && (startedToday(lead.date_created) || withinHours(lead.date_created, 24, now));
    }
    if (viewName.includes('Day 1-5')) {
      const age = ageDays(lead.date_created, now);
      return notRetiredLead(lead) && hasOppIn(lead, ACTIVE_OPPORTUNITY_STATUS_IDS) && age != null && age >= 1 && age <= 5;
    }
    if (viewName.includes('Day 6-10')) {
      const age = ageDays(lead.date_created, now);
      return notRetiredLead(lead) && hasOppIn(lead, ACTIVE_OPPORTUNITY_STATUS_IDS) && age != null && age >= 6 && age <= 10;
    }
    if (viewName.includes('Opened Email')) {
      return hasNoOppIn(lead, new Set([LOST_OPPORTUNITY_STATUS_ID])) && withinHours(lead.last_email_last_open_date, 24, now);
    }
    if (viewName.includes('No Connect Made')) {
      const calls = callsByLead.get(lead.id) || [];
      return notRetiredLead(lead)
        && hasOppIn(lead, ACTIVE_OPPORTUNITY_STATUS_IDS)
        && !calls.some(callLongerThanTwoMinutes)
        && lead.last_communication_direction !== 'incoming'
        && !startedToday(lead.last_outgoing_call_date);
    }
    if (viewName.includes('Needs Response')) {
      return hasOppIn(lead, NEEDS_RESPONSE_OPPORTUNITY_STATUS_IDS)
        && lead.last_communication_direction === 'incoming'
        && withinHours(lead.last_communication_date, 75, now);
    }
    if (viewName.includes('Booked Tastings')) {
      return hasOppIn(lead, new Set([BOOKED_TASTING_STATUS_ID]));
    }
    if (viewName.includes('Long-Term') || viewName.includes('Dormant Followup')) {
      return hasOppIn(lead, DORMANT_STATUS_IDS) && olderThanDays(lead.last_communication_date, 28, now);
    }
    if (viewName.includes('All Other Followup')) {
      return notRetiredLead(lead)
        && hasOppIn(lead, ACTIVE_OPPORTUNITY_STATUS_IDS)
        && olderThanDays(lead.last_communication_date, 3, now);
    }
    return false;
  };
}

async function loadAllLeadCandidates() {
  const fields = [
    'id', 'name', 'display_name', 'contacts', 'custom', 'status_id', 'status_label',
    'date_created', 'date_updated', 'html_url', 'url', 'opportunities',
    'primary_email', 'primary_phone', 'description',
    'last_communication_date', 'last_communication_direction',
    'last_email_last_open_date', 'last_outgoing_call_date',
  ].join(',');
  return offsetPaginate(`/lead/?_fields=${encodeURIComponent(fields)}`, { limit: 100, safety: 160, label: 'all leads' });
}

async function loadRecentCallsForAndre() {
  const calls = await offsetPaginate('/activity/call/?_fields=id,lead_id,duration,date_created,activity_at,remote_phone,remote_phone_formatted&_order_by=-date_created', { limit: 100, safety: 80, label: 'recent calls' });
  const byLead = new Map();
  for (const call of calls) {
    if (!call.lead_id) continue;
    if (!byLead.has(call.lead_id)) byLead.set(call.lead_id, []);
    byLead.get(call.lead_id).push(call);
  }
  return byLead;
}

function normalizeActivity(type, a) {
  const base = {
    id: a.id,
    type,
    close_type: a._type || null,
    lead_id: a.lead_id || null,
    contact_id: a.contact_id || null,
    date_created: a.date_created || null,
    date_updated: a.date_updated || null,
    activity_at: a.activity_at || a.date_sent || a.date_created || null,
    direction: a.direction || null,
    status: a.status || null,
    user_name: a.user_name || a.created_by_name || null,
  };
  if (type === 'email') {
    return {
      ...base,
      subject: a.envelope?.subject || '',
      from: a.envelope?.from || [],
      to: a.envelope?.to || [],
      cc: a.envelope?.cc || [],
      body_preview: (a.body_preview || a.body_text || a.body_text_quoted?.[0]?.text || '').toString().slice(0, 1200),
      template_name: a.template_name || null,
    };
  }
  if (type === 'sms') {
    return {
      ...base,
      remote_phone: a.remote_phone || null,
      remote_phone_formatted: a.remote_phone_formatted || null,
      local_phone: a.local_phone || null,
      text: (a.text || '').toString(),
    };
  }
  if (type === 'call') {
    return {
      ...base,
      remote_phone: a.remote_phone || null,
      remote_phone_formatted: a.remote_phone_formatted || null,
      duration: a.duration || 0,
      disposition: a.disposition || null,
      note: (a.note || a.outcome_autofill_reasoning || '').toString().slice(0, 1600),
      recording_url: a.recording_url || null,
    };
  }
  if (type === 'note') {
    return {
      ...base,
      note: (a.note || '').toString(),
      title: a.title || null,
    };
  }
  return {
    ...base,
    title: a.title || null,
    summary: (a.note || a.text || a.body_preview || a.new_status_label || a.old_status_label || '').toString().slice(0, 1200),
    raw_type: a._type || null,
  };
}

function normalizeTask(t) {
  return {
    id: t.id,
    lead_id: t.lead_id || null,
    lead_name: t.lead_name || null,
    contact_id: t.contact_id || null,
    contact_name: t.contact_name || null,
    text: t.text || '',
    date: t.date || t.due_date || null,
    due_date: t.due_date || t.date || null,
    view: t.view || null,
    priority: t.priority || null,
    is_complete: !!t.is_complete,
    assigned_to: t.assigned_to || null,
    assigned_to_name: t.assigned_to_name || null,
    date_created: t.date_created || null,
    date_updated: t.date_updated || null,
  };
}

async function enrichLead(leadId) {
  const [general, emails, sms, calls, notes, tasks] = await Promise.all([
    paginate(`/activity/?lead_id=${encodeURIComponent(leadId)}&_order_by=-date_created`, { limit: 100, safety: 10 }).catch(e => ({ error: e.message, data: [] })),
    paginate(`/activity/email/?lead_id=${encodeURIComponent(leadId)}&_order_by=-date_created`, { limit: 100, safety: 10 }).catch(e => ({ error: e.message, data: [] })),
    paginate(`/activity/sms/?lead_id=${encodeURIComponent(leadId)}&_order_by=-date_created`, { limit: 100, safety: 10 }).catch(e => ({ error: e.message, data: [] })),
    paginate(`/activity/call/?lead_id=${encodeURIComponent(leadId)}&_order_by=-date_created`, { limit: 100, safety: 10 }).catch(e => ({ error: e.message, data: [] })),
    paginate(`/activity/note/?lead_id=${encodeURIComponent(leadId)}&_order_by=-date_created`, { limit: 100, safety: 10 }).catch(e => ({ error: e.message, data: [] })),
    paginate(`/task/?lead_id=${encodeURIComponent(leadId)}&_order_by=date`, { limit: 100, safety: 10 }).catch(e => ({ error: e.message, data: [] })),
  ]);
  const arr = v => Array.isArray(v) ? v : [];
  return {
    lead_id: leadId,
    activities: {
      general: arr(general).map(a => normalizeActivity('general', a)),
      emails: arr(emails).map(a => normalizeActivity('email', a)),
      sms: arr(sms).map(a => normalizeActivity('sms', a)),
      calls: arr(calls).map(a => normalizeActivity('call', a)),
      notes: arr(notes).map(a => normalizeActivity('note', a)),
    },
    tasks: arr(tasks).map(normalizeTask),
  };
}

function buildSummary({ views, leads, contacts, enrichments }) {
  const emailContacts = contacts.filter(c => c.emails?.length);
  const phoneContacts = contacts.filter(c => c.phones?.length);
  const leadIdsWithActivity = new Set();
  const activityCounts = { general: 0, emails: 0, sms: 0, calls: 0, notes: 0, tasks: 0 };
  for (const e of Object.values(enrichments)) {
    for (const key of ['general', 'emails', 'sms', 'calls', 'notes']) {
      const count = e.activities?.[key]?.length || 0;
      activityCounts[key] += count;
      if (count) leadIdsWithActivity.add(e.lead_id);
    }
    const taskCount = e.tasks?.length || 0;
    activityCounts.tasks += taskCount;
    if (taskCount) leadIdsWithActivity.add(e.lead_id);
  }
  return {
    generated_at: new Date().toISOString(),
    source: 'close-api:local-reconstructed-saved-views',
    saved_view_count: views.length,
    unique_lead_count: leads.length,
    contact_count: contacts.length,
    contacts_with_email: emailContacts.length,
    contacts_with_phone: phoneContacts.length,
    contacts_with_both_email_and_phone: contacts.filter(c => c.emails?.length && c.phones?.length).length,
    leads_with_any_activity_or_task: leadIdsWithActivity.size,
    activity_counts: activityCounts,
    views: views.map(v => ({
      id: v.id,
      name: v.name || v.id,
      url: v.url,
      lead_count: v.lead_count || 0,
    })),
  };
}

function markdownReport(summary, leads, contacts) {
  const lines = [];
  lines.push('# Andre Close Saved Views Export');
  lines.push('');
  lines.push(`Generated: ${summary.generated_at}`);
  lines.push(`Source: ${summary.source}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Saved views: ${summary.saved_view_count}`);
  lines.push(`- Unique leads: ${summary.unique_lead_count}`);
  lines.push(`- Contacts indexed: ${summary.contact_count}`);
  lines.push(`- Contacts with email: ${summary.contacts_with_email}`);
  lines.push(`- Contacts with phone: ${summary.contacts_with_phone}`);
  lines.push(`- Contacts with both: ${summary.contacts_with_both_email_and_phone}`);
  lines.push(`- Leads with activity/tasks: ${summary.leads_with_any_activity_or_task}`);
  lines.push('');
  lines.push('## Saved Views');
  lines.push('');
  for (const view of summary.views) {
    lines.push(`- ${view.name}: ${view.lead_count} leads (${view.id})`);
  }
  lines.push('');
  lines.push('## Contact Readiness');
  lines.push('');
  for (const lead of leads.slice(0, 200)) {
    const leadContacts = contacts.filter(c => c.lead_id === lead.id);
    const emails = leadContacts.flatMap(c => c.emails || []).map(e => e.email);
    const phones = leadContacts.flatMap(c => c.phones || []).map(p => p.phone_formatted || p.phone);
    lines.push(`- ${lead.name}: ${emails.length ? emails.join(', ') : 'no email'} | ${phones.length ? phones.join(', ') : 'no phone'}`);
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  ensureDir(OUT_DIR);
  ensureDir(VIEWS_DIR);

  const viewResults = [];
  const byLead = new Map();
  const allLeads = await loadAllLeadCandidates();
  const callsByLead = await loadRecentCallsForAndre();
  const andreLeads = allLeads.filter(hasAndreOwner);
  console.log(`[scan] ${allLeads.length} total Close leads; ${andreLeads.length} owned by Andre`);

  for (const inputView of config.views || []) {
    const view = await closeRequest('GET', `/saved_search/${inputView.id}/`);
    const matcher = viewMatcher(view.name || inputView.id, callsByLead);
    const leads = andreLeads.filter(matcher);
    const viewRecord = {
      id: inputView.id,
      url: inputView.url,
      name: view.name || inputView.id,
      description: view.description || '',
      selected_fields: view.selected_fields || [],
      query: view.query || null,
      s_query: view.s_query || null,
      lead_count: leads.length,
      reconstruction: 'local-filtered-from-close-leads',
      lead_ids: leads.map(l => l.id),
    };
    viewResults.push(viewRecord);
    writeJSON(path.join(VIEWS_DIR, `${inputView.id}.json`), { view: viewRecord, leads });

    for (const lead of leads) {
      const existing = byLead.get(lead.id) || { lead, viewIds: [], viewNames: [] };
      existing.lead = { ...existing.lead, ...lead };
      if (!existing.viewIds.includes(inputView.id)) existing.viewIds.push(inputView.id);
      if (!existing.viewNames.includes(viewRecord.name)) existing.viewNames.push(viewRecord.name);
      byLead.set(lead.id, existing);
    }
    console.log(`[saved-view] ${viewRecord.name}: ${leads.length} leads`);
  }

  const slimLeads = Array.from(byLead.values())
    .map(row => slimLead(row.lead, row.viewIds, row.viewNames))
    .sort((a, b) => a.name.localeCompare(b.name));
  const contacts = slimLeads.flatMap(l => l.contacts);

  const enrichments = {};
  let done = 0;
  for (const lead of slimLeads) {
    done += 1;
    console.log(`[enrich] ${done}/${slimLeads.length} ${lead.name}`);
    enrichments[lead.id] = await enrichLead(lead.id);
  }

  const summary = buildSummary({ views: viewResults, leads: slimLeads, contacts, enrichments });
  const index = {
    _meta: summary,
    files: {
      summary: 'summary.json',
      report: 'report.md',
      leads: 'leads.json',
      contacts: 'contacts.json',
      activities_by_lead: 'activities_by_lead.json',
      saved_views: 'saved_views.json',
      raw_view_exports: 'views/*.json',
    },
  };

  writeJSON(path.join(OUT_DIR, 'index.json'), index);
  writeJSON(path.join(OUT_DIR, 'summary.json'), summary);
  writeJSON(path.join(OUT_DIR, 'saved_views.json'), viewResults);
  writeJSON(path.join(OUT_DIR, 'leads.json'), slimLeads);
  writeJSON(path.join(OUT_DIR, 'contacts.json'), contacts);
  writeJSON(path.join(OUT_DIR, 'activities_by_lead.json'), enrichments);
  writeJSON(path.join(OUT_DIR, 'outbound_ready.json'), contacts.map(contact => ({
    lead_id: contact.lead_id,
    lead_name: contact.lead_name,
    lead_url: contact.lead_url,
    contact_id: contact.contact_id,
    contact_name: contact.contact_name,
    emails: contact.emails.map(e => e.email),
    phones: contact.phones.map(p => p.phone),
    phone_labels: contact.phones.map(p => p.phone_formatted || p.phone),
    can_email: contact.can_email,
    can_sms: contact.can_sms,
    saved_view_ids: contact.saved_view_ids,
  })));
  writeCSV(path.join(OUT_DIR, 'contacts.csv'), contacts, [
    { header: 'lead_id', value: r => r.lead_id },
    { header: 'lead_name', value: r => r.lead_name },
    { header: 'lead_url', value: r => r.lead_url },
    { header: 'contact_id', value: r => r.contact_id },
    { header: 'contact_name', value: r => r.contact_name },
    { header: 'emails', value: r => r.emails.map(e => e.email).join('; ') },
    { header: 'phones', value: r => r.phones.map(p => p.phone).join('; ') },
    { header: 'phone_labels', value: r => r.phones.map(p => p.phone_formatted || p.phone).join('; ') },
    { header: 'can_email', value: r => r.can_email ? 'yes' : 'no' },
    { header: 'can_sms', value: r => r.can_sms ? 'yes' : 'no' },
    { header: 'saved_view_ids', value: r => r.saved_view_ids.join('; ') },
  ]);
  fs.writeFileSync(path.join(OUT_DIR, 'report.md'), markdownReport(summary, slimLeads, contacts));

  console.log(`\nWrote ${OUT_DIR}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
