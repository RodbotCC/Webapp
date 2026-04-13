// ═══════════════════════════════════════
// ANDRE SALES COMMAND CENTER — Core + Data
// Comeketo Brazilian Steakhouse · Catering Division
// ═══════════════════════════════════════
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const stageScroll = $('#stageScroll');
const previewBody = $('#previewBody');
let currentView = 'command';
let P = {}, K = {}, L = {}, T = {}; // profile, kpis, pipeline, tasks
let OT = {}, OC = {}, OS = {}; // oracle templates, oracle cadences, oracle scenarios
let SETTINGS = {}; // app settings (BYOK, model, etc.)
let ACT = { log: [] }; // activity log for timeline/calendar
let AUT = { automations: [], runs: [], engine: {}, hooks: {} };
let OPS = { context: {}, daily: {}, _meta: {} };
let DOCS = { voiceSummary: '', voiceReadme: '' };
let AI_ARTIFACTS = [];
/** HRMR-style: one-tap choices from guided Oracle steps */
let ORACLE_CHOICE_LOG = [];
/** Graded corpus-lite: A+…F per turn for director signal */
let ORACLE_GRADED_CORPUS = [];
let currentDealFilter = '';
let graphState = { nodes: [], selectedId: null };

// ═══════════════════════════════════════
// IndexedDB — Browser Persistence Layer
// ═══════════════════════════════════════
const IDB = (() => {
  const DB_NAME = 'comeketo_command_center';
  const DB_VERSION = 1;
  const STORE = 'app_cache';

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function get(key) {
    try {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result?.value ?? null);
        req.onerror = () => reject(req.error);
      });
    } catch(e) { console.warn('IDB get error:', e); return null; }
  }

  async function set(key, value) {
    try {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        store.put({ key, value, updated_at: new Date().toISOString() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch(e) { console.warn('IDB set error:', e); return false; }
  }

  async function getAll() {
    try {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch(e) { console.warn('IDB getAll error:', e); return []; }
  }

  async function remove(key) {
    try {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        store.delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch(e) { console.warn('IDB remove error:', e); return false; }
  }

  // Cache all data stores to IndexedDB
  async function cacheAll() {
    await Promise.all([
      set('profile', P),
      set('kpis', K),
      set('pipeline', L),
      set('tasks', T),
      set('ops', OPS),
      set('oracle_templates', OT),
      set('oracle_cadences', OC),
      set('oracle_scenarios', OS),
      set('live_crm', LIVE),
      set('queue', Q),
      set('settings', SETTINGS),
      set('last_cached', new Date().toISOString()),
    ]);
    console.log('[IDB] All data cached to IndexedDB');
  }

  // Load from cache (returns true if cache existed)
  async function loadFromCache() {
    const cached = await get('last_cached');
    if (!cached) return false;
    const [p, k, l, t, ops, ot, oc, os, live, q, s] = await Promise.all([
      get('profile'), get('kpis'), get('pipeline'), get('tasks'),
      get('ops'),
      get('oracle_templates'), get('oracle_cadences'), get('oracle_scenarios'),
      get('live_crm'), get('queue'), get('settings'),
    ]);
    if (p) P = p; if (k) K = k; if (l) L = l; if (t) T = t;
    if (ops) OPS = ops;
    if (ot) OT = ot; if (oc) OC = oc; if (os) OS = os;
    if (live) LIVE = live; if (q) Q = q; if (s) SETTINGS = s;
    console.log(`[IDB] Loaded from cache (cached ${cached})`);
    return true;
  }

  return { get, set, getAll, remove, cacheAll, loadFromCache };
})()

async function loadAiPersistence() {
  chatHistory = await IDB.get('oracle_chat_history') || [];
  ORACLE_CHOICE_LOG = await IDB.get('oracle_choice_log') || [];
  ORACLE_GRADED_CORPUS = await IDB.get('oracle_graded_corpus') || [];
  AI_ARTIFACTS = await IDB.get('ai_artifacts') || [];
}

async function persistChatHistory() {
  await IDB.set('oracle_chat_history', chatHistory.slice(-40));
}

async function persistOracleChoiceLog() {
  await IDB.set('oracle_choice_log', (ORACLE_CHOICE_LOG || []).slice(0, 120));
}

async function persistOracleGraded() {
  await IDB.set('oracle_graded_corpus', (ORACLE_GRADED_CORPUS || []).slice(0, 80));
}

async function persistAiArtifact(artifact) {
  const next = [{
    id: `ai_${Date.now()}`,
    saved_at: new Date().toISOString(),
    ...artifact,
  }, ...(AI_ARTIFACTS || [])].slice(0, 40);
  AI_ARTIFACTS = next;
  await IDB.set('ai_artifacts', next);
}

// ═══════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════
const Toast = (() => {
  let container = null;
  function init() {
    if (container) return;
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:0.5rem;pointer-events:none;';
    document.body.appendChild(container);
  }
  function show(message, type = 'info', duration = 4000) {
    init();
    const toast = document.createElement('div');
    const colors = { success:'#5CBF80', error:'#E87A5A', warning:'#C9A84C', info:'#5BA8C8' };
    const icons = { success:'check_circle', error:'error', warning:'warning', info:'info' };
    toast.style.cssText = `pointer-events:auto;display:flex;align-items:center;gap:0.6rem;padding:0.8rem 1.2rem;border-radius:0.75rem;background:#1A1A1A;border:1px solid ${colors[type]}30;box-shadow:0 8px 32px rgba(0,0,0,0.4);color:#F0E8D4;font-family:'DM Sans',sans-serif;font-size:0.78rem;max-width:24rem;transform:translateX(120%);transition:all 350ms cubic-bezier(0.4,0,0.2,1);`;
    toast.innerHTML = `<span class="material-symbols-outlined" style="font-size:1.1rem;color:${colors[type]};">${icons[type]}</span><span style="flex:1;">${message}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => { toast.style.transform = 'translateX(0)'; toast.style.opacity = '1'; });
    setTimeout(() => {
      toast.style.transform = 'translateX(120%)'; toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 400);
    }, duration);
  }
  return { show, success: (m,d) => show(m,'success',d), error: (m,d) => show(m,'error',d), warning: (m,d) => show(m,'warning',d), info: (m,d) => show(m,'info',d) };
})();

function badge(label, cls = '') { return `<span class="badge ${cls}">${label}</span>`; }
function fmt$(v) { return v == null ? '—' : '$' + Number(v).toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0}); }
function fmtPct(v) { return v == null ? '—' : v + '%'; }
let previewPinned = false;
let pinnedHtml = '';
function setPreview(html, pin) {
  if (pin) { previewPinned = true; pinnedHtml = html; }
  else if (previewPinned) return; // don't overwrite a pinned preview with a hover
  previewBody.innerHTML = html + (previewPinned || pin ? '<button onclick="unpinPreview()" style="position:absolute;top:0.6rem;right:0.6rem;background:none;border:none;cursor:pointer;color:var(--burgundy);opacity:0.4;padding:0.2rem;"><span class="material-symbols-outlined" style="font-size:0.9rem;">close</span></button>' : '');
  if(window.lucide)lucide.createIcons();
}
function clearPreview() {
  if (previewPinned) return; // pinned — don't clear on mouseleave
  previewBody.innerHTML = '<div class="preview-empty"><i data-lucide="mouse-pointer-click" style="width:2.5rem;height:2.5rem;color:var(--burgundy);margin-bottom:0.6rem;"></i><p>Click any item to pin details</p></div>';
  if(window.lucide)lucide.createIcons();
}
window.unpinPreview = function() {
  previewPinned = false; pinnedHtml = '';
  previewBody.innerHTML = '<div class="preview-empty"><i data-lucide="mouse-pointer-click" style="width:2.5rem;height:2.5rem;color:var(--burgundy);margin-bottom:0.6rem;"></i><p>Click any item to pin details</p></div>';
  if(window.lucide)lucide.createIcons();
};

function normText(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function setActiveNav(view) {
  $$('.sb-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
}

window.navigateTo = function(view) {
  setActiveNav(view);
  showView(view);
};

function findDealByName(name) {
  const target = normText(name);
  if (!target) return null;
  return (L.all_deals || L.high_value_deals || []).find(d =>
    [d.name, d.event, d.venue].some(v => {
      const normalized = normText(v);
      return normalized && (normalized === target || normalized.includes(target) || target.includes(normalized));
    })
  ) || null;
}

/** Concatenated normalized text for search (deals + command palette). */
function dealSearchHaystack(d) {
  if (!d) return '';
  const bits = [
    d.name, d.stage, d.event, d.venue, d.guests, d.priority, d.confidence, d.lead_id, d.status,
    d.value != null ? String(d.value) : '',
    ...(Array.isArray(d.risk) ? d.risk : []),
  ];
  return normText(bits.filter(Boolean).join(' '));
}

function relatedMatchesToDeals(related = []) {
  return related.map(findDealByName).filter(Boolean);
}

function renderPreviewActionRow(actions = []) {
  if (!actions.length) return '';
  return `<div class="preview-action-row">${actions.join('')}</div>`;
}

function getTemplateCatalog() {
  return {
    email: OT.email_templates || [],
    sms: OT.sms_templates || [],
  };
}

function inferDealCadenceKey(deal) {
  const stage = normText(deal?.stage);
  if (stage.includes('tasting')) return 'post_tasting';
  if (stage.includes('deposit') || stage.includes('fully paid')) return 'closing';
  if (stage.includes('proposal') || stage.includes('quoted')) return 'proposal_follow_up';
  return 'inbound_5_day';
}

function pickTemplatesForDeal(deal) {
  const catalog = getTemplateCatalog();
  const cadence = inferDealCadenceKey(deal);
  const email = catalog.email.find(t => t.cadence === cadence) || catalog.email[0] || null;
  const sms = catalog.sms.find(t => t.cadence === cadence) || catalog.sms[0] || null;
  return { email, sms, cadence };
}

function buildDealCommsPlan(deal) {
  const stage = normText(deal?.stage);
  const risk = (deal?.risk || []).map(normText);
  const templates = pickTemplatesForDeal(deal);
  const oracleMap = OS.deal_oracle_map?.[deal?.name];
  const packet = oracleMap?.packet ? (OC.reality_packets || []).find(p => p.id === oracleMap.packet) : null;
  const isRisky = risk.length > 0 || deal?.status === 'at_risk' || (deal?.confidence || 0) < 75;
  const channel = packet?.channel
    ? packet.channel.replace(/\+/g, ' + ').replace(/\b\w/g, c => c.toUpperCase())
    : stage.includes('tasting')
      ? 'Phone + email'
      : isRisky
        ? 'Text + AI recovery'
        : 'Email + follow-up call';
  const objective = stage.includes('deposit')
    ? 'Get signature momentum and remove friction'
    : stage.includes('tasting')
      ? 'Convert tasting interest into a scheduled decision'
      : stage.includes('fully paid')
        ? 'Protect relationship and referral value'
        : 'Re-open conversation and surface real buying blockers';
  const tone = isRisky ? 'Direct, calm, confidence-restoring' : 'Warm, specific, commercially sharp';
  const urgency = deal?.value >= 5000 ? 'high' : isRisky ? 'medium' : 'low';
  return {
    channel,
    objective,
    tone,
    urgency,
    cadence: templates.cadence,
    packet,
    email: templates.email,
    sms: templates.sms,
  };
}

function getExecutiveActionBoard() {
  const todayTasks = (T.tasks?.today || []).slice();
  const attention = (LIVE.needs_attention || []).slice();
  const closingSoon = (LIVE.closing_soon || []).slice();
  const alerts = (LIVE.alerts || []).slice();

  const criticalMoves = [
    ...alerts.map(a => ({
      kind: 'alert',
      name: a.name,
      value: a.value || 0,
      title: 'Critical exception',
      subtitle: a.message,
      action: a.action_required,
      urgency: 'urgent',
      icon: 'warning',
    })),
    ...closingSoon.map(d => ({
      kind: 'closing',
      name: d.name,
      value: d.value || 0,
      title: 'Closing window',
      subtitle: `${d.stage} · ${d.days_until_close} days left`,
      action: d.note || 'Make decision call now',
      urgency: 'urgent',
      icon: 'event_upcoming',
    })),
    ...todayTasks.map(t => ({
      kind: 'task',
      name: t.lead,
      value: t.value || 0,
      title: 'Today move',
      subtitle: t.category?.replace(/_/g, ' ') || 'task',
      action: t.action,
      urgency: t.urgency || 'high',
      icon: t.icon || 'bolt',
    })),
    ...attention.map(d => ({
      kind: 'attention',
      name: d.name,
      value: d.value || 0,
      title: 'Needs attention',
      subtitle: d.stage,
      action: d.reason,
      urgency: d.urgency || 'medium',
      icon: 'priority_high',
    }))
  ]
    .sort((a, b) => {
      const urgencyRank = { urgent: 3, high: 2, medium: 1, low: 0 };
      return (urgencyRank[b.urgency] || 0) - (urgencyRank[a.urgency] || 0) || (b.value || 0) - (a.value || 0);
    })
    .slice(0, 6);

  const totalActive = L.summary?.active_deals || 0;
  const atRisk = L.summary?.at_risk_revenue || 0;
  const locked = L.summary?.locked_in_revenue || 0;
  const pipeline = L.summary?.total_pipeline || 0;
  const pressurePct = pipeline ? Math.round((atRisk / pipeline) * 100) : 0;

  return {
    criticalMoves,
    pressurePct,
    totalActive,
    atRisk,
    locked,
    pipeline,
  };
}

function getMorningBriefData() {
  const todayTasks = (T.tasks?.today || []).slice(0, 6);
  const bottlenecks = (T.bottlenecks || []).slice(0, 3);
  const openLoops = (T.open_loops || []).slice(0, 3);
  const closingSoon = (LIVE.closing_soon || []).slice(0, 3);
  const alerts = (LIVE.alerts || []).slice(0, 3);
  const attention = (LIVE.needs_attention || []).slice(0, 5);
  const sendToday = [
    ...todayTasks.map(t => ({
      name: t.lead,
      reason: t.action,
      type: 'task',
      urgency: t.urgency || 'high',
      value: t.value || 0,
    })),
    ...closingSoon.map(d => ({
      name: d.name,
      reason: d.note || `Closing in ${d.days_until_close} days`,
      type: 'closing',
      urgency: 'urgent',
      value: d.value || 0,
    }))
  ]
    .sort((a, b) => (b.value || 0) - (a.value || 0))
    .slice(0, 5);

  const slipping = [
    ...alerts.map(a => ({
      name: a.name,
      reason: a.message,
      type: 'alert',
      urgency: 'urgent',
    })),
    ...attention.map(d => ({
      name: d.name,
      reason: d.reason,
      type: 'attention',
      urgency: d.urgency || 'medium',
    }))
  ].slice(0, 5);

  return {
    sendToday,
    slipping,
    bottlenecks,
    openLoops,
    headline: `${todayTasks.length} tasks today · ${closingSoon.length} closing soon · ${alerts.length} critical exception${alerts.length === 1 ? '' : 's'}`,
  };
}

function renderMiniMarkdownPanel(title, body, icon = 'description', accent = 'var(--gold)') {
  if (!body) return '';
  return `
    <div class="markdown-panel">
      <div class="markdown-panel-head">
        <div class="markdown-panel-title"><span class="material-symbols-outlined" style="font-size:0.95rem;color:${accent};">${icon}</span>${title}</div>
      </div>
      <div class="markdown-panel-body md-content">${renderMd(body)}</div>
    </div>
  `;
}

window.pinMarkdownToPreview = function(title, content) {
  setPreview(`
    <div class="pv-title">${title || 'Pinned panel'}</div>
    <div class="pv-sub">Markdown panel</div>
    <div class="pv-divider"></div>
    <div class="md-content">${renderMd(content || '')}</div>
  `, true);
};

window.openDealWorkspace = function(name, view) {
  const deal = findDealByName(name);
  if (!deal) {
    Toast.warning('Could not match a deal for ' + name);
    return;
  }
  currentDealFilter = deal.name;
  navigateTo(view || 'deals');
  setTimeout(() => {
    if (currentView === 'deals') {
      const input = $('#dealSearch');
      if (input) {
        input.value = deal.name;
        filterDeals(deal.name);
      }
    }
    previewDeal(null, deal, true);
  }, 30);
};

window.openDealFilter = function(query) {
  currentDealFilter = query || '';
  navigateTo('deals');
  setTimeout(() => {
    const input = $('#dealSearch');
    if (input) {
      input.value = query || '';
      filterDeals(query || '');
    }
  }, 40);
};

window.previewActivity = function(activity, pin) {
  const e = typeof activity === 'string' ? JSON.parse(activity.replace(/&quot;/g,'"').replace(/&#39;/g,"'")) : activity;
  const relatedDeals = relatedMatchesToDeals(e.related || []);
  const time = e.ts ? new Date(e.ts).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : 'Unknown time';
  setPreview(`
    <div class="pv-title">${e.summary || 'Activity'}</div>
    <div class="pv-sub">${(e.category || e.type || 'system').replace(/_/g, ' ')} · ${time}</div>
    <div class="pv-divider"></div>
    <div class="pv-field"><span class="pv-field-label">Type</span><span class="pv-field-value">${e.type || '—'}</span></div>
    <div class="pv-field"><span class="pv-field-label">Category</span><span class="pv-field-value">${(e.category || '—').replace(/_/g, ' ')}</span></div>
    ${e.details ? `<div class="pv-divider"></div><div class="pv-section-label">Detail</div><p style="font-size:0.73rem;line-height:1.55;color:var(--maroon);opacity:0.78;">${e.details}</p>` : ''}
    ${(e.related || []).length ? `<div class="pv-divider"></div><div class="pv-section-label">Related entities</div><div class="pv-tags">${(e.related || []).map(r => `<button class="pv-chip-btn" onclick="openDealWorkspace('${String(r).replace(/'/g, "\\'")}')">${r}</button>`).join('')}</div>` : ''}
    ${renderPreviewActionRow([
      ...relatedDeals.slice(0, 2).map(d => `<button class="preview-action-btn gold" onclick="openDealWorkspace('${d.name.replace(/'/g, "\\'")}')"><span class="material-symbols-outlined">arrow_outward</span>Open deal</button>`),
      `<button class="preview-action-btn" onclick="navigateTo('timeline')"><span class="material-symbols-outlined">calendar_month</span>Timeline</button>`
    ])}
  `, pin);
};

window.previewCommsPlan = function(deal, pin) {
  const d = typeof deal === 'string' ? JSON.parse(deal.replace(/&quot;/g,'"').replace(/&#39;/g,"'")) : deal;
  const plan = buildDealCommsPlan(d);
  const leadIdComms = d.lead_id || resolveLeadIdForDeal(d);
  const emailPreset = JSON.stringify({ subject: plan.email?.subject || '', body_text: plan.email?.body || '' });
  const smsPreset = JSON.stringify({ text: plan.sms?.body || '' });
  setPreview(`
    <div class="pv-title">${d.name}</div>
    <div class="pv-sub">Communication plan</div>
    <div class="pv-divider"></div>
    <div class="pv-field"><span class="pv-field-label">Recommended channel</span><span class="pv-field-value">${plan.channel}</span></div>
    <div class="pv-field"><span class="pv-field-label">Objective</span><span class="pv-field-value">${plan.objective}</span></div>
    <div class="pv-field"><span class="pv-field-label">Tone</span><span class="pv-field-value">${plan.tone}</span></div>
    <div class="pv-field"><span class="pv-field-label">Cadence</span><span class="pv-field-value">${plan.cadence.replace(/_/g, ' ')}</span></div>
    ${plan.packet ? `<div class="pv-field"><span class="pv-field-label">Oracle lane</span><span class="pv-field-value">${plan.packet.name}</span></div>` : ''}
    ${plan.email ? `<div class="pv-divider"></div><div class="pv-section-label">Email lane</div><div class="script-block" style="white-space:pre-wrap;font-style:normal;"><strong>Subject:</strong> ${plan.email.subject || 'No subject'}\n\n${plan.email.body}</div>` : ''}
    ${plan.sms ? `<div class="pv-divider"></div><div class="pv-section-label">SMS lane</div><div class="script-block" style="white-space:pre-wrap;font-style:normal;">${plan.sms.body}</div>` : ''}
    ${renderPreviewActionRow([
      ...(leadIdComms ? [
        `<button type="button" class="preview-action-btn gold" onclick='openCloseCompose("email","${leadIdComms}",${JSON.stringify(d.name)},${emailPreset})'><span class="material-symbols-outlined">mail</span>Email plan (Close)</button>`,
        `<button type="button" class="preview-action-btn" onclick='openCloseCompose("sms","${leadIdComms}",${JSON.stringify(d.name)},${smsPreset})'><span class="material-symbols-outlined">sms</span>SMS plan (Close)</button>`,
        `<button type="button" class="preview-action-btn" onclick='openCloseTask("${leadIdComms}",${JSON.stringify(d.name)},"")'><span class="material-symbols-outlined">add_task</span>Task (Close)</button>`
      ] : []),
      `<button class="preview-action-btn gold" onclick="aiDraftFollowup(${esc(d)})"><span class="material-symbols-outlined">edit_note</span>AI draft</button>`,
      `<button class="preview-action-btn" onclick="queueFollowUp('${d.lead_id || ''}','${String(d.name).replace(/'/g, '')}')"><span class="material-symbols-outlined">send</span>Queue follow-up</button>`,
      `<button class="preview-action-btn" onclick="openDealWorkspace('${d.name.replace(/'/g, "\\'")}')"><span class="material-symbols-outlined">sell</span>Deal view</button>`
    ])}
  `, pin);
};

// Clock
function tickClock() {
  const now = new Date();
  const t = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const d = now.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
  $('#topbarClock').textContent = `${d} · ${t}`;
}
setInterval(tickClock, 1000); tickClock();

// ─── NAV ───
$$('.sb-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.sb-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    showView(btn.dataset.view);
  });
});

function showView(id) {
  currentView = id;
  clearPreview();
  stageScroll.scrollTop = 0;
  const views = { command: renderCommand, pipeline: renderPipeline, actions: renderActions, performance: renderPerformance, coaching: renderCoaching, deals: renderDeals, automation: renderAutomation, oracle: renderOracle, timeline: renderTimeline, settings: renderSettings };
  if (views[id]) views[id]();
  setTimeout(() => { if(window.lucide) lucide.createIcons(); }, 20);
}

// ═══════════════════════════════════════
// ACTIVITY FEED HELPERS
// ═══════════════════════════════════════
function timeAgo(isoString) {
  if (!isoString) return 'unknown';
  const now = new Date();
  const then = new Date(isoString);
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm ago';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.floor(hours / 24);
  return days + 'd ago';
}

/** UI map for agents / console — same JSON as GET /app/surface */
async function loadAppSurfaceMap() {
  try {
    const r = await fetch(`${SERVER}/app/surface`, { cache: 'no-store' });
    if (!r.ok) {
      window.__APP_SURFACE = null;
      return;
    }
    window.__APP_SURFACE = await r.json();
  } catch (_) {
    window.__APP_SURFACE = null;
  }
}

async function loadCloseInboxSnapshot() {
  if (!serverOnline) return;
  try {
    const r = await fetch(`${SERVER}/close/inbox/snapshot`, { cache: 'no-store' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      CLOSE_INBOX = { error: data.error || `HTTP ${r.status}`, fetched_at: new Date().toISOString() };
      return;
    }
    CLOSE_INBOX = data;
  } catch (e) {
    CLOSE_INBOX = { error: e.message, fetched_at: new Date().toISOString() };
  }
}

window.refreshCloseInboxIntel = async function() {
  await loadCloseInboxSnapshot();
  if (currentView === 'command') renderCommand();
  Toast.success('Close inbox intel refreshed');
};

function renderCloseInboxIntelPanel() {
  if (!serverOnline) {
    return `<div class="panel-block" data-surface="inbox-intel-panel" style="border-color:rgba(201,168,76,0.12);"><p class="panel-note" style="margin:0;">Connect to the server to load Close inbox intel.</p></div>`;
  }
  const x = CLOSE_INBOX;
  if (!x || x.error) {
    return `
      <div class="panel-block" data-surface="inbox-intel-panel" style="border-color:rgba(201,168,76,0.15);">
        <h2 style="margin-bottom:0.35rem;"><span class="material-symbols-outlined" style="font-size:1rem;color:var(--cyan);">inbox</span> Close inbox intel</h2>
        <p class="panel-note" style="margin-bottom:0.6rem;">Pulls the same class of work you triage in Close (tasks + recent email/SMS/calls) — not a CRM re-skin, a compressed feed for this command center.</p>
        <p style="font-size:0.72rem;color:var(--coral);margin:0;">${x?.error ? String(x.error) : 'Not loaded yet.'} Configure Close user ID in Settings and refresh.</p>
        <button type="button" class="preview-action-btn gold" data-surface="inbox-intel-refresh" style="margin-top:0.75rem;" onclick="refreshCloseInboxIntel()"><span class="material-symbols-outlined">sync</span>Load inbox intel</button>
      </div>`;
  }
  const c = x.counts || {};
  const when = x.fetched_at ? timeAgo(x.fetched_at) : '—';
  const chip = (n, label) => `<div class="inbox-intel-chip" data-surface="inbox-intel-chip"><span class="inbox-intel-n">${n}</span><span class="inbox-intel-l">${label}</span></div>`;
  const lidAttr = (id) => (id ? ` data-lead-id="${String(id).replace(/"/g, '&quot;')}"` : '');
  const taskRows = (x.tasks_inbox || []).slice(0, 5).map(t => `
    <div class="inbox-intel-row" data-surface="inbox-intel-row" data-inbox-kind="task"${lidAttr(t.lead_id)} onclick="previewCloseInboxTask(${esc({ kind: 'task', view: t.view, text: t.text, date: t.date, lead_id: t.lead_id, lead_name: t.lead_name })})">
      <span class="material-symbols-outlined inbox-intel-ico">task_alt</span>
      <div><div class="inbox-intel-row-title">${(t.text || 'Task').replace(/</g, '&lt;')}</div><div class="inbox-intel-row-sub">${(t.lead_name || t.lead_id || 'Lead').replace(/</g, '&lt;')} · ${t.date || ''}</div></div>
    </div>`).join('');
  const emailRows = (x.emails_triage || []).slice(0, 4).map(e => `
    <div class="inbox-intel-row" data-surface="inbox-intel-row" data-inbox-kind="email"${lidAttr(e.lead_id)} onclick="previewCloseInboxTask(${esc({ kind: 'email', subject: e.subject, snippet: e.snippet, lead_id: e.lead_id, lead_name: e.lead_name, status: e.status })})">
      <span class="material-symbols-outlined inbox-intel-ico">mail</span>
      <div><div class="inbox-intel-row-title">${(e.subject || '(no subject)').replace(/</g, '&lt;')}</div><div class="inbox-intel-row-sub">${(e.lead_name || '').replace(/</g, '&lt;')} · ${e.status || ''}</div></div>
    </div>`).join('');
  return `
    <div class="panel-block inbox-intel-panel" data-surface="inbox-intel-panel">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.75rem;">
        <div>
          <h2 style="margin-bottom:0.2rem;"><span class="material-symbols-outlined" style="font-size:1rem;color:var(--cyan);">inbox</span> Close inbox intel</h2>
          <p class="panel-note" style="margin:0;">Tasks (<code>view=inbox</code> / future) + inbound-style email/SMS + recent calls — prioritized triage surface for automation and AI, not a Close clone.</p>
        </div>
        <div style="display:flex;align-items:center;gap:0.45rem;flex-wrap:wrap;">
          <span style="font-size:0.6rem;color:var(--burgundy);opacity:0.55;">Updated ${when}</span>
          <button type="button" class="preview-action-btn" data-surface="inbox-intel-refresh" onclick="refreshCloseInboxIntel()"><span class="material-symbols-outlined">sync</span>Refresh</button>
        </div>
      </div>
      <div class="inbox-intel-chips" data-surface="inbox-intel-chips">
        ${chip(c.tasks_inbox ?? 0, 'Tasks · today')}
        ${chip(c.tasks_future ?? 0, 'Tasks · future')}
        ${chip(c.emails_in_queue ?? 0, 'Email triage')}
        ${chip(c.sms_in_queue ?? 0, 'SMS triage')}
        ${chip(c.calls_recent ?? 0, 'Recent calls')}
      </div>
      <div class="inbox-intel-columns" data-surface="inbox-intel-columns">
        <div data-surface="inbox-intel-column-tasks">
          <div class="inbox-intel-col-head">Tasks due (inbox view)</div>
          ${taskRows || '<p class="panel-note" style="margin:0;">No tasks in this window.</p>'}
          ${(x.tasks_future || []).length ? `<div class="inbox-intel-col-head inbox-intel-col-head--sub">Upcoming (future)</div>${(x.tasks_future || []).slice(0, 3).map(t => `
    <div class="inbox-intel-row inbox-intel-row--sub" data-surface="inbox-intel-row" data-inbox-kind="task-future"${lidAttr(t.lead_id)} onclick="previewCloseInboxTask(${esc({ kind: 'task', view: t.view, text: t.text, date: t.date, lead_id: t.lead_id, lead_name: t.lead_name })})">
      <span class="material-symbols-outlined inbox-intel-ico">event_upcoming</span>
      <div><div class="inbox-intel-row-title">${(t.text || 'Task').replace(/</g, '&lt;')}</div><div class="inbox-intel-row-sub">${(t.lead_name || t.lead_id || 'Lead').replace(/</g, '&lt;')} · ${t.date || ''}</div></div>
    </div>`).join('')}` : ''}
        </div>
        <div data-surface="inbox-intel-column-comms">
          <div class="inbox-intel-col-head">Email / SMS needing eyes</div>
          ${emailRows || ''}
          ${(x.sms_triage || []).slice(0, 3).map(s => `
            <div class="inbox-intel-row" data-surface="inbox-intel-row" data-inbox-kind="sms"${lidAttr(s.lead_id)} onclick="previewCloseInboxTask(${esc({ kind: 'sms', text: s.text, lead_id: s.lead_id, lead_name: s.lead_name })})">
              <span class="material-symbols-outlined inbox-intel-ico">sms</span>
              <div><div class="inbox-intel-row-title">${(s.text || 'SMS').replace(/</g, '&lt;')}</div><div class="inbox-intel-row-sub">${(s.lead_name || '').replace(/</g, '&lt;')}</div></div>
            </div>`).join('')}
          ${!(x.emails_triage || []).length && !(x.sms_triage || []).length ? '<p class="panel-note" style="margin:0;">No triage queue items in this pull.</p>' : ''}
          ${(x.calls_recent || []).length ? `<div class="inbox-intel-col-head inbox-intel-col-head--sub">Recent calls</div>${(x.calls_recent || []).slice(0, 4).map(c => `
    <div class="inbox-intel-row inbox-intel-row--sub" data-surface="inbox-intel-row" data-inbox-kind="call"${lidAttr(c.lead_id)} onclick="previewCloseInboxTask(${esc({ kind: 'call', lead_id: c.lead_id, lead_name: c.lead_name, disposition: c.disposition, duration: c.duration, date_created: c.date_created })})">
      <span class="material-symbols-outlined inbox-intel-ico">call</span>
      <div><div class="inbox-intel-row-title">${(c.lead_name || c.lead_id || 'Call').replace(/</g, '&lt;')}</div><div class="inbox-intel-row-sub">${(c.disposition || 'call').replace(/</g, '&lt;')} · ${c.duration != null ? c.duration + 's' : ''}</div></div>
    </div>`).join('')}` : ''}
        </div>
      </div>
    </div>`;
}

window.previewCloseInboxTask = function(payload) {
  let p = payload;
  if (typeof p === 'string') {
    try { p = JSON.parse(p); } catch (_) { return; }
  }
  const leadUrl = p.lead_id ? `https://app.close.com/lead/${p.lead_id}/` : '';
  const deal = p.lead_name ? findDealByName(p.lead_name) : null;
  const lid = p.lead_id || '';
  const labelEsc = (s) => String(s || '').replace(/'/g, "\\'");
  const taskLabel = labelEsc(p.lead_name || deal?.name || 'Lead');
  const rows = [];
  if (leadUrl) rows.push(`<a class="preview-action-btn" href="${leadUrl}" target="_blank" rel="noopener"><span class="material-symbols-outlined">open_in_new</span>Open in Close</a>`);
  if (lid) rows.push(`<button type="button" class="preview-action-btn gold" onclick="openCloseTask('${lid}', '${taskLabel}', '')"><span class="material-symbols-outlined">add_task</span>Add task</button>`);
  if (p.lead_name) rows.push(`<button type="button" class="preview-action-btn" onclick="openDealWorkspace('${labelEsc(p.lead_name)}')"><span class="material-symbols-outlined">sell</span>Deal in app</button>`);
  const body = p.kind === 'task'
    ? `<p style="font-size:0.75rem;line-height:1.5;color:var(--maroon);">${(p.text || '').replace(/</g, '&lt;')}</p>`
    : p.kind === 'email'
      ? `<p style="font-size:0.73rem;line-height:1.5;color:var(--maroon);opacity:0.85;">${(p.snippet || '').replace(/</g, '&lt;')}</p>`
      : p.kind === 'call'
        ? `<p style="font-size:0.73rem;line-height:1.5;color:var(--maroon);opacity:0.85;">${[p.disposition, p.duration != null ? `${p.duration}s` : ''].filter(Boolean).join(' · ').replace(/</g, '&lt;')}</p>`
        : `<p style="font-size:0.73rem;line-height:1.5;color:var(--maroon);">${(p.text || '').replace(/</g, '&lt;')}</p>`;
  const title = p.kind === 'task' ? 'Close task' : p.kind === 'email' ? (p.subject || 'Email').replace(/</g, '&lt;') : p.kind === 'call' ? 'Call' : 'SMS';
  setPreview(`
    <div class="pv-title">${title}</div>
    <div class="pv-sub">${(p.lead_name || p.lead_id || 'Lead').replace(/</g, '&lt;')}</div>
    <div class="pv-divider"></div>
    ${body}
    <div class="pv-divider"></div>
    ${renderPreviewActionRow(rows)}
  `, true);
};

function ensureCloseTaskModal() {
  let m = $('#closeTaskModal');
  if (m) return m;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div id="closeTaskModal" data-surface="close-task-modal" style="display:none;position:fixed;inset:0;z-index:10001;align-items:center;justify-content:center;background:rgba(0,0,0,0.75);backdrop-filter:blur(6px);padding:1rem;">
      <div style="width:100%;max-width:22rem;background:#141414;border:1.5px solid rgba(201,168,76,0.25);border-radius:1rem;padding:1.1rem 1.2rem 1.2rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
          <span style="font-family:'Fraunces',serif;font-weight:700;font-size:0.95rem;color:var(--maroon-deep);">New Close task</span>
          <button type="button" onclick="document.getElementById('closeTaskModal').style.display='none'" style="background:none;border:none;color:var(--burgundy);cursor:pointer;opacity:0.5;"><span class="material-symbols-outlined">close</span></button>
        </div>
        <p id="closeTaskDealLabel" style="font-size:0.68rem;color:var(--burgundy);margin:0 0 0.75rem;"></p>
        <label class="composer-field" style="display:block;margin-bottom:0.6rem;">
          <span class="composer-label">Due date</span>
          <input type="date" id="closeTaskDate" class="settings-input" style="width:100%;box-sizing:border-box;" />
        </label>
        <label class="composer-field" style="display:block;margin-bottom:0.85rem;">
          <span class="composer-label">Task</span>
          <textarea id="closeTaskText" rows="4" class="settings-input" placeholder="What needs to happen?" style="width:100%;box-sizing:border-box;resize:vertical;font-family:inherit;"></textarea>
        </label>
        <button type="button" class="preview-action-btn gold" style="width:100%;justify-content:center;" onclick="submitCloseTask()"><span class="material-symbols-outlined">check</span>Create in Close</button>
      </div>
    </div>`;
  document.body.appendChild(wrap.firstElementChild);
  return $('#closeTaskModal');
}

window.openCloseTask = function(leadId, dealName, suggestedText) {
  if (!leadId) {
    Toast.warning('No lead ID — pick a row from live CRM or inbox intel.');
    return;
  }
  const modal = ensureCloseTaskModal();
  modal.dataset.leadId = leadId;
  $('#closeTaskDealLabel').textContent = dealName ? `${dealName} · ${leadId}` : leadId;
  const d = new Date();
  $('#closeTaskDate').value = d.toISOString().substring(0, 10);
  $('#closeTaskText').value = suggestedText || '';
  modal.style.display = 'flex';
};

window.submitCloseTask = async function() {
  const modal = $('#closeTaskModal');
  const leadId = modal?.dataset?.leadId;
  const text = $('#closeTaskText')?.value?.trim();
  const date = $('#closeTaskDate')?.value;
  if (!leadId || !text) {
    Toast.warning('Add task description.');
    return;
  }
  try {
    await postCloseOutbound(`/close/lead/${encodeURIComponent(leadId)}/task`, { text, date });
    Toast.success('Task created in Close');
    modal.style.display = 'none';
    await refreshActivityFromServer();
    await loadCloseInboxSnapshot();
    if (currentView === 'command') renderCommand();
  } catch (e) {
    Toast.error(e.message || 'Failed to create task');
  }
};

function renderActivityFeed() {
  const entries = (ACT.log || []).slice(-8).reverse();
  if (!entries.length) return '<div style="padding:0.5rem;color:var(--burgundy);opacity:0.5;font-size:0.72rem;">No activity yet</div>';
  return entries.map(entry => {
    const colorMap = { sync:'#4A9E68', ai:'#C9A84C', queue:'#C47050', other:'#6A98A8' };
    const dotColor = colorMap[entry.category?.toLowerCase()] || colorMap.other;
    const time = timeAgo(entry.ts);
    return `
      <div style="display:flex;align-items:center;gap:0.6rem;padding:0.45rem 0;border-bottom:1px solid rgba(201,168,76,0.04);font-size:0.68rem;">
        <div style="width:6px;height:6px;border-radius:50%;background:${dotColor};flex-shrink:0;"></div>
        <span style="color:var(--burgundy);opacity:0.5;min-width:3.5rem;font-size:0.6rem;">${time}</span>
        <span style="flex:1;color:var(--maroon);">${entry.summary || entry.type || 'Activity'}</span>
        <span class="badge">${(entry.category || 'log').replace(/_/g, ' ')}</span>
      </div>
    `;
  }).join('');
}

// ═══════════════════════════════════════
// COMMAND CENTER
// ═══════════════════════════════════════
function renderCommand() {
  const e = P.executive_summary || {};
  const execBoard = getExecutiveActionBoard();
  const morningBrief = getMorningBriefData();
  const cards = [
    { label:'Overall Score', value:'3,613', color:'var(--rose)', foot:'#1 on team', pct:100, sparkData:[3200, 3280, 3350, 3410, 3480, 3550, 3613] },
    { label:'Bonus Multiplier', value:'1.80x', color:'var(--gold)', foot:'+56.5% vs avg', pct:100, sparkData:[1.45, 1.52, 1.59, 1.66, 1.72, 1.76, 1.80] },
    { label:'90-Day Revenue', value:fmt$(52910), color:'var(--green)', foot:'+67.2% vs avg', pct:84, sparkData:[38500, 41200, 44100, 46800, 49200, 51100, 52910] },
    { label:'Pipeline Value', value:fmt$(e.pipeline_value), color:'var(--purple)', foot: e.total_deals+' deals', pct:88, sparkData:[280000, 298000, 315000, 335000, 355000, 378000, 392500] },
    { label:'Win Rate', value: fmtPct(e.win_rate), color:'var(--amber)', foot:'Target: 35%', pct:85, sparkData:[28, 29, 30, 31, 30, 32, 30] },
    { label:'Active Deals', value: e.active_deals, color:'var(--cyan)', foot: e.won_deals+' won', pct:70, sparkData:[18, 19, 20, 21, 22, 23, 24] },
  ];
  const urgentTasks = (T.tasks?.today || []).slice(0, 3);
  const brief = OS.oracle_briefing || { top_priority: '...', action_required: '...', manager_message: '...', cadence_dues: 0 };

  stageScroll.innerHTML = `
    <div class="hero-block gold">
      <div class="hero-eyebrow"><span class="material-symbols-outlined" style="font-size:0.7rem;">emoji_events</span> #1 Sales Representative</div>
      <div class="hero-title"><span class="hero-title-accent">Andre Raw</span></div>
      <p class="hero-desc">Comeketo Catering's top performer. 3,613 points, 1.80x bonus multiplier, $52,910 in 90-day closed business — 67.2% above team average. ${e.total_calls || 111} calls, ${e.total_deals || 37} deals, bilingual market leader.</p>
      <div class="hero-pills">
        ${(P.key_strengths || []).map(s => `<span class="hero-pill">${s.split('—')[0].trim()}</span>`).join('')}
      </div>
    </div>
    
    <div style="background:linear-gradient(135deg, #161410, rgba(201,168,76,0.06)); border:1px solid rgba(201,168,76,0.25); border-radius:10px; padding:1.2rem; margin-bottom:1.8rem; display:flex; gap:1.5rem; align-items:flex-start; box-shadow:0 8px 24px rgba(0,0,0,0.02);">
      <div style="color:var(--gold); padding-top:0.2rem;">
        <span class="material-symbols-outlined" style="font-size:3rem; filter:drop-shadow(0 2px 4px rgba(232,168,56,0.2));">smart_toy</span>
      </div>
      <div style="flex:1;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:0.8rem;">
          <div>
            <h2 style="font-size:1.1rem; color:var(--maroon-deep); margin-bottom:0.2rem; font-family:'Fraunces', serif;">Oracle Daily Briefing</h2>
            <p style="font-size:0.75rem; color:rgba(201,168,76,0.5);">Live execution guidance generated from doctrine and current pipeline state.</p>
          </div>
          <span class="badge gold">Live Analysis Active</span>
        </div>
        
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
           <div style="background:rgba(30,28,24,0.8); border-radius:6px; padding:0.8rem; border-left:3px solid var(--coral); box-shadow:0 1px 3px rgba(0,0,0,0.02);">
              <div style="font-size:0.65rem; text-transform:uppercase; font-weight:700; color:var(--coral); margin-bottom:0.3rem;">Top Priority Deal</div>
              <div style="font-weight:700; color:var(--maroon); font-size:0.9rem;">${brief.top_priority}</div>
              <div style="font-size:0.75rem; color:rgba(201,168,76,0.5); margin-top:0.2rem;"><span class="material-symbols-outlined" style="font-size:0.8rem; vertical-align:text-bottom; margin-right:2px;">bolt</span>${brief.action_required}</div>
           </div>
           
           <div style="background:rgba(30,28,24,0.8); border-radius:6px; padding:0.8rem; border-left:3px solid var(--rose); box-shadow:0 1px 3px rgba(0,0,0,0.02);">
              <div style="font-size:0.65rem; text-transform:uppercase; font-weight:700; color:var(--rose); margin-bottom:0.3rem;">Manager Directive</div>
              <div style="font-size:0.75rem; color:var(--maroon); line-height:1.4; font-weight:500;">"${brief.manager_message}"</div>
           </div>
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:0.5rem; align-items:center; justify-content:center; padding-left:1.5rem; border-left:1px dashed rgba(201,168,76,0.2); height:100%;">
         <button class="btn" style="width:100%; white-space:nowrap; background:#C9A84C; color:#0C0C0C; border:none; padding:0.5rem 1rem; border-radius:0.5rem; font-family:inherit; font-weight:700; font-size:0.72rem; cursor:pointer;" onclick="showView('automation');">Draft Strategy</button>
         <div style="font-size:0.75rem; color:rgba(201,168,76,0.5); margin-top:0.3rem;"><span style="color:var(--coral); font-weight:700;">${brief.cadence_dues}</span> Cadences Due</div>
      </div>
    </div>

    <div class="scorecards">
      ${cards.map(c => `
        <article class="scorecard">
          <div class="scorecard-title">${c.label}</div>
          <div class="scorecard-value" style="color:${c.color}">${c.value}</div>
          <div class="scorecard-foot">${c.foot}</div>
          <div class="scorecard-bar"><div class="scorecard-bar-fill" style="width:${c.pct}%;background:${c.color}"></div></div>
          <canvas class="sparkline" data-spark="${c.sparkData.join(',')}" data-color="${c.color}" width="200" height="60" style="width:100%;height:30px;margin-top:0.4rem;"></canvas>
        </article>
      `).join('')}
    </div>

    <div class="status-strip">
      <div class="status-card">
        <div class="status-label">Data Period</div>
        <div class="status-value">${P.identity?.data_period || 'Feb – Mar 2026'}</div>
      </div>
      <div class="status-card">
        <div class="status-label">Languages</div>
        <div class="status-value">EN English · PT Portuguese</div>
      </div>
      <div class="status-card">
        <div class="status-label">Data Sources</div>
        <div class="status-value">${P.identity?.total_data_sources || 124} files analyzed</div>
      </div>
    </div>

    ${renderCloseInboxIntelPanel()}

    <div class="command-war-grid">
      <div class="panel-block panel-accent-gold">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.7rem;">
          <h2 style="margin-bottom:0;"><span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);">gavel</span> Executive War Room</h2>
          <span class="badge ${execBoard.pressurePct > 30 ? 'urgent' : execBoard.pressurePct > 18 ? 'medium' : 'won'}">${execBoard.pressurePct}% revenue pressure</span>
        </div>
        <p class="panel-note">What matters most right now: money under pressure, live exceptions, and the few moves that change the board.</p>
        <div class="war-room-metrics">
          <div class="war-metric">
            <div class="war-metric-label">Pipeline</div>
            <div class="war-metric-value">${fmt$(execBoard.pipeline)}</div>
          </div>
          <div class="war-metric">
            <div class="war-metric-label">Locked</div>
            <div class="war-metric-value" style="color:var(--green);">${fmt$(execBoard.locked)}</div>
          </div>
          <div class="war-metric">
            <div class="war-metric-label">At Risk</div>
            <div class="war-metric-value" style="color:var(--coral);">${fmt$(execBoard.atRisk)}</div>
          </div>
          <div class="war-metric">
            <div class="war-metric-label">Active Deals</div>
            <div class="war-metric-value">${execBoard.totalActive}</div>
          </div>
        </div>
        <div class="pressure-bar">
          <div class="pressure-bar-fill" style="width:${Math.min(execBoard.pressurePct, 100)}%;"></div>
        </div>
      </div>
      <div class="panel-block">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.7rem;">
          <h2 style="margin-bottom:0;"><span class="material-symbols-outlined" style="font-size:1rem;color:var(--coral);">siren</span> Critical Exceptions</h2>
          <button class="preview-action-btn" onclick="navigateTo('automation')"><span class="material-symbols-outlined">hub</span>Automation</button>
        </div>
        <div style="display:grid;gap:0.55rem;">
          ${execBoard.criticalMoves.slice(0, 3).map(item => `
            <div class="exception-card" onmouseenter="${item.kind === 'task' ? `previewTask(${esc({ lead: item.name, value: item.value, action: item.action, category: item.subtitle, urgency: item.urgency })})` : `openDealWorkspace('${item.name.replace(/'/g, "\\'")}', 'automation')`}" onmouseleave="clearPreview()" onclick="${item.kind === 'task' ? `previewTask(${esc({ lead: item.name, value: item.value, action: item.action, category: item.subtitle, urgency: item.urgency })}, true)` : `openDealWorkspace('${item.name.replace(/'/g, "\\'")}', 'automation')`}">
              <div class="exception-card-head">
                <div class="exception-card-title"><span class="material-symbols-outlined" style="font-size:0.92rem;color:var(--gold);">${item.icon}</span>${item.name}</div>
                ${badge(item.urgency, item.urgency)}
              </div>
              <div class="exception-card-sub">${item.title} · ${item.subtitle}</div>
              <div class="exception-card-action">${item.action}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <div class="panel-block morning-brief-shell">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.8rem;">
        <div>
          <h2 style="margin-bottom:0.15rem;"><span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);">light_mode</span> Morning Brief</h2>
          <p class="panel-note" style="margin-bottom:0;">${morningBrief.headline}</p>
        </div>
        <div class="preview-action-row" style="margin-top:0;">
          <button class="preview-action-btn gold" onclick="queueMorningBrief()"><span class="material-symbols-outlined">schedule_send</span>Queue brief</button>
          <button class="preview-action-btn" onclick="navigateTo('automation')"><span class="material-symbols-outlined">hub</span>Action center</button>
        </div>
      </div>
      <div class="brief-grid">
        <div class="brief-column">
          <div class="brief-column-head">Send Today</div>
          ${morningBrief.sendToday.map(item => `
            <div class="brief-card" onmouseenter="${item.type === 'task' ? `previewTask(${esc({ lead: item.name, value: item.value, action: item.reason, category: item.type, urgency: item.urgency })})` : `openDealWorkspace('${item.name.replace(/'/g, "\\'")}')`}" onmouseleave="clearPreview()" onclick="${item.type === 'task' ? `previewTask(${esc({ lead: item.name, value: item.value, action: item.reason, category: item.type, urgency: item.urgency })}, true)` : `openDealWorkspace('${item.name.replace(/'/g, "\\'")}')`}">
              <div class="brief-card-top">
                <div class="brief-card-title">${item.name}</div>
                ${badge(item.urgency, item.urgency)}
              </div>
              <div class="brief-card-body">${item.reason}</div>
            </div>
          `).join('')}
        </div>
        <div class="brief-column">
          <div class="brief-column-head">Slipping</div>
          ${morningBrief.slipping.map(item => `
            <div class="brief-card danger" onmouseenter="openDealWorkspace('${item.name.replace(/'/g, "\\'")}', 'automation')" onmouseleave="clearPreview()" onclick="openDealWorkspace('${item.name.replace(/'/g, "\\'")}', 'automation')">
              <div class="brief-card-top">
                <div class="brief-card-title">${item.name}</div>
                ${badge(item.urgency, item.urgency)}
              </div>
              <div class="brief-card-body">${item.reason}</div>
            </div>
          `).join('')}
        </div>
        <div class="brief-column">
          <div class="brief-column-head">Waiting On Us</div>
          ${morningBrief.bottlenecks.map(item => `
            <div class="brief-card" onmouseenter="previewTask(${esc({ lead: item.lead, value: item.value, action: item.action, category: item.issue, urgency: 'urgent' })})" onmouseleave="clearPreview()" onclick="previewTask(${esc({ lead: item.lead, value: item.value, action: item.action, category: item.issue, urgency: 'urgent' })}, true)">
              <div class="brief-card-top">
                <div class="brief-card-title">${item.lead}</div>
                ${badge('urgent', 'urgent')}
              </div>
              <div class="brief-card-body">${item.issue} · ${item.action}</div>
            </div>
          `).join('')}
          ${morningBrief.openLoops.map(item => `
            <div class="brief-card muted" onmouseenter="previewTask(${esc({ lead: item.lead, value: 0, action: item.question, category: 'open_loop', urgency: 'medium' })})" onmouseleave="clearPreview()" onclick="previewTask(${esc({ lead: item.lead, value: 0, action: item.question, category: 'open_loop', urgency: 'medium' })}, true)">
              <div class="brief-card-top">
                <div class="brief-card-title">${item.lead}</div>
                ${badge(item.days_open + 'd open')}
              </div>
              <div class="brief-card-body">${item.question}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <div class="layout-grid">
      <div class="stack">
        <div class="panel-block">
          <h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--coral);">warning</span> Priority Actions — Today</h2>
          <div style="display:grid;gap:0.5rem;">
            ${urgentTasks.length ? urgentTasks.map(t => `
              <div class="q-item" onmouseenter="previewTask(${esc(t)})" onmouseleave="clearPreview()" onclick="previewTask(${esc(t)}, true)" style="cursor:pointer;">
                <div style="display:flex;justify-content:space-between;align-items:start;">
                  <div class="q-item-title">${t.lead}</div>
                  <div class="q-item-value">${fmt$(t.value)}</div>
                </div>
                <div class="q-item-sub">${t.action}</div>
                <div class="q-item-meta">${badge(t.urgency, t.urgency)} ${badge(t.category.replace(/_/g,' '))}</div>
              </div>
            `).join('') : '<div class="q-item"><div class="q-item-sub">No urgent tasks right now.</div></div>'}
          </div>
        </div>
        <div class="panel-block">
          <h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--amber);">bolt</span> Competitive Advantages</h2>
          <div style="display:grid;gap:0.4rem;">
            ${(P.competitive_advantages || []).map(a => `
              <div style="display:flex;align-items:center;gap:0.6rem;padding:0.4rem 0;">
                <span class="material-symbols-outlined" style="font-size:1.1rem;color:var(--rose);">${a.icon}</span>
                <div><div style="font-weight:700;font-size:0.78rem;color:var(--maroon-deep);">${a.advantage}</div><div style="font-size:0.68rem;color:var(--burgundy);opacity:0.5;">${a.detail}</div></div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="stack">
        <div class="panel-block">
          <h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);">donut_large</span> Pipeline Distribution</h2>
          <div style="display:flex;align-items:center;gap:1.2rem;">
            <canvas id="cmdDonut" width="160" height="160" style="width:80px;height:80px;flex-shrink:0;"></canvas>
            <div style="display:grid;gap:0.25rem;flex:1;">
              ${(L.stages || []).map(s => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:0.2rem 0;">
                  <div style="display:flex;align-items:center;gap:0.4rem;">
                    <div style="width:8px;height:8px;border-radius:2px;background:${s.color};"></div>
                    <span style="font-size:0.68rem;color:var(--maroon-deep);">${s.label}</span>
                  </div>
                  <span style="font-family:'Fraunces',serif;font-weight:700;font-size:0.72rem;color:var(--maroon-deep);">${fmt$(s.value)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="panel-block">
          <h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);">speed</span> Win Rate Gauge</h2>
          <div style="display:flex;align-items:center;justify-content:center;padding:0.5rem 0;">
            <svg id="cmdGauge" width="140" height="90" viewBox="0 0 140 90" style="overflow:visible;"></svg>
          </div>
        </div>
        <div class="panel-block">
          <h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--coral);">error</span> Risk Flags</h2>
          <div style="display:grid;gap:0.3rem;">
            ${(L.risk_patterns || []).slice(0,4).map(r => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:0.35rem 0;">
                <div style="display:flex;align-items:center;gap:0.4rem;">
                  <span class="material-symbols-outlined" style="font-size:0.9rem;color:var(--coral);">${r.icon}</span>
                  <span style="font-size:0.72rem;">${r.flag}</span>
                </div>
                <div>${badge(r.count + ' deals', r.severity === 'critical' ? 'urgent' : r.severity)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
    <div class="panel-block">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;">
        <h2 style="margin-bottom:0;"><span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);">monetization_on</span> Top Money Moves</h2>
        <button class="preview-action-btn" onclick="navigateTo('deals')"><span class="material-symbols-outlined">arrow_outward</span>All deals</button>
      </div>
      <div class="money-move-grid">
        ${execBoard.criticalMoves.map(item => `
          <div class="money-move-card" onmouseenter="${item.kind === 'task' ? `previewTask(${esc({ lead: item.name, value: item.value, action: item.action, category: item.subtitle, urgency: item.urgency })})` : `openDealWorkspace('${item.name.replace(/'/g, "\\'")}')`}" onmouseleave="clearPreview()" onclick="${item.kind === 'task' ? `previewTask(${esc({ lead: item.name, value: item.value, action: item.action, category: item.subtitle, urgency: item.urgency })}, true)` : `openDealWorkspace('${item.name.replace(/'/g, "\\'")}')`}">
            <div class="money-move-top">
              <div>
                <div class="money-move-name">${item.name}</div>
                <div class="money-move-sub">${item.title} · ${item.subtitle}</div>
              </div>
              <div class="money-move-value">${fmt$(item.value)}</div>
            </div>
            <div class="money-move-action">${item.action}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="panel-block" style="margin-top:0.8rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.7rem;">
        <h2 style="margin-bottom:0;"><span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);">stream</span> Live Activity Feed</h2>
        <button class="preview-action-btn" onclick="navigateTo('timeline')"><span class="material-symbols-outlined">calendar_month</span>Full timeline</button>
      </div>
      <div style="display:grid;gap:0.35rem;" id="activityFeed">
        ${renderActivityFeed()}
      </div>
    </div>

    <div class="mc-footer">Powered by <a href="#">Comeketo Sales Intelligence</a> · Data refreshed ${P.identity?.extraction_date || 'April 7, 2026'}</div>
  `;
  setTimeout(() => { renderCommandCharts(); renderSparklines(); }, 50);
}

function renderCommandCharts() {
  // ─── Pipeline Donut ───
  const donut = document.getElementById('cmdDonut');
  if (donut) {
    const ctx = donut.getContext('2d');
    const dpr = 2;
    donut.width = 160 * dpr; donut.height = 160 * dpr;
    ctx.scale(dpr, dpr);
    const w = 160, cx = w/2, cy = w/2, R = 60, r = 38;
    const stages = L.stages || [];
    const total = stages.reduce((s,st) => s + (st.value||0), 0) || 1;
    let angle = -Math.PI / 2;
    stages.forEach(s => {
      const sweep = (s.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, R, angle, angle + sweep);
      ctx.arc(cx, cy, r, angle + sweep, angle, true);
      ctx.closePath();
      ctx.fillStyle = s.color || 'rgba(201,168,76,0.3)';
      ctx.fill();
      angle += sweep;
    });
    // Center text
    ctx.fillStyle = '#F0E8D4'; ctx.font = '700 14px Fraunces'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(fmt$(total), cx, cy - 4);
    ctx.fillStyle = 'rgba(201,168,76,0.4)'; ctx.font = '500 8px DM Sans';
    ctx.fillText('total pipeline', cx, cy + 10);
  }

  // ─── Win Rate Gauge ───
  const gauge = document.getElementById('cmdGauge');
  if (gauge) {
    const rate = P.executive_summary?.win_rate || 30;
    const target = 35;
    const pct = Math.min(rate / 50, 1); // 50% = full gauge
    const tPct = Math.min(target / 50, 1);
    gauge.innerHTML = `
      <defs>
        <linearGradient id="gg" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#C47050"/>
          <stop offset="50%" stop-color="#C8943A"/>
          <stop offset="100%" stop-color="#4A9E68"/>
        </linearGradient>
      </defs>
      <path d="M 15 80 A 55 55 0 0 1 125 80" fill="none" stroke="rgba(201,168,76,0.08)" stroke-width="10" stroke-linecap="round"/>
      <path d="M 15 80 A 55 55 0 0 1 125 80" fill="none" stroke="url(#gg)" stroke-width="10" stroke-linecap="round"
        stroke-dasharray="${pct * 173} 173" style="transition:stroke-dasharray 800ms ease;"/>
      <line x1="${15 + tPct * 110}" y1="${80 - Math.sin(Math.acos((tPct - 0.5) * 2)) * 55 - 5}" x2="${15 + tPct * 110}" y2="${80 - Math.sin(Math.acos((tPct - 0.5) * 2)) * 55 + 12}" stroke="rgba(201,168,76,0.4)" stroke-width="1.5" stroke-dasharray="2 2"/>
      <text x="70" y="60" text-anchor="middle" fill="#F0E8D4" font-family="Fraunces" font-weight="800" font-size="22">${rate}%</text>
      <text x="70" y="75" text-anchor="middle" fill="rgba(201,168,76,0.4)" font-family="DM Sans" font-size="8">win rate · target ${target}%</text>
    `;
  }
}

function renderSparklines() {
  const sparks = $$('.sparkline');
  sparks.forEach(canvas => {
    const dataStr = canvas.getAttribute('data-spark');
    const colorStr = canvas.getAttribute('data-color');
    if (!dataStr) return;
    const values = dataStr.split(',').map(Number);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = 2;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    if (values.length < 2) return;
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal === minVal ? 1 : maxVal - minVal;
    const padding = 4;
    const graphW = w - padding * 2;
    const graphH = h - padding * 2;
    const xs = values.map((_, i) => padding + (i / (values.length - 1)) * graphW);
    const ys = values.map(v => padding + graphH - ((v - minVal) / range) * graphH);
    ctx.clearRect(0, 0, w, h);
    const gradient = ctx.createLinearGradient(0, padding, 0, padding + graphH);
    const rgbColor = colorStr.match(/--\w+/) ? getComputedStyle(document.documentElement).getPropertyValue(colorStr).trim() : colorStr;
    gradient.addColorStop(0, rgbColor + '33');
    gradient.addColorStop(1, rgbColor + '00');
    ctx.beginPath();
    ctx.moveTo(xs[0], ys[0]);
    for (let i = 1; i < values.length; i++) {
      const cp1x = xs[i - 1] + (xs[i] - xs[i - 1]) / 3;
      const cp1y = ys[i - 1];
      const cp2x = xs[i] - (xs[i] - xs[i - 1]) / 3;
      const cp2y = ys[i];
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, xs[i], ys[i]);
    }
    ctx.lineTo(xs[values.length - 1], padding + graphH);
    ctx.lineTo(xs[0], padding + graphH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(xs[0], ys[0]);
    for (let i = 1; i < values.length; i++) {
      const cp1x = xs[i - 1] + (xs[i] - xs[i - 1]) / 3;
      const cp1y = ys[i - 1];
      const cp2x = xs[i] - (xs[i] - xs[i - 1]) / 3;
      const cp2y = ys[i];
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, xs[i], ys[i]);
    }
    ctx.strokeStyle = rgbColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
}


function esc(obj) { return JSON.stringify(obj).replace(/'/g,"&#39;").replace(/"/g,"&quot;"); }
window.previewTask = function(t, pin) {
  if (typeof t === 'string') t = JSON.parse(t);
  const deal = findDealByName(t.lead);
  setPreview(`<div class="pv-title">${t.lead}</div><div class="pv-sub">${t.category?.replace(/_/g,' ')}</div><div class="pv-divider"></div><div class="pv-field"><span class="pv-field-label">Value</span><span class="pv-field-value">${fmt$(t.value)}</span></div><div class="pv-field"><span class="pv-field-label">Urgency</span><span class="pv-field-value">${t.urgency}</span></div><div class="pv-divider"></div><div class="pv-section-label">Action Required</div><p style="font-size:0.73rem;line-height:1.5;color:var(--maroon);opacity:0.7;">${t.action}</p>${renderPreviewActionRow([
    deal ? `<button class="preview-action-btn gold" onclick="openDealWorkspace('${deal.name.replace(/'/g, "\\'")}')"><span class="material-symbols-outlined">sell</span>Open deal</button>` : '',
    `<button class="preview-action-btn" onclick="navigateTo('actions')"><span class="material-symbols-outlined">task_alt</span>Action board</button>`
  ].filter(Boolean))}`, pin);
};

// ═══════════════════════════════════════
// PIPELINE
// ═══════════════════════════════════════
function renderPipeline() {
  const stages = L.stages || [];
  const maxVal = Math.max(...stages.map(s => s.value || 0), 1);
  stageScroll.innerHTML = `
    <div class="vh"><span class="label"><span class="material-symbols-outlined">filter_alt</span> Pipeline</span><h2>Deal Pipeline</h2><p>$${(L.summary?.total_pipeline||0).toLocaleString()} total · ${L.summary?.total_deals||0} deals · ${fmt$(L.summary?.avg_deal_value)} avg</p></div>
    <div class="layout-grid-half" style="margin-bottom:1.2rem;">
      <div class="panel-block"><h2>Pipeline Summary</h2>
        <div class="pv-field"><span class="pv-field-label">Total Pipeline</span><span class="pv-field-value" style="color:var(--rose)">${fmt$(L.summary?.total_pipeline)}</span></div>
        <div class="pv-field"><span class="pv-field-label">Locked-In Revenue</span><span class="pv-field-value" style="color:var(--green)">${fmt$(L.summary?.locked_in_revenue)}</span></div>
        <div class="pv-field"><span class="pv-field-label">At-Risk Revenue</span><span class="pv-field-value" style="color:var(--coral)">${fmt$(L.summary?.at_risk_revenue)}</span></div>
        <div class="pv-field"><span class="pv-field-label">Largest Deal</span><span class="pv-field-value">${fmt$(L.summary?.largest_deal)}</span></div>
      </div>
      <div class="panel-block"><h2>Priority Distribution</h2>
        ${Object.entries(L.priority_distribution||{}).map(([k,v]) => `<div style="display:flex;align-items:center;justify-content:space-between;padding:0.35rem 0;"><span style="font-size:0.72rem;text-transform:capitalize;">${k}</span><span>${badge(v, k)}</span></div>`).join('')}
      </div>
    </div>
    <div class="panel-block"><h2>Pipeline Funnel</h2>
      <div class="funnel">
        ${stages.map(s => `
          <div class="funnel-row is-clickable" onclick="toggleFunnelStage(this, '${s.label.replace(/'/g, "\\'")}')" style="cursor:pointer;">
            <div class="funnel-emoji"><span class="material-symbols-outlined" style="font-size:1.2rem;color:${s.color};">${{'⬜':'crop_square','📲':'phone_iphone','🔥':'local_fire_department','💲':'payments','✅':'check_circle','💼':'work'}[s.emoji]||'circle'}</span></div>
            <div class="funnel-label">${s.label}</div>
            <div class="funnel-count">${s.count}</div>
            <div class="funnel-bar"><div class="funnel-bar-fill" style="width:${(s.value/maxVal*100).toFixed(0)}%;background:${s.color}"></div></div>
            <div class="funnel-value">${fmt$(s.value)}</div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="panel-block"><h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--coral);">local_fire_department</span> High-Value Portfolio ($5K+)</h2>
      <div style="display:grid;gap:0.5rem;">
        ${(L.high_value_deals||[]).map(d => `
          <div class="q-item" onmouseenter="previewDeal(this, '${esc(d)}')" onmouseleave="clearPreview()" onclick="previewDeal(this, '${esc(d)}', true)"  style="cursor:pointer;">
            <div style="display:flex;justify-content:space-between;align-items:start;">
              <div class="q-item-title">${d.name}</div>
              <div class="q-item-value">${fmt$(d.value)}</div>
            </div>
            <div class="q-item-sub">${d.event} · ${d.venue} · ${d.guests} guests</div>
            <div class="q-item-meta">${badge(d.stage, d.status === 'won' ? 'won' : d.status === 'at_risk' ? 'risk' : 'high')} ${badge(d.confidence+'% confidence')}</div>
            <div class="ai-actions">
              <button class="ai-btn" onclick="aiDraftFollowup(${esc(d)})"><span class="material-symbols-outlined">edit_note</span> Follow-up</button>
              <button class="ai-btn" onclick="aiAnalyzeDeal(${esc(d)})"><span class="material-symbols-outlined">analytics</span> Analyze</button>
              <button class="ai-btn" onclick="aiHandleObjection(${esc(d)})"><span class="material-symbols-outlined">shield</span> Objections</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

window.previewDeal = function(el, json, pin) {
  const d = typeof json === 'string' ? JSON.parse(json.replace(/&quot;/g,'"').replace(/&#39;/g,"'")) : json;
  const comms = buildDealCommsPlan(d);
  const oracle = OS.deal_oracle_map?.[d.name];
  let oracleHtml = '';
  if (oracle) {
    const packet = OC.reality_packets?.find(p => p.id === oracle.packet) || { name: oracle.packet.replace(/_/g,' ') };
    const scenario = OS.scenario_families?.find(s => s.id === oracle.scenario) || { name: oracle.scenario.replace(/_/g,' ') };
    const objection = OS.objection_families?.find(o => o.id === oracle.objection) || { name: oracle.objection?.replace(/_/g,' ') };
    oracleHtml = `
      <div class="pv-divider"></div>
      <div class="pv-section-label" style="display:flex;align-items:center;gap:0.3rem;color:var(--gold);"><span class="material-symbols-outlined" style="font-size:0.9rem;">smart_toy</span> Oracle Intelligence</div>
      <div class="script-block" style="border-left-color:var(--gold);margin-top:0.4rem;padding:0.6rem;">
        <div style="font-size:0.65rem;color:var(--maroon-deep);font-weight:700;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.5px;">Recommended Message Lane:</div>
        <div style="font-size:0.75rem;color:var(--green);font-weight:600;margin-bottom:0.6rem;">${packet.name}</div>
        <div style="display:grid;gap:0.3rem;">
          <div style="font-size:0.68rem;"><strong>Scenario:</strong> ${scenario.name}</div>
          ${oracle.objection ? `<div style="font-size:0.68rem;"><strong>Objection:</strong> ${objection.name}</div>` : ''}
          <div style="font-size:0.68rem;"><strong>Cadence Rule:</strong> ${oracle.cadence.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</div>
        </div>
        <div style="margin-top:0.6rem;">${badge(oracle.confidence + '% AI confidence', 'gold')} ${badge(oracle.review ? 'human review required' : 'safe to draft', oracle.review ? 'urgent' : 'won')}</div>
      </div>
    `;
  }

  const leadIdResolved = resolveLeadIdForDeal(d);
  const closeSendBtns = leadIdResolved ? [
    `<button type="button" class="preview-action-btn" onclick='openCloseCompose("email","${leadIdResolved}",${JSON.stringify(d.name)})'><span class="material-symbols-outlined">mail</span>Email (Close)</button>`,
    `<button type="button" class="preview-action-btn" onclick='openCloseCompose("sms","${leadIdResolved}",${JSON.stringify(d.name)})'><span class="material-symbols-outlined">sms</span>SMS (Close)</button>`,
    `<button type="button" class="preview-action-btn gold" onclick='openCloseTask("${leadIdResolved}",${JSON.stringify(d.name)},"")'><span class="material-symbols-outlined">add_task</span>Task (Close)</button>`
  ] : [];

  setPreview(`<div class="pv-title">${d.name}</div><div class="pv-sub">${d.stage}</div><div class="pv-divider"></div><div class="pv-field"><span class="pv-field-label">Value</span><span class="pv-field-value">${fmt$(d.value)}</span></div><div class="pv-field"><span class="pv-field-label">Event</span><span class="pv-field-value">${d.event||'—'}</span></div><div class="pv-field"><span class="pv-field-label">Venue</span><span class="pv-field-value">${d.venue||'TBD'}</span></div><div class="pv-field"><span class="pv-field-label">Guests</span><span class="pv-field-value">${d.guests||'TBD'}</span></div><div class="pv-field"><span class="pv-field-label">Confidence</span><span class="pv-field-value">${d.confidence||'—'}%</span></div><div class="pv-field"><span class="pv-field-label">Best channel</span><span class="pv-field-value">${comms.channel}</span></div>${!leadIdResolved ? '<div class="pv-divider"></div><p style="font-size:0.65rem;color:var(--amber);opacity:0.85;">Close send: no <code style="font-size:0.6rem;">lead_id</code> on this deal yet — match it via a CRM sync (Needs Attention / Closing soon) to enable Email/SMS buttons.</p>' : ''}${d.risk?.length ? '<div class="pv-divider"></div><div class="pv-section-label">Risk Flags</div><div class="pv-tags">'+d.risk.map(r=>'<span class="pv-tag" style="color:var(--coral)">'+r.replace(/_/g,' ')+'</span>').join('')+'</div>' : ''}${oracleHtml}<div class="pv-divider"></div><div class="pv-section-label">Communication guidance</div><p style="font-size:0.73rem;line-height:1.55;color:var(--maroon);opacity:0.78;">${comms.objective}. Tone should stay ${comms.tone.toLowerCase()}.</p>${renderPreviewActionRow([
    ...closeSendBtns,
    `<button class="preview-action-btn gold" onclick="aiAnalyzeDeal(${esc(d)})"><span class="material-symbols-outlined">analytics</span>Analyze</button>`,
    `<button class="preview-action-btn" onclick="aiDraftFollowup(${esc(d)})"><span class="material-symbols-outlined">edit_note</span>Draft</button>`,
    `<button class="preview-action-btn" onclick="previewCommsPlan(${esc(d)}, true)"><span class="material-symbols-outlined">mail</span>Comms plan</button>`,
    `<button class="preview-action-btn" onclick="navigateTo('automation')"><span class="material-symbols-outlined">hub</span>Automation</button>`
  ])}`, pin);
};

window.toggleFunnelStage = function(el, stageLabel) {
  const existing = el.nextElementSibling;
  if (existing && existing.classList.contains('funnel-deals')) {
    existing.remove();
    el.classList.remove('expanded');
    return;
  }
  el.classList.add('expanded');
  const allDeals = L.all_deals || L.high_value_deals || [];
  const matched = allDeals.filter(d =>
    d.stage && normText(d.stage).includes(normText(stageLabel)) || normText(stageLabel).includes(normText(d.stage))
  );
  const dealsHtml = matched.map(d => `
    <div class="q-item" onmouseenter="previewDeal(this, '${esc(d)}')" onmouseleave="clearPreview()" onclick="previewDeal(this, '${esc(d)}', true)" style="cursor:pointer;">
      <div style="display:flex;justify-content:space-between;align-items:start;">
        <div class="q-item-title">${d.name}</div>
        <div class="q-item-value">${fmt$(d.value)}</div>
      </div>
      <div class="q-item-sub">${d.event || '—'} · ${d.venue || 'TBD'}</div>
      <div class="q-item-meta">${badge(d.confidence+'% confidence')} ${badge(d.status === 'won' ? 'won' : d.status === 'at_risk' ? 'risk' : 'high')}</div>
      <div class="ai-actions">
        <button class="ai-btn" onclick="queueFollowUp('${d.lead_id || ''}','${String(d.name).replace(/'/g, "\\'")}')"><span class="material-symbols-outlined">mail</span> Follow-up</button>
        <button class="ai-btn" onclick="aiAnalyzeDeal(${esc(d)})"><span class="material-symbols-outlined">analytics</span> Analyze</button>
      </div>
    </div>
  `).join('');
  const dealsDiv = document.createElement('div');
  dealsDiv.className = 'funnel-deals';
  dealsDiv.innerHTML = dealsHtml || '<div style="padding:0.4rem 2.4rem;color:var(--burgundy);opacity:0.5;font-size:0.75rem;">No deals in this stage</div>';
  el.after(dealsDiv);
};

// ═══════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════
function renderActions() {
  const buckets = [
    { key:'today', title:'<span class="material-symbols-outlined" style="font-size:0.8rem;color:var(--coral);">circle</span> Today', color:'var(--rose)' },
    { key:'within_48h', title:'<span class="material-symbols-outlined" style="font-size:0.8rem;color:var(--amber);">circle</span> 48 Hours', color:'var(--amber)' },
    { key:'within_3_7d', title:'<span class="material-symbols-outlined" style="font-size:0.8rem;color:var(--gold);">circle</span> 3–7 Days', color:'var(--gold)' },
    { key:'watch_list', title:'<span class="material-symbols-outlined" style="font-size:0.8rem;color:var(--cyan);">circle</span> Watch List', color:'var(--cyan)' },
  ];
  stageScroll.innerHTML = `
    <div class="vh"><span class="label"><span class="material-symbols-outlined">task_alt</span> Action Board</span><h2>Task Intelligence</h2><p>${T.task_summary?.total||0} tasks · ${T.task_summary?.today||0} today · ${T.open_loops?.length||0} open loops</p></div>
    <div class="kanban">
      ${buckets.map(b => {
        const items = T.tasks?.[b.key] || [];
        return `<div class="kanban-col"><h3>${b.title} <span class="count">${items.length}</span></h3>${items.map(t => `
          <div class="q-item" onmouseenter="previewTask(${esc(t)})" onmouseleave="clearPreview()" onclick="previewTask(${esc(t)}, true)" style="cursor:pointer;">
            <div style="display:flex;justify-content:space-between;align-items:start;gap:0.3rem;">
              <div class="q-item-title" style="font-size:0.78rem;">${t.lead}</div>
              ${t.value ? `<div style="font-family:'Fraunces',serif;font-weight:800;font-size:0.78rem;color:var(--green);white-space:nowrap;">${fmt$(t.value)}</div>` : ''}
            </div>
            <div class="q-item-sub" style="font-size:0.65rem;">${t.action}</div>
            <div class="q-item-meta">${badge(t.urgency, t.urgency)}<span class="material-symbols-outlined" style="font-size:0.75rem;color:var(--burgundy);opacity:0.3;">${t.icon}</span></div>
          </div>
        `).join('')}</div>`;
      }).join('')}
    </div>
    ${T.bottlenecks?.length ? `<div class="panel-block" style="margin-top:1rem;border-color:var(--coral);"><h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--coral);">warning</span> Bottlenecks — Waiting on Us</h2><div style="display:grid;gap:0.5rem;">${T.bottlenecks.map(b => `<div class="q-item" style="border-color:rgba(240,144,122,0.3);"><div class="q-item-title">${b.lead}</div><div class="q-item-sub">${b.issue} · Stalled ${b.days_stalled} days</div><div class="q-item-meta">${badge('ACTION: '+b.action, 'urgent')}</div></div>`).join('')}</div></div>` : ''}
    ${T.open_loops?.length ? `<div class="panel-block" style="margin-top:0.8rem;"><h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--amber);">sync</span> Open Loops</h2><div style="display:grid;gap:0.5rem;">${T.open_loops.map(l => `<div class="q-item"><div class="q-item-title">${l.lead}</div><div class="q-item-sub" style="font-style:italic;">"${l.question}"</div><div class="q-item-meta">${badge(l.status)} ${badge(l.days_open+'d open')}</div></div>`).join('')}</div></div>` : ''}
  `;
}

// ═══════════════════════════════════════
// PERFORMANCE
// ═══════════════════════════════════════
function renderPerformance() {
  const sb = K.scoreboard || {};
  const rows = Object.entries(sb).map(([key, v]) => {
    const label = key.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
    const isNum1 = v.ranking === 1;
    const advCls = v.advantage > 0 ? 'pos' : v.advantage < 0 ? 'neg' : 'neutral';
    const rankLabel = isNum1 ? '<span class="material-symbols-outlined" style="font-size:0.85rem;color:var(--gold);">military_tech</span> #1' : v.ranking === 'at_quota' ? '<span class="material-symbols-outlined" style="font-size:0.75rem;color:var(--green);">check</span>' : v.ranking === 'above' ? '<span class="material-symbols-outlined" style="font-size:0.75rem;color:var(--green);">check</span>' : v.ranking === 'below' ? '<span class="material-symbols-outlined" style="font-size:1rem;color:var(--coral);">error</span>' : v.ranking;
    const andreVal = typeof v.andre === 'number' && v.andre > 100 ? v.andre.toLocaleString() : v.andre;
    const teamVal = typeof v.team_avg === 'number' && v.team_avg > 100 ? v.team_avg.toLocaleString() : v.team_avg;
    return `<tr><td style="font-weight:600;">${label}</td><td class="kpi-val" style="color:var(--maroon-deep)">${andreVal}</td><td style="opacity:0.5;">${teamVal}</td><td>${rankLabel}</td><td class="kpi-adv ${advCls}">${v.advantage > 0 ? '+' : ''}${v.advantage}%</td></tr>`;
  });

  const callData = K.call_activity || {};
  const intel = OS.andre_coaching_intel || {};
  const teamRows = (intel.team_comparison || []).map((t, idx) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:0.35rem 0;border-bottom:1px solid rgba(201,168,76,0.04);">
      <span style="font-size:0.75rem;font-weight:${t.name === 'Andre Raw' ? '700' : '400'};color:${t.name === 'Andre Raw' ? 'var(--rose)' : 'inherit'};">${idx+1}. ${t.name}</span>
      <div style="display:flex;align-items:center;gap:0.5rem;">
        <span style="font-size:0.65rem;">${t.active} active / ${t.stalled} stalled</span>
        ${badge(t.pressure + ' pressure', t.level === 'high' ? 'urgent' : t.level === 'medium' ? 'medium' : 'won')}
      </div>
    </div>
  `).join('');

  stageScroll.innerHTML = `
    <div class="vh"><span class="label"><span class="material-symbols-outlined">leaderboard</span> Performance</span><h2>Scoreboard Intelligence</h2><p>Andre vs. Team — every metric that matters</p></div>
    <div class="panel-block" style="overflow-x:auto;"><h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);">emoji_events</span> Full KPI Scoreboard</h2>
      <table class="kpi-table"><thead><tr><th>Metric</th><th>Andre</th><th>Team Avg</th><th>Rank</th><th>Advantage</th></tr></thead><tbody>${rows.join('')}</tbody></table>
    </div>

    <div class="layout-grid-half">
      <div class="panel-block"><h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);">bar_chart</span> Andre vs Team</h2>
        <canvas id="perfBarChart" style="width:100%;height:300px;"></canvas>
      </div>
      <div class="panel-block"><h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);">radar_chart</span> Strength Profile</h2>
        <canvas id="perfRadarChart" style="width:100%;height:300px;"></canvas>
      </div>
    </div>

    <div class="panel-block"><h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);">speed</span> Sales Power Score</h2>
      <div style="display:flex;align-items:center;justify-content:center;padding:2rem;">
        <svg id="perfProgressRing" viewBox="0 0 200 200" style="width:200px;height:200px;"></svg>
      </div>
    </div>

    <div class="layout-grid-half">
      <div class="panel-block" style="border-color:var(--gold);background:linear-gradient(to bottom, #161410, rgba(201,168,76,0.04));">
        <h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);vertical-align:text-bottom;margin-right:0.2rem;">smart_toy</span> Oracle Team Pressure Board</h2>
        <p class="panel-note" style="margin-bottom:0.8rem;">Real-time coaching pressure calculated by Oracle based on pipeline stall and playbook drift.</p>
        <div class="script-block" style="border-left-color:var(--gold);margin-bottom:1rem;font-size:0.72rem;">
          <strong style="color:var(--maroon-deep);">Oracle Takeaway:</strong> ${intel.manager_takeaway || ''}
        </div>
        <div style="display:grid;gap:0.2rem;">
          ${teamRows}
        </div>
      </div>
      <div class="panel-block"><h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--cyan);">call</span> Call Activity</h2>
        <div class="pv-field"><span class="pv-field-label">Total Calls</span><span class="pv-field-value">${callData.total}</span></div>
        <div class="pv-field"><span class="pv-field-label">February</span><span class="pv-field-value">${callData.february}</span></div>
        <div class="pv-field"><span class="pv-field-label">March</span><span class="pv-field-value">${callData.march}</span></div>
        <div class="pv-field"><span class="pv-field-label">Growth</span><span class="pv-field-value" style="color:var(--green)">+${callData.growth_rate}%</span></div>
        <div class="pv-divider"></div>
        <div class="pv-field"><span class="pv-field-label">Outbound</span><span class="pv-field-value">${callData.outbound} (${callData.outbound_pct}%)</span></div>
        <div class="pv-field"><span class="pv-field-label">Inbound</span><span class="pv-field-value">${callData.inbound}</span></div>
        <div class="pv-field"><span class="pv-field-label">Repeat Rate</span><span class="pv-field-value">${callData.repeat_contact_rate}%</span></div>
        <div class="pv-divider"></div>
        <h3 style="font-size:0.75rem;margin:0.5rem 0;">Top Contacts</h3>
        <div style="display:grid;gap:0.3rem;">
          ${(callData.top_contacts||[]).map((c,i) => `<div style="display:flex;align-items:center;justify-content:space-between;padding:0.2rem 0;border-bottom:1px solid rgba(201,168,76,0.04);"><span style="font-size:0.7rem;">${i+1}. ${c.name}</span><span style="font-family:'Fraunces',serif;font-weight:700;font-size:0.72rem;color:var(--rose);">${c.calls} calls</span></div>`).join('')}
        </div>
      </div>
    </div>
    <div class="layout-grid-half">
      <div class="panel-block"><h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--green);">trending_up</span> Leading Indicators</h2>${renderIndicators(K.leading_indicators)}</div>
      <div class="panel-block"><h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--coral);">trending_down</span> Lagging Indicators</h2>${renderIndicators(K.lagging_indicators)}</div>
    </div>
  `;

  // Render charts after DOM is ready
  setTimeout(() => renderPerformanceCharts(sb), 50);
}

function renderIndicators(list) {
  if (!list?.length) return '<div class="q-item-sub">No data</div>';
  return list.map(i => {
    const pct = i.current != null && i.target ? Math.min((i.current / i.target) * 100, 100) : 0;
    const color = i.status === 'critical' || i.status === 'urgent' ? 'var(--rose)' : i.status === 'improve' ? 'var(--amber)' : i.status === 'close' ? 'var(--gold)' : 'var(--green)';
    return `<div style="margin-bottom:0.6rem;"><div style="display:flex;justify-content:space-between;font-size:0.72rem;margin-bottom:0.2rem;"><span>${i.metric}</span>${badge(i.status, i.status === 'critical' || i.status === 'urgent' ? 'urgent' : i.status === 'improve' ? 'medium' : '')}</div><div class="progress"><div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${color}"></div></div><div class="progress-label">${i.current ?? '?'}${i.unit === '%' ? '%' : ''} / ${i.target}${i.unit === '%' ? '%' : ''}</div></div></div>`;
  }).join('');
}

// ═══════════════════════════════════════
// PERFORMANCE CHARTS
// ═══════════════════════════════════════
function renderPerformanceCharts(sb) {
  // Color palette
  const COLORS = {
    bg: '#0A0A0A',
    gold: '#C9A84C',
    green: '#4A9E68',
    coral: '#C47050',
    textLight: '#F0E8D4',
    gridline: 'rgba(201,168,76,0.3)',
    mutedGray: 'rgba(240,232,212,0.2)'
  };

  // 1. HORIZONTAL BAR CHART — Andre vs Team
  const barCanvas = document.getElementById('perfBarChart');
  if (barCanvas) {
    const displayMetrics = [
      { key: 'bonus_multiplier', label: 'Bonus Multiplier' },
      { key: 'overall_score', label: 'Overall Score' },
      { key: 'ninety_day_closed_biz', label: '90-Day Closed Biz' },
      { key: 'hours_worked', label: 'Hours Worked' },
      { key: 'dials_made', label: 'Dials Made' }
    ];

    const data = displayMetrics
      .map(m => sb[m.key] ? { label: m.label, ...sb[m.key] } : null)
      .filter(d => d !== null);

    drawHorizontalBarChart(barCanvas, data, COLORS);
  }

  // 2. RADAR CHART — Andre's Strengths
  const radarCanvas = document.getElementById('perfRadarChart');
  if (radarCanvas) {
    const radarMetrics = [
      { key: 'bonus_multiplier', label: 'Bonus' },
      { key: 'overall_score', label: 'Overall' },
      { key: 'ninety_day_closed_biz', label: 'Closed Biz' },
      { key: 'hours_worked', label: 'Hours' },
      { key: 'dials_made', label: 'Dials' }
    ];

    const radarData = radarMetrics
      .map(m => sb[m.key] ? { label: m.label, advantage: Math.min(sb[m.key].advantage, 100) } : null)
      .filter(d => d !== null);

    drawRadarChart(radarCanvas, radarData, COLORS);
  }

  // 3. PROGRESS RING — Sales Power Score
  const progressSvg = document.getElementById('perfProgressRing');
  if (progressSvg && sb.overall_score) {
    drawProgressRing(progressSvg, sb.overall_score.andre, 4000, COLORS);
  }
}

function drawHorizontalBarChart(canvas, data, colors) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  canvas.width = width * dpr;
  canvas.height = height * dpr;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const padding = { top: 30, right: 20, bottom: 20, left: 120 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const barHeight = chartHeight / data.length;
  const barGap = 8;
  const barWidth = (barHeight - barGap) / 2;

  // Background
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, height);

  // Get max value for scaling
  const maxVal = Math.max(...data.flatMap(d => [d.andre || 0, d.team_avg || 0]));
  const scale = chartWidth / maxVal;

  // Draw bars and labels
  data.forEach((d, i) => {
    const y = padding.top + i * barHeight;

    // Label
    ctx.fillStyle = colors.textLight;
    ctx.font = '11px "DM Sans"';
    ctx.textAlign = 'right';
    ctx.fillText(d.label, padding.left - 10, y + barHeight / 2 + 4);

    // Andre bar (gold)
    const andreX = padding.left;
    const andreWidth = (d.andre || 0) * scale;
    ctx.fillStyle = colors.gold;
    ctx.fillRect(andreX, y + 2, andreWidth, barWidth);

    // Team avg bar (muted gray)
    const teamY = y + barWidth + barGap / 2;
    const teamWidth = (d.team_avg || 0) * scale;
    ctx.fillStyle = colors.mutedGray;
    ctx.fillRect(padding.left, teamY, teamWidth, barWidth);

    // Value labels
    ctx.fillStyle = colors.textLight;
    ctx.font = 'bold 10px "DM Sans"';
    ctx.textAlign = 'left';
    const andVal = typeof d.andre === 'number' && d.andre > 100 ? d.andre.toLocaleString() : d.andre;
    const teamVal = typeof d.team_avg === 'number' && d.team_avg > 100 ? d.team_avg.toLocaleString() : d.team_avg;
    ctx.fillText(String(andVal), padding.left + andreWidth + 8, y + barWidth + 3);
    ctx.fillText(String(teamVal), padding.left + teamWidth + 8, teamY + barWidth + 3);
  });

  // Legend
  ctx.font = '10px "DM Sans"';
  ctx.fillStyle = colors.gold;
  ctx.fillRect(padding.left, height - 18, 8, 8);
  ctx.fillStyle = colors.textLight;
  ctx.textAlign = 'left';
  ctx.fillText('Andre', padding.left + 12, height - 12);

  ctx.fillStyle = colors.mutedGray;
  ctx.fillRect(padding.left + 80, height - 18, 8, 8);
  ctx.fillStyle = colors.textLight;
  ctx.fillText('Team Avg', padding.left + 92, height - 12);
}

function drawRadarChart(canvas, data, colors) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  canvas.width = width * dpr;
  canvas.height = height * dpr;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Background
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, height);

  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(width, height) / 2 - 40;
  const levels = 5;
  const numAxes = data.length;
  const angleSlice = (Math.PI * 2) / numAxes;

  // Draw concentric circles (gridlines)
  for (let i = 1; i <= levels; i++) {
    const radius = (maxRadius / levels) * i;
    ctx.strokeStyle = colors.gridline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let j = 0; j < numAxes; j++) {
      const angle = angleSlice * j - Math.PI / 2;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      if (j === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Draw axes
  ctx.strokeStyle = colors.gridline;
  ctx.lineWidth = 1;
  for (let i = 0; i < numAxes; i++) {
    const angle = angleSlice * i - Math.PI / 2;
    const x = centerX + maxRadius * Math.cos(angle);
    const y = centerY + maxRadius * Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  // Draw data polygon (Andre's advantage)
  const points = data.map((d, i) => {
    const angle = angleSlice * i - Math.PI / 2;
    const val = Math.min((d.advantage || 0) / 100, 1);
    const radius = maxRadius * val;
    return {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle)
    };
  });

  // Fill polygon with low opacity gold
  ctx.fillStyle = 'rgba(201, 168, 76, 0.2)';
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.fill();

  // Stroke polygon with gold
  ctx.strokeStyle = colors.gold;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Draw dots
  ctx.fillStyle = colors.gold;
  points.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // Draw labels
  ctx.fillStyle = colors.textLight;
  ctx.font = '11px "DM Sans"';
  ctx.textAlign = 'center';
  data.forEach((d, i) => {
    const angle = angleSlice * i - Math.PI / 2;
    const labelRadius = maxRadius + 25;
    const x = centerX + labelRadius * Math.cos(angle);
    const y = centerY + labelRadius * Math.sin(angle);
    ctx.fillText(d.label, x, y + 4);
  });
}

function drawProgressRing(svg, current, target, colors) {
  svg.innerHTML = '';
  const radius = 90;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(current / target, 1);
  const offset = circumference * (1 - progress);

  // Background circle
  const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  bgCircle.setAttribute('cx', '100');
  bgCircle.setAttribute('cy', '100');
  bgCircle.setAttribute('r', radius);
  bgCircle.setAttribute('fill', 'none');
  bgCircle.setAttribute('stroke', colors.mutedGray);
  bgCircle.setAttribute('stroke-width', '8');
  svg.appendChild(bgCircle);

  // Progress circle
  const progressCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  progressCircle.setAttribute('cx', '100');
  progressCircle.setAttribute('cy', '100');
  progressCircle.setAttribute('r', radius);
  progressCircle.setAttribute('fill', 'none');
  progressCircle.setAttribute('stroke', colors.gold);
  progressCircle.setAttribute('stroke-width', '8');
  progressCircle.setAttribute('stroke-dasharray', circumference);
  progressCircle.setAttribute('stroke-dashoffset', offset);
  progressCircle.setAttribute('stroke-linecap', 'round');
  progressCircle.setAttribute('transform', 'rotate(-90 100 100)');
  progressCircle.setAttribute('style', 'transition: stroke-dashoffset 0.5s ease;');
  svg.appendChild(progressCircle);

  // Center text
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', '100');
  text.setAttribute('y', '105');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('font-family', 'DM Sans');
  text.setAttribute('font-size', '24');
  text.setAttribute('font-weight', 'bold');
  text.setAttribute('fill', colors.gold);
  text.textContent = Math.round(progress * 100) + '%';
  svg.appendChild(text);

  // Below: current / target
  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  label.setAttribute('x', '100');
  label.setAttribute('y', '135');
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('font-family', 'DM Sans');
  label.setAttribute('font-size', '12');
  label.setAttribute('fill', colors.textLight);
  label.textContent = `${current.toLocaleString()} / ${target.toLocaleString()}`;
  svg.appendChild(label);
}

// ═══════════════════════════════════════
// COACHING
// ═══════════════════════════════════════
function renderCoaching() {
  const gaps = P.development_areas || [];
  const plan = T.coaching_plan || {};
  const insights = P.conversation_insights || {};
  const scripts = OT.call_scripts || {};
  const vg = OC.voice_guide || {};
  stageScroll.innerHTML = `
    <div class="vh"><span class="label"><span class="material-symbols-outlined">school</span> Coaching</span><h2>Development Intelligence</h2><p>3 skill gaps with playbook-based fixes · Oracle scripts · 30-day roadmap</p></div>
    <div class="panel-block" style="border-color:var(--gold);background:linear-gradient(to bottom, #161410, rgba(201,168,76,0.04));margin-bottom:1rem;">
      <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.6rem;">
        <span class="material-symbols-outlined" style="font-size:1.3rem;color:var(--gold);">smart_toy</span>
        <div>
          <div style="font-family:'Fraunces',serif;font-weight:700;font-size:0.95rem;color:var(--maroon-deep);">Oracle Coaching</div>
          <div style="font-size:0.68rem;color:var(--burgundy);opacity:0.5;">AI-powered coaching based on your pipeline and development areas</div>
        </div>
      </div>
      <div class="ai-actions">
        <button class="ai-btn" style="padding:0.35rem 0.9rem;font-size:0.68rem;" onclick="aiCoachMe()"><span class="material-symbols-outlined">school</span> What should I focus on right now?</button>
        <button class="ai-btn" style="padding:0.35rem 0.9rem;font-size:0.68rem;" onclick="oracleSend('Review my current pipeline and give me a brutally honest assessment of where I\\'m leaving money on the table')"><span class="material-symbols-outlined">analytics</span> Pipeline reality check</button>
        <button class="ai-btn" style="padding:0.35rem 0.9rem;font-size:0.68rem;" onclick="oracleSend('What are the 3 deals I could close fastest with the right move? Tell me exactly what to do.')"><span class="material-symbols-outlined">bolt</span> Quick wins</button>
      </div>
    </div>
    ${gaps.map(g => `
      <div class="gap-card" onclick="event.currentTarget.classList.toggle('expanded');" style="cursor:pointer;">
        <div class="gap-card-header"><div class="gap-card-title">${g.area}</div>${badge(g.severity, g.severity === 'critical' ? 'urgent' : g.severity)}</div>
        <div class="gap-card-body">${g.description} — ${g.deals_affected} deals affected</div>
        <div style="display:none;">
          ${g.area === 'Deposit Conversations' ? `<div class="script-block">"${scripts.deposit_close?.script || 'Based on everything we\'ve discussed...'}"<br><br><strong>— ${scripts.deposit_close?.source || 'Playbook Section 08.A.(c)'}</strong></div><div class="gap-card-body"><strong>Key insight:</strong> Andre knows how to GET interest but not how to SECURE commitments. Every gap has a playbook solution he's not using.</div><div class="script-block" style="border-left-color:var(--amber);">If they hesitate: "${scripts.deposit_hesitation?.script || ''}"<br><br><strong>— ${scripts.deposit_hesitation?.source || 'Closer Scripts'}</strong></div>` : ''}
          ${g.area === 'Tasting Conversion' ? `<div class="script-block">"${scripts.post_tasting_day1?.script || ''}"<br><br><strong>— ${scripts.post_tasting_day1?.source || 'Playbook Section 08.A'}</strong></div><div class="gap-card-body"><strong>5-Day Tasting Cadence:</strong> Day 1: Call + Text · Day 2: VM + Text · Day 3: Nothing · Day 4: VM · Day 5: Final "Have you given up?" text</div><div class="script-block" style="border-left-color:var(--amber);">Urgency close: "${scripts.urgency_scarcity?.script || ''}"<br><br><strong>— ${scripts.urgency_scarcity?.source || 'Playbook'}</strong></div>` : ''}
          ${g.area === 'Stakeholder Management' ? `<div class="script-block">"${scripts.secret_weapon?.script || ''}"<br><br><strong>— ${scripts.secret_weapon?.source || 'Playbook Section 06.02'}</strong></div><div class="gap-card-body"><strong>Fix:</strong> Bring the stakeholder INTO the conversation. Offer 3-way calls. Use Mirror + Sounds Like + Question pattern.</div><div class="script-block" style="border-left-color:var(--amber);">Three-way offer: "${scripts.three_way_offer?.script || ''}"<br><br><strong>— ${scripts.three_way_offer?.source || 'Playbook'}</strong></div>` : ''}
          <div class="ai-actions" onclick="event.stopPropagation()" style="margin-top:0.6rem;">
            <button class="ai-btn" onclick="aiCoachMe('${g.area}')"><span class="material-symbols-outlined">school</span> Practice This</button>
            <button class="ai-btn" onclick="oracleSend('Give me a detailed coaching session on how to master ${g.area}. Be specific and give me real examples and scripts.')"><span class="material-symbols-outlined">smart_toy</span> Deep Dive</button>
          </div>
        </div>
      </div>
    `).join('')}

    <div class="panel-block"><h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);">mic</span> Oracle Voice Guide</h2><p class="panel-note">${vg.sound_like || 'A calm advisor uncovering the event problem'}</p>
      <div class="layout-grid-half">
        <div><div class="pv-section-label">Core Voice</div><div class="pv-tags" style="margin-top:0.3rem;">${(vg.core_voice||[]).map(v => '<span class="pv-tag" style="color:var(--green);">'+v+'</span>').join('')}</div><div class="pv-section-label" style="margin-top:0.6rem;">In Practice</div><div style="display:grid;gap:0.2rem;margin-top:0.3rem;">${(vg.in_practice||[]).map(p => '<div style="font-size:0.68rem;color:var(--maroon);opacity:0.6;"><span class="material-symbols-outlined" style="font-size:0.75rem;color:var(--green);">check</span> '+p+'</div>').join('')}</div></div>
        <div><div class="pv-section-label">Red Flags</div><div style="display:grid;gap:0.2rem;margin-top:0.3rem;">${(vg.red_flags||[]).map(f => '<div style="font-size:0.68rem;color:var(--coral);"><span class="material-symbols-outlined" style="font-size:0.75rem;color:var(--coral);">close</span> '+f+'</div>').join('')}</div></div>
      </div>
    </div>

    <div class="panel-block"><h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--cyan);">calendar_month</span> 30-Day Development Roadmap</h2>
      <div style="display:grid;gap:0.6rem;">
        ${Object.entries(plan).map(([week, data]) => `
          <div class="q-item">
            <div class="q-item-title">${week.replace('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}: ${data.focus}</div>
            <div class="q-item-sub">${data.activities?.join(' · ')}</div>
            <div class="q-item-meta">${badge('Goal: '+data.goal, 'won')}</div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="panel-block"><h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--purple);">chat</span> Conversation Insights</h2>
      <div class="pv-field"><span class="pv-field-label">Calls Analyzed</span><span class="pv-field-value">${insights.sample_size || 30}</span></div>
      <div class="pv-field"><span class="pv-field-label">Portuguese</span><span class="pv-field-value">${insights.language_breakdown?.portuguese || 7}</span></div>
      <div class="pv-field"><span class="pv-field-label">English</span><span class="pv-field-value">${insights.language_breakdown?.english || 20}</span></div>
      <div class="pv-divider"></div>
      <div class="pv-section-label">Sample Excerpts</div>
      ${(insights.sample_excerpts || []).map(e => `<div class="script-block" style="border-left-color:var(--gold);">"${e.quote}"<br><small style="opacity:0.5;">— ${e.context} · ${e.note}</small></div>`).join('')}
    </div>
  `;
}

// ═══════════════════════════════════════
// DEALS
// ═══════════════════════════════════════
function renderDeals() {
  const deals = L.all_deals || [];
  stageScroll.innerHTML = `
    <div class="vh"><span class="label"><span class="material-symbols-outlined">handshake</span> Deals</span><h2>Deal Intelligence</h2><p>${deals.length} deals · Click to expand details</p></div>
    <div class="panel-block"><h2>Search & Filter</h2><input type="text" id="dealSearch" data-surface="deal-search" placeholder="Name, venue, stage, event, value, lead id…" style="width:100%;padding:0.5rem 0.8rem;border-radius:9999px;border:1.5px solid rgba(201,168,76,0.1);background:var(--cream-dark);font-family:inherit;font-size:0.75rem;outline:none;" oninput="filterDeals(this.value)" autocomplete="off"></div>
    <div id="dealList" style="display:grid;gap:0.4rem;">
      ${renderDealList(deals)}
    </div>
  `;
  if (currentDealFilter) {
    const input = $('#dealSearch');
    if (input) {
      input.value = currentDealFilter;
      filterDeals(currentDealFilter);
    }
  }
}

function renderDealList(deals) {
  return deals.map((d, i) => {
    const oracle = OS.deal_oracle_map?.[d.name];
    const plan = buildDealCommsPlan(d);
    const aiBadge = oracle ? `<span class="badge gold" style="display:inline-flex;align-items:center;gap:0.15rem;"><span class="material-symbols-outlined" style="font-size:0.7rem;">smart_toy</span> Oracle AI</span>` : '';
    return `
    <div class="deal-card" data-surface="deal-card" data-idx="${i}" data-deal-name="${String(d.name || '').replace(/"/g, '&quot;')}" ${d.lead_id ? `data-lead-id="${String(d.lead_id).replace(/"/g, '&quot;')}"` : ''} onclick="toggleDeal(this);previewDeal(null, ${esc(d)}, true);">
      <div class="deal-header">
        <div class="deal-name" style="display:flex;align-items:center;gap:0.4rem;">${d.name} ${aiBadge}</div>
        <div style="display:flex;align-items:center;gap:0.4rem;">
          <span style="font-family:'Fraunces',serif;font-weight:800;color:var(--green);">${fmt$(d.value)}</span>
          ${badge(d.priority, d.priority)}
        </div>
      </div>
      <div class="q-item-meta" style="margin-top:0.3rem;">${badge(d.stage)} ${d.risk?.map(r => badge(r.replace(/_/g,' '), 'risk')).join('') || ''}</div>
      <div class="deal-details">
        <div class="deal-field"><span class="deal-field-label">Event Type</span><span class="deal-field-value">${d.event||'—'}</span></div>
        <div class="deal-field"><span class="deal-field-label">Guests</span><span class="deal-field-value">${d.guests||'TBD'}</span></div>
        <div class="deal-field"><span class="deal-field-label">Venue</span><span class="deal-field-value">${d.venue||'TBD'}</span></div>
        <div class="deal-field"><span class="deal-field-label">Confidence</span><span class="deal-field-value">${d.confidence||'—'}%</span></div>
        <div class="deal-field"><span class="deal-field-label">Priority</span><span class="deal-field-value">${d.priority}</span></div>
        <div class="deal-field"><span class="deal-field-label">Comms lane</span><span class="deal-field-value">${plan.channel}</span></div>
        <div class="deal-comms-line">
          <span>${plan.objective}</span>
          <span>${plan.packet ? badge(plan.packet.name, 'gold') : badge(plan.urgency + ' outreach', plan.urgency)}</span>
        </div>
        <div style="margin-top:0.6rem;padding-top:0.6rem;border-top:1px solid rgba(201,168,76,0.08);">
          <div style="font-size:0.58rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--gold);margin-bottom:0.4rem;">Communication Plan</div>
          <div class="deal-comms-line"><span>Channel</span><strong>${plan.channel}</strong></div>
          <div class="deal-comms-line"><span>Objective</span><strong style="font-size:0.62rem;">${plan.objective}</strong></div>
          <div class="deal-comms-line"><span>Tone</span><strong>${plan.tone}</strong></div>
          <div class="deal-comms-line"><span>Urgency</span><span class="badge ${plan.urgency}">${plan.urgency}</span></div>
        </div>
        <div class="ai-actions" onclick="event.stopPropagation()">
          <button class="ai-btn" onclick="aiDraftFollowup(${esc(d)})"><span class="material-symbols-outlined">edit_note</span> Follow-up</button>
          <button class="ai-btn" onclick="previewCommsPlan(${esc(d)}, true)"><span class="material-symbols-outlined">mail</span> Comms</button>
          <button class="ai-btn" onclick="aiAnalyzeDeal(${esc(d)})"><span class="material-symbols-outlined">analytics</span> Analyze</button>
          <button class="ai-btn" onclick="aiHandleObjection(${esc(d)})"><span class="material-symbols-outlined">shield</span> Objections</button>
          <button class="ai-btn" onclick="aiDiscoveryQuestions(${esc(d)})"><span class="material-symbols-outlined">help</span> Discovery</button>
          <button class="ai-btn" onclick="aiCoachMe(${esc(d)})"><span class="material-symbols-outlined">school</span> Coach</button>
          ${d.stage?.toLowerCase().includes('tasting') ? `<button class="ai-btn" onclick="aiTastingFollowup(${esc(d)})"><span class="material-symbols-outlined">restaurant</span> Tasting</button>` : ''}
          ${(d.risk?.length || d.priority === 'high') ? `<button class="ai-btn" onclick="aiStalledRecovery(${esc(d)})"><span class="material-symbols-outlined">restart_alt</span> Recovery</button>` : ''}
        </div>
      </div>
    </div>
  `}).join('');
}

window.toggleDeal = function(el) { el.classList.toggle('expanded'); };
window.filterDeals = function(q) {
  currentDealFilter = q || '';
  const nq = normText(q);
  const all = L.all_deals || [];
  const deals = !nq ? all : all.filter(d => dealSearchHaystack(d).includes(nq));
  const el = $('#dealList');
  if (el) el.innerHTML = renderDealList(deals);
};

// ═══════════════════════════════════════
// AUTOMATION BLUEPRINT + COMMAND PALETTE
// ═══════════════════════════════════════
const BLUEPRINT_LS = 'automation_blueprint_v1';

function loadAutomationBlueprintFromStorage() {
  try {
    const raw = localStorage.getItem(BLUEPRINT_LS);
    if (!raw) return;
    const o = JSON.parse(raw);
    if (Array.isArray(o.steps)) automationBlueprintState.steps = o.steps;
  } catch (_) { /* ignore */ }
}

function saveAutomationBlueprintToStorage() {
  try {
    localStorage.setItem(BLUEPRINT_LS, JSON.stringify({ steps: automationBlueprintState.steps }));
  } catch (_) { /* ignore */ }
}

async function loadAutomationCatalog() {
  if (automationBlueprintState.catalog?.nodes?.length) return automationBlueprintState.catalog;
  try {
    const r = await fetch(`${SERVER}/data/automation_node_catalog.json`, { cache: 'no-store' });
    automationBlueprintState.catalog = await r.json();
  } catch (_) {
    automationBlueprintState.catalog = { nodes: [], platforms: [] };
  }
  return automationBlueprintState.catalog;
}

function renderAutomationBlueprintPanel() {
  return `
    <div class="panel-block automation-blueprint-panel" data-surface="automation-blueprint-panel">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.5rem;">
        <div>
          <h2 style="margin-bottom:0.2rem;"><span class="material-symbols-outlined" style="font-size:1rem;color:var(--cyan);">account_tree</span> Automation Blueprint</h2>
          <p class="panel-note" style="margin:0;">Design-only: chain steps across <strong>Close</strong>, <strong>this server</strong>, <strong>OpenAI</strong>, <strong>Codex</strong>, <strong>Claude Code</strong>, <strong>Cursor</strong>, and <strong>human</strong> gates. Export JSON and a markdown implementation packet (per-platform prompts). Execution from this UI comes later.</p>
        </div>
      </div>
      <div class="blueprint-toolbar" data-surface="automation-blueprint-toolbar">
        <select id="blueprintNodeSelect" data-surface="automation-blueprint-node-select" class="settings-input" style="flex:1;min-width:14rem;font-size:0.72rem;">
          <option value="">— Pick node type —</option>
        </select>
        <button type="button" class="preview-action-btn gold" data-surface="automation-blueprint-add" onclick="blueprintAddStep()"><span class="material-symbols-outlined">add</span>Add step</button>
        <button type="button" class="preview-action-btn" data-surface="automation-blueprint-clear" onclick="blueprintClearAll()"><span class="material-symbols-outlined">delete_sweep</span>Clear all</button>
      </div>
      <div id="blueprintSteps" class="blueprint-steps" data-surface="automation-blueprint-steps"></div>
      <div class="blueprint-export-row" data-surface="automation-blueprint-export">
        <button type="button" class="preview-action-btn gold" data-surface="automation-blueprint-copy-json" onclick="blueprintExport('json')"><span class="material-symbols-outlined">data_object</span>Copy JSON</button>
        <button type="button" class="preview-action-btn" data-surface="automation-blueprint-copy-md" onclick="blueprintExport('md')"><span class="material-symbols-outlined">article</span>Copy markdown packet</button>
        <button type="button" class="preview-action-btn" data-surface="automation-blueprint-preview-toggle" onclick="blueprintTogglePreview()"><span class="material-symbols-outlined">visibility</span>Toggle preview</button>
      </div>
      <pre id="blueprintExportPreview" class="blueprint-export-pre" data-surface="automation-blueprint-export-preview" style="display:none;"></pre>
    </div>`;
}

function blueprintHydrateSelectAndSteps() {
  const sel = $('#blueprintNodeSelect');
  if (sel) {
    const nodes = automationBlueprintState.catalog?.nodes || [];
    sel.innerHTML = '<option value="">— Pick node type —</option>' +
      nodes.map(n => `<option value="${String(n.id).replace(/"/g, '&quot;')}">${(n.label || n.id).replace(/</g, '&lt;')}</option>`).join('');
  }
  renderBlueprintStepsList();
}

function blueprintStepFieldChanged(e) {
  const uid = e.target?.dataset?.uid;
  if (!uid) return;
  const step = automationBlueprintState.steps.find(s => s.uid === uid);
  if (!step) return;
  if (e.target.classList.contains('blueprint-step-title')) step.title = e.target.value;
  if (e.target.classList.contains('blueprint-step-notes')) step.notes = e.target.value;
  saveAutomationBlueprintToStorage();
}

function renderBlueprintStepsList() {
  const host = $('#blueprintSteps');
  if (!host) return;
  const nodes = automationBlueprintState.catalog?.nodes || [];
  const plats = automationBlueprintState.catalog?.platforms || [];
  if (!automationBlueprintState.steps.length) {
    host.innerHTML = '<p class="panel-note" style="margin:0;">No steps yet. Choose a node type and click <strong>Add step</strong>.</p>';
    return;
  }
  host.innerHTML = automationBlueprintState.steps.map((step, idx) => {
    const nodeDef = nodes.find(n => n.id === step.nodeId) || { label: step.nodeId, platform: 'transform', description: '' };
    const plat = plats.find(p => p.id === nodeDef.platform);
    const uid = String(step.uid).replace(/'/g, '');
    const desc = (nodeDef.description || '').replace(/</g, '&lt;');
    const descShort = desc.length > 120 ? desc.substring(0, 120) + '…' : desc;
    return `
      <div class="blueprint-step" data-surface="blueprint-step" data-node-id="${String(step.nodeId || '').replace(/"/g, '&quot;')}" data-uid="${uid}">
        <div class="blueprint-step-index">${idx + 1}</div>
        <div class="blueprint-step-body">
          <input class="blueprint-step-title" data-uid="${uid}" value="${(step.title || '').replace(/"/g, '&quot;')}" />
          <textarea class="blueprint-step-notes" data-uid="${uid}" placeholder="Implementation notes, I/O, edge cases…">${(step.notes || '').replace(/</g, '&lt;')}</textarea>
          <div class="blueprint-step-meta">${(plat?.label || nodeDef.platform || '').replace(/</g, '&lt;')} · ${descShort}</div>
        </div>
        <div class="blueprint-step-actions">
          <button type="button" class="preview-action-btn" title="Up" onclick="blueprintMoveStep('${uid}', -1)"><span class="material-symbols-outlined">arrow_upward</span></button>
          <button type="button" class="preview-action-btn" title="Down" onclick="blueprintMoveStep('${uid}', 1)"><span class="material-symbols-outlined">arrow_downward</span></button>
          <button type="button" class="preview-action-btn" title="Remove" onclick="blueprintRemoveStep('${uid}')"><span class="material-symbols-outlined">close</span></button>
        </div>
      </div>`;
  }).join('');
  host.querySelectorAll('.blueprint-step-title, .blueprint-step-notes').forEach(el => {
    el.addEventListener('change', blueprintStepFieldChanged);
    el.addEventListener('blur', blueprintStepFieldChanged);
  });
}

window.blueprintAddStep = async function() {
  await loadAutomationCatalog();
  const sel = $('#blueprintNodeSelect');
  const id = sel?.value;
  if (!id) {
    Toast.warning('Choose a node type first.');
    return;
  }
  const node = (automationBlueprintState.catalog?.nodes || []).find(n => n.id === id);
  automationBlueprintState.steps.push({
    uid: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `s_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    nodeId: id,
    title: node?.label || id,
    notes: node?.description || '',
  });
  saveAutomationBlueprintToStorage();
  blueprintHydrateSelectAndSteps();
};

window.blueprintClearAll = function() {
  if (!automationBlueprintState.steps.length) return;
  if (!confirm('Clear all blueprint steps?')) return;
  automationBlueprintState.steps = [];
  saveAutomationBlueprintToStorage();
  renderBlueprintStepsList();
};

window.blueprintMoveStep = function(uid, delta) {
  const i = automationBlueprintState.steps.findIndex(s => s.uid === uid);
  if (i < 0) return;
  const j = i + delta;
  if (j < 0 || j >= automationBlueprintState.steps.length) return;
  const t = automationBlueprintState.steps[i];
  automationBlueprintState.steps[i] = automationBlueprintState.steps[j];
  automationBlueprintState.steps[j] = t;
  saveAutomationBlueprintToStorage();
  renderBlueprintStepsList();
};

window.blueprintRemoveStep = function(uid) {
  automationBlueprintState.steps = automationBlueprintState.steps.filter(s => s.uid !== uid);
  saveAutomationBlueprintToStorage();
  renderBlueprintStepsList();
};

window.blueprintExport = async function(kind) {
  await loadAutomationCatalog();
  const nodes = automationBlueprintState.catalog?.nodes || [];
  const plats = automationBlueprintState.catalog?.platforms || [];
  const enriched = automationBlueprintState.steps.map((s, i) => {
    const def = nodes.find(n => n.id === s.nodeId) || {};
    return { order: i + 1, ...s, node: def, platform_id: def.platform };
  });
  if (kind === 'json') {
    const payload = {
      version: 1,
      exported_at: new Date().toISOString(),
      app: 'Comeketo Sales Command Center',
      steps: enriched,
    };
    const txt = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(txt);
      Toast.success('Blueprint JSON copied');
    } catch (_) {
      blueprintShowPreview(txt);
      Toast.warning('Clipboard blocked — see preview');
    }
    return;
  }
  if (kind === 'md') {
    let md = '# Automation implementation packet\n\n';
    md += `Generated \`${new Date().toISOString()}\` · **Design-only** — paste into Codex, Claude Code, Cursor, or your runbook.\n\n`;
    md += '## Discrete steps (ordered)\n\n';
    enriched.forEach(row => {
      md += `${row.order}. **${row.title}** (\`${row.nodeId}\`)\n`;
      md += `   - Platform: **${row.platform_id || '—'}**\n`;
      if (row.notes) md += `   - Notes: ${row.notes}\n`;
      md += '\n';
    });
    md += '## Per-platform prompt stubs\n\n';
    const byPlat = {};
    enriched.forEach(row => {
      const pid = row.platform_id || 'general';
      if (!byPlat[pid]) byPlat[pid] = [];
      byPlat[pid].push(row);
    });
    Object.keys(byPlat).sort().forEach(pid => {
      const pMeta = plats.find(p => p.id === pid);
      md += `### ${pMeta?.label || pid}\n`;
      if (pMeta?.hint) md += `_${pMeta.hint}_\n\n`;
      md += 'Implement the following steps in order, respecting existing auth and safety rules:\n\n';
      byPlat[pid].forEach(row => {
        md += `- **${row.title}**: ${(row.notes || row.node?.description || '').trim()}\n`;
      });
      md += '\n';
    });
    md += '## Acceptance checks\n\n- [ ] Each step has a clear input contract and output.\n- [ ] Secrets stay in env / Settings, not in repo.\n- [ ] Close calls use existing server proxies where possible.\n\n';
    try {
      await navigator.clipboard.writeText(md);
      Toast.success('Markdown packet copied');
    } catch (_) {
      blueprintShowPreview(md);
      Toast.warning('Clipboard blocked — see preview');
    }
  }
};

function blueprintShowPreview(text) {
  const pre = $('#blueprintExportPreview');
  if (!pre) return;
  pre.style.display = 'block';
  pre.textContent = text;
}

window.blueprintTogglePreview = function() {
  const pre = $('#blueprintExportPreview');
  if (!pre) return;
  pre.style.display = pre.style.display === 'none' ? 'block' : 'none';
};

// ─── COMMAND PALETTE (⌘K / Ctrl+K) ───────────────────
let commandPaletteFiltered = [];
let commandPaletteActive = 0;

function buildCommandPaletteItems() {
  const items = [];
  const nav = (id, label, sub, icon) => {
    items.push({
      kind: 'nav',
      icon: icon || 'dashboard',
      label,
      sub: sub || '',
      hay: normText(`${label} ${sub}`),
      run() {
        closeCommandPalette();
        navigateTo(id);
      },
    });
  };
  nav('command', 'Command Center', 'KPIs, Close inbox intel, war room', 'hive');
  nav('pipeline', 'Pipeline', 'Funnel and stages', 'filter_alt');
  nav('actions', 'Actions', 'Tasks and todos', 'check_circle');
  nav('performance', 'Performance', 'Metrics', 'bar_chart');
  nav('coaching', 'Coaching', 'Playbooks', 'school');
  nav('deals', 'Deals', 'Search and expand deal cards', 'handshake');
  nav('automation', 'Automation', 'Queue, engine, blueprint designer', 'smart_toy');
  nav('timeline', 'Timeline', 'Activity calendar', 'calendar_month');
  nav('oracle', 'Oracle', 'AI chat workspace', 'chat');
  nav('settings', 'Settings', 'CRM IDs, API keys', 'settings');

  (L.all_deals || []).forEach(d => {
    items.push({
      kind: 'deal',
      icon: 'handshake',
      label: d.name,
      sub: `${d.stage || '—'} · ${fmt$(d.value)}${d.venue ? ` · ${d.venue}` : ''}`,
      hay: dealSearchHaystack(d),
      run() {
        closeCommandPalette();
        openDealWorkspace(d.name);
      },
    });
  });

  (LIVE.needs_attention || []).forEach(x => {
    const name = x.name || x.lead_name || 'Lead';
    items.push({
      kind: 'attention',
      icon: 'priority_high',
      label: `Needs attention: ${name}`,
      sub: (x.reason || x.stage || '').slice(0, 96),
      hay: normText(`${name} ${x.reason || ''} ${x.lead_id || ''} attention`),
      run() {
        closeCommandPalette();
        navigateTo('automation');
        previewAttentionDeal(x, true);
      },
    });
  });

  (LIVE.closing_soon || []).forEach(x => {
    const name = x.name || x.lead_name || 'Deal';
    items.push({
      kind: 'closing',
      icon: 'schedule',
      label: `Closing soon: ${name}`,
      sub: x.stage || '',
      hay: normText(`${name} ${x.close_at || ''} closing soon`),
      run() {
        closeCommandPalette();
        openDealWorkspace(name);
      },
    });
  });

  items.push({
    kind: 'action',
    icon: 'sync',
    label: 'Refresh Close inbox intel',
    sub: 'Tasks + email/SMS triage snapshot',
    hay: normText('refresh inbox close intel sync'),
    run() {
      closeCommandPalette();
      refreshCloseInboxIntel();
    },
  });

  return items;
}

function filterCommandPaletteItems(query) {
  const all = buildCommandPaletteItems();
  const t = normText(query);
  if (!t) return all.slice(0, 55);
  const tokens = t.split(/\s+/).filter(Boolean);
  return all
    .filter(it => {
      const h = normText(`${it.hay || ''} ${it.label} ${it.sub}`);
      return tokens.every(tok => h.includes(tok));
    })
    .slice(0, 45);
}

function renderCommandPaletteList() {
  const list = $('#commandPaletteList');
  const input = $('#commandPaletteInput');
  if (!list || !input) return;
  commandPaletteFiltered = filterCommandPaletteItems(input.value || '');
  if (!commandPaletteFiltered.length) {
    list.innerHTML = '<div class="command-palette-empty">No matches — try another name, view, or action.</div>';
    return;
  }
  commandPaletteActive = Math.min(commandPaletteActive, commandPaletteFiltered.length - 1);
  list.innerHTML = commandPaletteFiltered.map((it, i) => `
    <div class="command-palette-item${i === commandPaletteActive ? ' is-active' : ''}" data-palette-idx="${i}" onclick="runCommandPaletteIndex(${i})">
      <span class="material-symbols-outlined command-palette-item-ico">${it.icon}</span>
      <div style="min-width:0;">
        <div class="command-palette-item-title">${(it.label || '').replace(/</g, '&lt;')}</div>
        ${it.sub ? `<div class="command-palette-item-sub">${(it.sub).replace(/</g, '&lt;')}</div>` : ''}
      </div>
      <span class="command-palette-item-tag">${it.kind}</span>
    </div>
  `).join('');
}

window.runCommandPaletteIndex = function(i) {
  const it = commandPaletteFiltered[i];
  if (it?.run) it.run();
};

function ensureCommandPalette() {
  let el = $('#commandPalette');
  if (el) return el;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div id="commandPalette" class="command-palette-backdrop" data-surface="command-palette-backdrop" style="display:none;" onclick="if(event.target===this)closeCommandPalette()">
      <div class="command-palette" data-surface="command-palette" role="dialog" aria-modal="true" aria-label="Search and jump" onclick="event.stopPropagation()">
        <div class="command-palette-head">
          <span class="material-symbols-outlined">search</span>
          <input id="commandPaletteInput" class="command-palette-input" type="text" placeholder="Deals, views, attention, closing soon, actions…" autocomplete="off" />
          <span class="command-palette-kbd">esc</span>
        </div>
        <div id="commandPaletteList" class="command-palette-list"></div>
      </div>
    </div>`;
  document.body.appendChild(wrap.firstElementChild);
  el = $('#commandPalette');
  const inp = $('#commandPaletteInput');
  inp.addEventListener('input', () => {
    commandPaletteActive = 0;
    renderCommandPaletteList();
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      commandPaletteActive = Math.min(commandPaletteActive + 1, Math.max(0, commandPaletteFiltered.length - 1));
      renderCommandPaletteList();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      commandPaletteActive = Math.max(0, commandPaletteActive - 1);
      renderCommandPaletteList();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runCommandPaletteIndex(commandPaletteActive);
    }
  });
  return el;
}

window.openCommandPalette = function() {
  const el = ensureCommandPalette();
  el.style.display = 'flex';
  const inp = $('#commandPaletteInput');
  if (inp) {
    inp.value = '';
    commandPaletteActive = 0;
    renderCommandPaletteList();
    setTimeout(() => inp.focus(), 30);
  }
};

window.closeCommandPalette = function() {
  const el = $('#commandPalette');
  if (el) el.style.display = 'none';
};

window.toggleCommandPalette = function() {
  const el = $('#commandPalette');
  if (el && el.style.display === 'flex') closeCommandPalette();
  else openCommandPalette();
};

function renderAutomation() {
  const hooks = T.automation_hooks || {};
  const cadences = OC.cadences || [];
  const packets = OC.reality_packets || [];
  const emails = OT.email_templates || [];
  const smss = OT.sms_templates || [];
  const live = LIVE;
  const needsAttention = live.needs_attention || [];
  const closingSoon = live.closing_soon || [];
  const snap = live.pipeline_snapshot || {};
  const automations = AUT.automations || [];
  const recentRuns = (AUT.runs || []).slice(0, 5);
  const outboxPackets = getAutomationOutboxPackets();
  const readySendPackets = getReadySendPackets();
  const criticalPackets = outboxPackets.filter(item => item.type === 'prepare_critical_alert_review');
  const approvedPackets = outboxPackets.filter(item => item.review?.disposition === 'approved');
  const reviewedPackets = outboxPackets.filter(item => item.review?.disposition === 'reviewed');
  const unreviewedPackets = outboxPackets.filter(item => !item.review?.disposition);
  const activeAttentionValue = needsAttention.reduce((sum, item) => sum + (item.value || 0), 0);
  const communicationTargets = (L.high_value_deals || [])
    .filter(d => d.status !== 'won')
    .sort((a, b) => (b.value || 0) - (a.value || 0))
    .slice(0, 4);
  const opsToday = getTodayOps();
  const activeProject = OPS.context?.active_project || 'Comeketo';

  const alerts = live.alerts || [];
  stageScroll.innerHTML = `
    <div class="vh"><span class="label"><span class="material-symbols-outlined">smart_toy</span> Automation</span><h2>Live Action Center</h2><p>${snap.total_active_opportunities || 107} active deals · ${snap.needs_attention_count || 0} need attention · ${cadences.length} cadence protocols</p></div>

    <div class="panel-block panel-accent-gold">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.8rem;">
        <div>
          <h2 style="margin-bottom:0.15rem;"><span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);">visibility</span> Daily Operating Memory</h2>
          <p class="panel-note" style="margin-bottom:0;">Keep the machine honest: what happened, what we learned, what changed, what it touched, whether it helped, and where it's stuck.</p>
        </div>
        <div style="display:flex;gap:0.35rem;flex-wrap:wrap;justify-content:flex-end;">
          <span class="badge gold">${activeProject}</span>
        </div>
      </div>
      <div class="status-strip" style="grid-template-columns:repeat(4,1fr);">
        <div class="status-card"><div class="status-label">Today's Events</div><div class="status-value">${opsToday.metrics?.activity_events || 0}</div></div>
        <div class="status-card"><div class="status-label">Automation</div><div class="status-value">${opsToday.metrics?.automation_events || 0}</div></div>
        <div class="status-card"><div class="status-label">AI</div><div class="status-value">${opsToday.metrics?.ai_events || 0}</div></div>
        <div class="status-card"><div class="status-label">Syncs</div><div class="status-value">${opsToday.metrics?.sync_events || 0}</div></div>
      </div>
      ${opsToday.summary ? `<div class="script-block" style="margin-top:0.8rem;border-left-color:var(--gold);">${opsToday.summary}</div>` : ''}
      <div class="layout-grid-half" style="margin-top:0.8rem;">
        <div>
          <div class="pv-section-label">What's happening</div>
          ${renderOpsList(opsToday.what_happened, 'No daily activity summary yet.')}
          <div class="pv-section-label" style="margin-top:0.6rem;">What we're learning</div>
          ${renderOpsList(opsToday.what_we_learned, 'No learning notes captured yet.')}
          <div class="pv-section-label" style="margin-top:0.6rem;">What we're adding</div>
          ${renderOpsList(opsToday.what_we_added, 'No implementation notes captured yet.')}
        </div>
        <div>
          <div class="pv-section-label">What it affects</div>
          ${renderOpsList(opsToday.what_it_affected, 'No impact notes captured yet.')}
          <div class="pv-section-label" style="margin-top:0.6rem;">Is it helping?</div>
          ${renderOpsList(opsToday.help_signals, 'No help signals logged yet.')}
          <div class="pv-section-label" style="margin-top:0.6rem;">Bottlenecks</div>
          ${renderOpsList(opsToday.bottlenecks, 'No bottlenecks logged yet.')}
        </div>
      </div>
      <div class="composer-grid" style="margin-top:0.8rem;">
        <label class="composer-field">
          <span class="composer-label">Today summary</span>
          <input id="opsSummaryInput" class="settings-input" value="${(opsToday.summary || '').replace(/"/g, '&quot;')}" placeholder="What changed today overall?" />
        </label>
        <label class="composer-field">
          <span class="composer-label">Learning</span>
          <input id="opsLearningInput" class="settings-input" placeholder="What are we learning?" />
        </label>
        <label class="composer-field">
          <span class="composer-label">Added</span>
          <input id="opsAddedInput" class="settings-input" placeholder="What did we add?" />
        </label>
        <label class="composer-field">
          <span class="composer-label">Affected</span>
          <input id="opsAffectedInput" class="settings-input" placeholder="What is it affecting?" />
        </label>
        <label class="composer-field">
          <span class="composer-label">Helping?</span>
          <input id="opsHelpingInput" class="settings-input" placeholder="Is it helping at all?" />
        </label>
        <label class="composer-field">
          <span class="composer-label">Bottleneck</span>
          <input id="opsBottleneckInput" class="settings-input" placeholder="What's blocked or messy?" />
        </label>
      </div>
      <div class="preview-action-row">
        <button class="preview-action-btn gold" onclick="saveOpsNoteFromUI()"><span class="material-symbols-outlined">save</span>Save daily note</button>
        <button class="preview-action-btn" onclick="navigateTo('timeline')"><span class="material-symbols-outlined">calendar_month</span>Open timeline</button>
      </div>
    </div>

    <div class="operator-brief-grid">
      <div class="operator-brief-card">
        <div class="operator-brief-label">Money In Attention</div>
        <div class="operator-brief-value">${fmt$(activeAttentionValue)}</div>
        <div class="operator-brief-sub">${needsAttention.length} flagged opportunities currently need human touch</div>
      </div>
      <div class="operator-brief-card">
        <div class="operator-brief-label">Packets Waiting</div>
        <div class="operator-brief-value">${unreviewedPackets.length}</div>
        <div class="operator-brief-sub">${criticalPackets.length} critical packet${criticalPackets.length === 1 ? '' : 's'} and ${outboxPackets.length - criticalPackets.length} follow-up draft packet${outboxPackets.length - criticalPackets.length === 1 ? '' : 's'}</div>
      </div>
      <div class="operator-brief-card">
        <div class="operator-brief-label">Reviewed Today</div>
        <div class="operator-brief-value">${approvedPackets.length + reviewedPackets.length}</div>
        <div class="operator-brief-sub">${approvedPackets.length} approved · ${reviewedPackets.length} marked reviewed in the current outbox window</div>
      </div>
    </div>

    ${renderAutomationBlueprintPanel()}

    <div class="panel-block" style="border-color:rgba(74,158,104,0.28);background:linear-gradient(180deg, rgba(14,20,15,0.96), rgba(10,12,10,0.98));">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.8rem;">
        <h2 style="margin-bottom:0;"><span class="material-symbols-outlined" style="font-size:1rem;color:var(--green);">mark_email_read</span> Ready To Send</h2>
        <span class="badge ready">${readySendPackets.length} approved packet${readySendPackets.length === 1 ? '' : 's'}</span>
      </div>
      <p class="panel-note">Approved packets live here until they turn into real outbound work or resolved exceptions. This is the fast lane from automation into action.</p>
      ${readySendPackets.length ? `
        <div class="outbox-grid">
          ${readySendPackets.map(packet => {
            const result = packet.result || {};
            const title = result.lead_name || packet.payload?.name || 'Approved packet';
            const deal = findDealLike(packet.payload?.lead_id, packet.payload?.name || result.lead_name);
            const plan = deal ? buildDealCommsPlan(deal) : null;
            const isCritical = packet.type === 'prepare_critical_alert_review';
            return `
              <div class="send-card ${isCritical ? 'critical' : ''}" onmouseenter="previewAutomationPacket(${esc(packet)})" onmouseleave="clearPreview()" onclick="previewAutomationPacket(${esc(packet)}, true)">
                <div class="send-card-head">
                  <div>
                    <div class="outbox-card-title">${title}</div>
                    <div class="outbox-card-sub">${packet.next_step?.label || (isCritical ? 'Resolve exception' : 'Draft outbound')}</div>
                  </div>
                  ${packetDispositionBadge(packet.review)}
                </div>
                <div class="send-card-body">
                  ${isCritical
                    ? (result.action_required || result.draft_note || 'Resolve this exception in Close.')
                    : `${plan ? `<strong>${plan.channel}</strong> · ${plan.objective}` : 'Draft the next outbound touch.'}<br>${result.draft_note || ''}`
                  }
                </div>
                <div class="outbox-card-meta">
                  ${plan?.channel ? badge(plan.channel) : ''}
                  ${plan?.tone ? badge(plan.tone) : ''}
                  ${result.related_value ? badge(fmt$(result.related_value), 'won') : ''}
                </div>
                <div class="outbox-card-actions" onclick="event.stopPropagation()">
                  ${deal ? `<button class="preview-action-btn gold" onclick="aiDraftFollowup(${esc(deal)})"><span class="material-symbols-outlined">edit_note</span>Draft now</button>` : ''}
                  ${deal ? `<button class="preview-action-btn" onclick="openDealWorkspace('${String(deal.name).replace(/'/g, "\\'")}')"><span class="material-symbols-outlined">sell</span>Open deal</button>` : ''}
                  <button class="preview-action-btn" onclick="reviewAutomationPacket('${packet.id}','archived')"><span class="material-symbols-outlined">done</span>Clear</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      ` : `<div class="preview-empty" style="height:5rem;"><span class="material-symbols-outlined">send</span><p>No approved packets waiting to send</p></div>`}
    </div>

    <div class="panel-block panel-accent-gold">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.8rem;">
        <h2 style="margin-bottom:0;"><span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);">routine</span> Automation Engine</h2>
        <span class="badge gold">${automations.length} live loops</span>
      </div>
      <p class="panel-note">Recurring server-side automations now keep this system moving all day: Close sync pulses, follow-up sweeps, cadence watches, and brief refreshes.</p>
      <div class="automation-runtime-grid">
        ${automations.map(a => `
          <div class="automation-runtime-card">
            <div class="automation-runtime-top">
              <div>
                <div class="automation-runtime-title">${a.name}</div>
                <div class="automation-runtime-sub">Every ${a.interval_minutes} min · ${a.last_run ? 'Last run ' + new Date(a.last_run).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }) : 'Not run yet'}</div>
              </div>
              ${badge(a.last_status || 'idle', a.last_status === 'ok' ? 'won' : a.last_status === 'error' ? 'urgent' : '')}
            </div>
            <div class="automation-runtime-body">${a.last_summary || 'Standing by'}</div>
            <div class="preview-action-row">
              <button class="preview-action-btn gold" onclick="runAutomationNow('${a.id}')"><span class="material-symbols-outlined">play_arrow</span>Run now</button>
            </div>
          </div>
        `).join('')}
      </div>
      ${recentRuns.length ? `<div style="margin-top:0.9rem;"><div class="pv-section-label">Recent automation activity</div><div class="automation-run-log">${recentRuns.map(run => `<div class="automation-run-item"><span>${run.id.replace(/_/g,' ')}</span><span>${run.summary}</span><span>${new Date(run.at).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' })}</span></div>`).join('')}</div></div>` : ''}
    </div>

    ${alerts.length ? `
    <div style="background:rgba(201,168,76,0.04);border:1.5px solid rgba(201,168,76,0.25);border-radius:var(--radius-lg);padding:1rem 1.2rem;margin-bottom:1.2rem;animation:fadeIn 300ms ease;">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.6rem;">
        <span class="material-symbols-outlined" style="color:var(--rose);font-size:1.1rem;">warning</span>
        <span style="font-family:'Fraunces',serif;font-weight:800;font-size:0.95rem;color:var(--maroon-deep);"><span class="material-symbols-outlined" style="font-size:1rem;color:var(--coral);">warning</span> Critical Alerts — Detected by Automation</span>
      </div>
      ${alerts.map(a => `
        <div style="background:rgba(30,28,24,0.7);border-radius:var(--radius-md);padding:0.8rem;border-left:4px solid var(--rose);">
          <div style="display:flex;justify-content:space-between;align-items:start;">
            <div>
              <div style="font-weight:700;font-size:0.82rem;color:var(--maroon-deep);">${a.name} · ${fmt$(a.value)}</div>
              <div style="font-size:0.72rem;color:var(--rose);margin-top:0.2rem;font-weight:600;">${a.message}</div>
              <div style="font-size:0.68rem;color:var(--burgundy);opacity:0.7;margin-top:0.3rem;">Action required: ${a.action_required}</div>
              <div class="preview-action-row" style="margin-top:0.65rem;">
                <button class="preview-action-btn gold" onclick="queueCriticalAlertReview('${a.lead_id || ''}','${a.name.replace(/'/g,'')}')"><span class="material-symbols-outlined">assignment_late</span>Build review packet</button>
              </div>
            </div>
            ${badge('CRITICAL', 'urgent')}
          </div>
        </div>
      `).join('')}
    </div>
    ` : ''}

    <!-- ══ LIVE CRM SNAPSHOT ══ -->
    <div class="panel-block" style="border-color:var(--rose);background:linear-gradient(to bottom, #141414, rgba(201,168,76,0.03));">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.8rem;">
        <h2 style="margin-bottom:0;"><span class="material-symbols-outlined" style="font-size:0.8rem;color:var(--coral);">circle</span> Live Close CRM Snapshot</h2>
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <span id="liveDataAge" style="font-size:0.6rem;color:var(--burgundy);opacity:0.4;">${live._meta?.last_synced ? 'Synced ' + new Date(live._meta.last_synced).toLocaleString() : 'Not synced'}</span>
          <button onclick="requestSync()" style="padding:0.3rem 0.8rem;border-radius:9999px;border:1.5px solid #C9A84C;background:transparent;color:#C9A84C;font-size:0.62rem;font-weight:700;cursor:pointer;font-family:inherit;"><span class="material-symbols-outlined" style="font-size:0.8rem;">refresh</span> Sync Now</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;margin-bottom:1rem;">
        <div class="status-card"><div class="status-label">Active Deals</div><div class="status-value" style="font-family:'Fraunces',serif;font-weight:900;font-size:1.5rem;color:var(--rose);">${snap.total_active_opportunities || '107'}</div></div>
        <div class="status-card"><div class="status-label">Needs Attention</div><div class="status-value" style="font-family:'Fraunces',serif;font-weight:900;font-size:1.5rem;color:var(--amber);">${snap.needs_attention_count || needsAttention.length}</div></div>
        <div class="status-card"><div class="status-label">Closing This Week</div><div class="status-value" style="font-family:'Fraunces',serif;font-weight:900;font-size:1.5rem;color:var(--coral);">${snap.closing_this_week || closingSoon.length}</div></div>
        <div class="status-card"><div class="status-label">Top Deal</div><div class="status-value" style="font-family:'Fraunces',serif;font-weight:800;font-size:0.85rem;color:var(--green);">${fmt$(snap.top_deal_value)}</div></div>
      </div>

      ${closingSoon.length ? `
        <div style="margin-bottom:0.8rem;">
          <div class="pv-section-label" style="color:var(--rose);"><span class="material-symbols-outlined" style="font-size:1rem;color:var(--coral);">warning</span> Closing in &lt;7 Days — Act Now</div>
          ${closingSoon.map(d => `
            <div class="q-item" style="margin-top:0.4rem;border-color:rgba(201,168,76,0.3);">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div><div class="q-item-title">${d.name}</div><div class="q-item-sub">${d.stage} · ${d.days_until_close} days · ${d.note}</div></div>
                <div style="display:flex;flex-direction:column;gap:0.3rem;align-items:flex-end;">
                  <div style="font-family:'Fraunces',serif;font-weight:800;color:var(--green);">${fmt$(d.value)}</div>
                  <button onclick="queueFollowUp('${d.lead_id}','${d.name.replace(/'/g,'')}')" style="padding:0.25rem 0.7rem;border-radius:9999px;border:none;background:#C9A84C;color:#0C0C0C;font-size:0.6rem;font-weight:700;cursor:pointer;font-family:inherit;">Draft Follow-up →</button>
                  <button class="ai-btn" style="border-color:rgba(74,158,104,0.3);color:var(--green);" onclick="aiDraftFollowup({name:'${d.name.replace(/'/g,'')}',value:${d.value||0},stage:'${(d.stage||'').replace(/'/g,'')}',event:'',venue:'',guests:'',confidence:0,risk:[]})"><span class="material-symbols-outlined">smart_toy</span> AI Draft</button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div class="pv-section-label" style="margin-bottom:0.4rem;"><span class="material-symbols-outlined" style="font-size:1rem;color:var(--coral);">error</span> Needs Attention</div>
      <div style="display:grid;gap:0.4rem;">
        ${needsAttention.map(d => `
          <div class="q-item" onmouseenter="previewAttentionDeal(${esc(d)})" onmouseleave="clearPreview()" onclick="previewAttentionDeal(${esc(d)}, true)" style="cursor:pointer;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div style="flex:1;">
                <div style="display:flex;align-items:center;gap:0.4rem;">
                  <div class="q-item-title" style="font-size:0.78rem;">${d.name}</div>
                  ${badge(d.urgency, d.urgency === 'urgent' ? 'urgent' : d.urgency === 'high' ? 'high' : 'medium')}
                </div>
                <div class="q-item-sub" style="font-size:0.65rem;">${d.reason}</div>
                <div class="q-item-meta">${badge(d.stage.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2B1C}\u{1F532}\u{2B1B}⬜🔲💲]/gu,'').trim())}</div>
              </div>
              <div style="display:flex;flex-direction:column;gap:0.3rem;align-items:flex-end;margin-left:0.8rem;">
                ${d.value ? `<div style="font-family:'Fraunces',serif;font-weight:800;font-size:0.88rem;color:var(--green);">${fmt$(d.value)}</div>` : ''}
                <div style="display:flex;gap:0.3rem;flex-wrap:wrap;">
                  <button onclick="queueFollowUp('${d.lead_id}','${d.name.replace(/'/g,'')}')" style="padding:0.2rem 0.55rem;border-radius:9999px;border:1.5px solid #C9A84C;background:transparent;color:#C9A84C;font-size:0.58rem;font-weight:700;cursor:pointer;font-family:inherit;">Follow-up</button>
                  <button onclick="queueTask('${d.lead_id}','${d.name.replace(/'/g,'')}')" style="padding:0.2rem 0.55rem;border-radius:9999px;border:1.5px solid var(--purple);background:transparent;color:var(--purple);font-size:0.58rem;font-weight:700;cursor:pointer;font-family:inherit;">Task</button>
                  <button class="ai-btn" onclick="aiAnalyzeDeal({name:'${d.name.replace(/'/g,'')}',value:${d.value||0},stage:'${(d.stage||'').replace(/'/g,'')}',event:'',venue:'',guests:'',confidence:0,risk:[]})"><span class="material-symbols-outlined">analytics</span> AI</button>
                  <button class="ai-btn" onclick="aiStalledRecovery({name:'${d.name.replace(/'/g,'')}',value:${d.value||0},stage:'${(d.stage||'').replace(/'/g,'')}',event:'',venue:'',guests:'',confidence:0,risk:['${d.urgency}']})"><span class="material-symbols-outlined">restart_alt</span> Recover</button>
                </div>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- ══ ACTION QUEUE ══ -->
    <div class="panel-block" style="border-color:var(--gold);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.8rem;">
        <h2 style="margin-bottom:0;"><span class="material-symbols-outlined" style="font-size:1rem;color:var(--amber);">bolt</span> Action Queue</h2>
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <span id="queueStatus" style="font-size:0.62rem;font-weight:600;color:var(--burgundy);opacity:0.5;"></span>
          <button onclick="refreshQueueView()" style="padding:0.3rem 0.8rem;border-radius:9999px;border:1.5px solid #C9A84C;background:transparent;color:#C9A84C;font-size:0.62rem;font-weight:700;cursor:pointer;font-family:inherit;"><span class="material-symbols-outlined" style="font-size:0.8rem;">refresh</span> Refresh</button>
        </div>
      </div>
      <p class="panel-note">Actions queued here are processed by Claude during the next automation run (or on-demand). Claude uses Close CRM MCP to execute them.</p>
      <div id="queuePanel">
        ${renderQueueHTML()}
      </div>
      <div style="display:flex;gap:0.5rem;margin-top:0.8rem;flex-wrap:wrap;">
        <button onclick="queueMorningBrief()" style="padding:0.4rem 1rem;border-radius:9999px;border:none;background:#C9A84C;color:#0C0C0C;font-size:0.68rem;font-weight:700;cursor:pointer;font-family:inherit;"><span class="material-symbols-outlined" style="font-size:0.8rem;">light_mode</span> Queue Morning Brief</button>
        <button onclick="queueCadenceCheck()" style="padding:0.4rem 1rem;border-radius:9999px;border:none;background:#C9A84C;color:#0C0C0C;font-size:0.68rem;font-weight:700;cursor:pointer;font-family:inherit;"><span class="material-symbols-outlined" style="font-size:0.8rem;">sync</span> Check Cadences Due</button>
        <button onclick="queuePipelineSync()" style="padding:0.4rem 1rem;border-radius:9999px;border:1.5px solid #C9A84C;background:transparent;color:#C9A84C;font-size:0.68rem;font-weight:700;cursor:pointer;font-family:inherit;"><span class="material-symbols-outlined" style="font-size:0.8rem;">bar_chart</span> Sync Pipeline Data</button>
      </div>
    </div>

    <div class="panel-block panel-accent-gold">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.8rem;">
        <h2 style="margin-bottom:0;"><span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);">outbox</span> Automation Outbox</h2>
        <div style="display:flex;gap:0.45rem;align-items:center;">
          <span class="badge gold">${outboxPackets.length} recent packets</span>
          ${criticalPackets.length ? `<span class="badge urgent">${criticalPackets.length} critical</span>` : ''}
        </div>
      </div>
      <p class="panel-note">This is the machine's working memory: follow-up draft packets and exception reviews prepared for Andre throughout the day. Click any packet to inspect it, pin it, or jump into deal work.</p>
      ${outboxPackets.length ? `
        <div class="outbox-grid">
          ${outboxPackets.map(packet => {
            const result = packet.result || {};
            const title = result.lead_name || packet.payload?.name || 'Automation packet';
            const isCritical = packet.type === 'prepare_critical_alert_review';
            return `
              <div class="outbox-card ${isCritical ? 'critical' : ''}" onmouseenter="previewAutomationPacket(${esc(packet)})" onmouseleave="clearPreview()" onclick="previewAutomationPacket(${esc(packet)}, true)">
                <div class="outbox-card-head">
                  <div>
                    <div class="outbox-card-title">${title}</div>
                    <div class="outbox-card-sub">${isCritical ? 'Critical exception review' : 'Follow-up packet'} · ${new Date(packet.completed_at || packet.queued_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
                  </div>
                  <div style="display:flex;gap:0.3rem;flex-wrap:wrap;justify-content:flex-end;">
                    ${badge(isCritical ? 'critical' : 'ready', isCritical ? 'urgent' : 'ready')}
                    ${packetDispositionBadge(packet.review)}
                  </div>
                </div>
                <div class="outbox-card-body">${result.draft_note || result.message || 'Packet ready for review.'}</div>
                <div class="outbox-card-meta">
                  ${result.related_stage ? badge(result.related_stage.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2B1C}\u{1F532}\u{2B1B}⬜🔲💲]/gu,'').trim()) : ''}
                  ${result.related_value ? badge(fmt$(result.related_value), 'won') : ''}
                  ${packet.source === 'automation_engine' ? badge('auto', 'gold') : ''}
                </div>
                <div class="outbox-card-actions" onclick="event.stopPropagation()">
                  <button class="preview-action-btn" onclick="reviewAutomationPacket('${packet.id}','approved')"><span class="material-symbols-outlined">done_all</span>Approve</button>
                  <button class="preview-action-btn" onclick="reviewAutomationPacket('${packet.id}','archived')"><span class="material-symbols-outlined">inventory_2</span>Archive</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      ` : `<div class="preview-empty" style="height:5rem;"><span class="material-symbols-outlined">outbox</span><p>No automation packets yet</p></div>`}
    </div>

    <div class="panel-block panel-accent-gold">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.8rem;">
        <h2 style="margin-bottom:0;"><span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);">campaign</span> Communication Command Deck</h2>
        <span class="badge gold">${communicationTargets.length} live outreach priorities</span>
      </div>
      <p class="panel-note">Stage-aware communication plans built from deal state, risk, and Andre's actual message lanes. This is the operational bridge between CRM, templates, and AI drafting.</p>
      <div class="comms-grid">
        ${communicationTargets.map(d => {
          const plan = buildDealCommsPlan(d);
          const lid = d.lead_id || resolveLeadIdForDeal(d);
          return `
            <div class="comms-card" onmouseenter="previewCommsPlan(${esc(d)})" onmouseleave="clearPreview()" onclick="previewCommsPlan(${esc(d)}, true)">
              <div class="comms-card-head">
                <div>
                  <div class="comms-card-title">${d.name}</div>
                  <div class="comms-card-sub">${d.stage} · ${d.event || 'Event TBD'}</div>
                </div>
                <div class="comms-card-value">${fmt$(d.value)}</div>
              </div>
              <div class="comms-card-meta">
                ${badge(plan.urgency + ' outreach', plan.urgency)}
                ${badge(plan.channel)}
              </div>
              <div class="comms-card-body">
                <div class="comms-line"><strong>Objective:</strong> ${plan.objective}</div>
                <div class="comms-line"><strong>Tone:</strong> ${plan.tone}</div>
                ${plan.packet ? `<div class="comms-line"><strong>Oracle lane:</strong> ${plan.packet.name}</div>` : ''}
                <div class="comms-line"><strong>Email:</strong> ${plan.email?.name || 'No email template'}</div>
                <div class="comms-line"><strong>SMS:</strong> ${plan.sms?.name || 'No SMS template'}</div>
              </div>
              <div class="preview-action-row" onclick="event.stopPropagation()">
                ${lid ? `<button type="button" class="preview-action-btn" onclick='openCloseCompose("email","${lid}",${JSON.stringify(d.name)})'><span class="material-symbols-outlined">mail</span>Close email</button>` : ''}
                ${lid ? `<button type="button" class="preview-action-btn" onclick='openCloseCompose("sms","${lid}",${JSON.stringify(d.name)})'><span class="material-symbols-outlined">sms</span>Close SMS</button>` : ''}
                <button class="preview-action-btn gold" onclick="aiDraftFollowup(${esc(d)})"><span class="material-symbols-outlined">edit_note</span>Draft</button>
                <button class="preview-action-btn" onclick="previewCommsPlan(${esc(d)}, true)"><span class="material-symbols-outlined">visibility</span>Plan</button>
                <button class="preview-action-btn" onclick="openDealWorkspace('${d.name.replace(/'/g, "\\'")}')"><span class="material-symbols-outlined">arrow_outward</span>Open</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- ══ SMART MESSAGE DRAFTER ══ -->
    <div class="panel-block"><h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--cyan);">mail</span> Smart Message Drafter</h2>
      <p class="panel-note">Click any template to preview it in the detail panel. Hit "Queue Draft" to have Claude draft a personalized version for a specific lead.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.8rem;">
        <div><div class="pv-section-label">Email Templates</div>${emails.map(e => `<div class="q-item" style="cursor:pointer;margin-top:0.3rem;" onclick="previewTemplate('email','${e.id}')">
          <div style="font-weight:700;font-size:0.72rem;color:var(--maroon-deep);">${e.name}</div>
          <div style="font-size:0.62rem;color:var(--burgundy);opacity:0.5;">Subject: ${e.subject}</div>
          ${e.day ? '<div style="margin-top:0.2rem;">'+badge('Day '+e.day)+' '+badge(e.cadence.replace(/_/g,' '))+'</div>' : ''}
        </div>`).join('')}</div>
        <div><div class="pv-section-label">SMS Templates</div>${smss.map(s => `<div class="q-item" style="cursor:pointer;margin-top:0.3rem;" onclick="previewTemplate('sms','${s.id}')">
          <div style="font-weight:700;font-size:0.72rem;color:var(--maroon-deep);">${s.name}</div>
          <div style="font-size:0.62rem;color:var(--burgundy);opacity:0.5;">${s.body.substring(0,60)}...</div>
          ${s.day ? '<div style="margin-top:0.2rem;">'+badge('Day '+s.day)+' '+badge(s.cadence.replace(/_/g,' '))+'</div>' : ''}
        </div>`).join('')}</div>
      </div>
    </div>

    <!-- ══ CADENCE ENGINE ══ -->
    <div class="panel-block"><h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--amber);">sync</span> Cadence Engine</h2><p class="panel-note">${cadences.length} cadence protocols loaded from Oracle doctrine.</p>
      <div style="display:grid;gap:0.6rem;">
        ${cadences.map(c => `<div class="gap-card" style="margin-bottom:0;">
          <div class="gap-card-header"><div class="gap-card-title">${c.name}</div>${badge(c.type.replace(/_/g,' '))}</div>
          <div style="display:grid;gap:0.3rem;margin-top:0.5rem;">
            ${c.days.map(d => `<div style="display:flex;gap:0.6rem;padding:0.4rem 0;border-bottom:1px solid rgba(201,168,76,0.04);">
              <div style="min-width:3rem;font-family:'Fraunces',serif;font-weight:800;font-size:0.82rem;color:var(--rose);">Day ${d.day}</div>
              <div style="flex:1;"><div style="font-size:0.68rem;color:var(--maroon-deep);">${d.actions.join(' · ')}</div><div style="font-size:0.6rem;color:var(--burgundy);opacity:0.4;margin-top:0.1rem;">${d.tone}</div></div>
            </div>`).join('')}
          </div>
          ${c.rules?.length ? '<div style="margin-top:0.5rem;">'+c.rules.map(r => '<div style="font-size:0.62rem;color:var(--amber);"><span class="material-symbols-outlined" style="font-size:0.6rem;color:var(--amber);">bolt</span> '+r+'</div>').join('')+'</div>' : ''}
        </div>`).join('')}
      </div>
    </div>

    <!-- ══ REALITY-BACKED MESSAGE LANES ══ -->
    <div class="panel-block"><h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--green);">cell_tower</span> Reality-Backed Message Lanes</h2><p class="panel-note">6 message lanes extracted from 2,032 real sent messages. Andre's evidence hits shown.</p>
      <div style="display:grid;gap:0.5rem;">
        ${packets.map(p => `<div class="auto-card">
          <div class="auto-icon" style="background:${p.priority === 'high' ? 'rgba(107,191,150,0.1)' : 'rgba(168,216,234,0.1)'};"><span class="material-symbols-outlined" style="color:${p.priority === 'high' ? 'var(--green)' : 'var(--cyan)'};">send</span></div>
          <div style="flex:1;"><div class="auto-card-title">${p.name}</div><div class="auto-card-desc">Use when: ${p.use_when}</div><div class="auto-card-desc" style="color:var(--coral);">Avoid when: ${p.avoid_when}</div></div>
          <div style="text-align:right;">${badge(p.evidence_hits + ' hits', 'won')}<br>${p.andre_hits ? badge('Andre: ' + p.andre_hits, 'gold') : ''}</div>
        </div>`).join('')}
      </div>
    </div>
  `;
  loadAutomationCatalog().then(() => {
    if (currentView === 'automation') blueprintHydrateSelectAndSteps();
  });
}

window.previewTemplate = function(type, id) {
  const list = type === 'email' ? (OT.email_templates || []) : (OT.sms_templates || []);
  const t = list.find(x => x.id === id);
  if (!t) return;
  setPreview(`<div class="pv-title">${t.name}</div><div class="pv-sub">${type.toUpperCase()} Template</div><div class="pv-divider"></div>${t.subject ? '<div class="pv-field"><span class="pv-field-label">Subject</span><span class="pv-field-value">'+t.subject+'</span></div>' : ''}${t.day ? '<div class="pv-field"><span class="pv-field-label">Cadence Day</span><span class="pv-field-value">Day '+t.day+'</span></div>' : ''}<div class="pv-divider"></div><div class="pv-section-label">Message Body</div><div class="script-block" style="white-space:pre-wrap;font-style:normal;">${t.body}</div>`);
};

window.previewAttentionDeal = function(d, pin) {
  if (typeof d === 'string') d = JSON.parse(d);
  setPreview(`
    <div class="pv-title">${d.name}</div>
    <div class="pv-sub">Needs Attention</div>
    <div class="pv-divider"></div>
    <div class="pv-field"><span class="pv-field-label">Stage</span><span class="pv-field-value">${d.stage}</span></div>
    <div class="pv-field"><span class="pv-field-label">Value</span><span class="pv-field-value" style="color:var(--green)">${fmt$(d.value)}</span></div>
    <div class="pv-field"><span class="pv-field-label">Confidence</span><span class="pv-field-value">${d.confidence}%</span></div>
    <div class="pv-field"><span class="pv-field-label">Urgency</span><span class="pv-field-value">${badge(d.urgency, d.urgency === 'urgent' ? 'urgent' : d.urgency === 'high' ? 'high' : 'medium')}</span></div>
    <div class="pv-divider"></div>
    <div class="pv-section-label">Why it needs attention</div>
    <p style="font-size:0.73rem;line-height:1.5;color:var(--maroon);opacity:0.7;">${d.reason}</p>
    <div class="pv-divider"></div>
    <div style="display:flex;flex-direction:column;gap:0.4rem;">
      <button onclick="queueFollowUp('${d.lead_id}','${d.name.replace(/'/g,'')}')" style="padding:0.4rem;border-radius:0.5rem;border:none;background:#C9A84C;color:#0C0C0C;font-size:0.68rem;font-weight:700;cursor:pointer;font-family:inherit;width:100%;">Draft Follow-up in Close CRM</button>
      <button type="button" onclick='openCloseCompose("email","${d.lead_id}",${JSON.stringify(d.name)})' style="padding:0.4rem;border-radius:0.5rem;border:1.5px solid rgba(201,168,76,0.45);background:rgba(201,168,76,0.08);color:#C9A84C;font-size:0.68rem;font-weight:700;cursor:pointer;font-family:inherit;width:100%;">Send email (Close)</button>
      <button type="button" onclick='openCloseCompose("sms","${d.lead_id}",${JSON.stringify(d.name)})' style="padding:0.4rem;border-radius:0.5rem;border:1.5px solid rgba(168,216,234,0.35);background:rgba(168,216,234,0.06);color:var(--cyan);font-size:0.68rem;font-weight:700;cursor:pointer;font-family:inherit;width:100%;">Send SMS (Close)</button>
      <button type="button" onclick='openCloseTask("${d.lead_id}",${JSON.stringify(d.name)},"")' style="padding:0.4rem;border-radius:0.5rem;border:1.5px solid rgba(201,168,76,0.35);background:rgba(201,168,76,0.08);color:var(--gold);font-size:0.68rem;font-weight:700;cursor:pointer;font-family:inherit;width:100%;">Task in Close</button>
      <button onclick="queueTask('${d.lead_id}','${d.name.replace(/'/g,'')}')" style="padding:0.4rem;border-radius:0.5rem;border:1.5px solid var(--purple);background:transparent;color:var(--purple);font-size:0.68rem;font-weight:700;cursor:pointer;font-family:inherit;width:100%;">Create ClickUp Task</button>
    </div>
  `, pin);
};

// ─── Action Queue Helpers ─────────────────────────────
function queueAgeMinutes(item) {
  const ts = item?.queued_at || item?.completed_at;
  if (!ts) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 60000));
}

function findDealLike(leadId, name) {
  return (LIVE.needs_attention || []).find(item => item.lead_id === leadId)
    || (LIVE.closing_soon || []).find(item => item.lead_id === leadId)
    || findDealByName(name)
    || null;
}

/** Match static pipeline deal to a live Close lead_id when possible. */
function resolveLeadIdForDeal(d) {
  if (!d) return '';
  if (d.lead_id) return d.lead_id;
  const hit =
    (LIVE.needs_attention || []).find(x => x.name === d.name) ||
    (LIVE.closing_soon || []).find(x => x.name === d.name) ||
    (LIVE.top_opportunities || []).find(x => x.name === d.name);
  return hit?.lead_id || '';
}

async function refreshActivityFromServer() {
  try {
    const r = await fetch(`${SERVER}/activity`, { cache: 'no-store' });
    if (r.ok) ACT = await r.json();
    if (currentView === 'timeline') renderTimeline();
  } catch (_) { /* ignore */ }
}

async function postCloseOutbound(path, payload) {
  const r = await fetch(`${SERVER}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Close request failed (${r.status})`);
  return data;
}

function ensureCloseComposeModal() {
  let modal = $('#closeComposeModal');
  if (modal) return modal;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div id="closeComposeModal" style="display:none;position:fixed;inset:0;z-index:10000;align-items:center;justify-content:center;background:rgba(0,0,0,0.75);backdrop-filter:blur(6px);padding:1rem;">
      <div style="width:100%;max-width:26rem;max-height:90vh;overflow:auto;background:#141414;border:1.5px solid rgba(201,168,76,0.25);border-radius:1rem;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
        <div style="padding:1rem 1.2rem;border-bottom:1px solid rgba(201,168,76,0.1);display:flex;justify-content:space-between;align-items:start;gap:0.75rem;">
          <div>
            <div id="ccmTitle" style="font-family:'Fraunces',serif;font-weight:700;font-size:0.95rem;color:var(--maroon-deep);">Close</div>
            <div id="ccmSub" style="font-size:0.68rem;color:var(--burgundy);opacity:0.75;margin-top:0.25rem;"></div>
          </div>
          <button type="button" onclick="document.getElementById('closeComposeModal').style.display='none'" style="background:none;border:none;color:var(--burgundy);cursor:pointer;opacity:0.5;padding:0.2rem;"><span class="material-symbols-outlined" style="font-size:1.1rem;">close</span></button>
        </div>
        <div style="padding:1rem 1.2rem 1.2rem;">
          <div id="ccmHint" style="font-size:0.62rem;color:rgba(201,168,76,0.45);margin-bottom:0.75rem;line-height:1.4;"></div>
          <label class="composer-field" style="display:block;margin-bottom:0.75rem;">
            <span class="composer-label">Contact</span>
            <select id="ccmContactSelect" class="composer-select"></select>
          </label>
          <div id="ccmEmailForm" style="display:none;">
            <label class="composer-field" style="display:block;margin-bottom:0.6rem;">
              <span class="composer-label">To (email)</span>
              <input id="ccmTo" class="settings-input" type="email" placeholder="buyer@example.com" style="width:100%;box-sizing:border-box;" />
            </label>
            <label class="composer-field" style="display:block;margin-bottom:0.6rem;">
              <span class="composer-label">Subject</span>
              <input id="ccmSubject" class="settings-input" type="text" placeholder="Subject" style="width:100%;box-sizing:border-box;" />
            </label>
            <label class="composer-field" style="display:block;margin-bottom:0.75rem;">
              <span class="composer-label">Body</span>
              <textarea id="ccmBody" rows="8" class="settings-input" placeholder="Message…" style="width:100%;box-sizing:border-box;resize:vertical;min-height:7rem;font-family:inherit;"></textarea>
            </label>
          </div>
          <div id="ccmSmsForm" style="display:none;">
            <label class="composer-field" style="display:block;margin-bottom:0.6rem;">
              <span class="composer-label">Their mobile (E.164)</span>
              <input id="ccmRemotePhone" class="settings-input" type="tel" placeholder="+15551234567" style="width:100%;box-sizing:border-box;" />
            </label>
            <label class="composer-field" style="display:block;margin-bottom:0.75rem;">
              <span class="composer-label">Message</span>
              <textarea id="ccmSmsText" rows="5" class="settings-input" placeholder="SMS text…" style="width:100%;box-sizing:border-box;resize:vertical;font-family:inherit;"></textarea>
            </label>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:0.45rem;margin-top:0.5rem;">
            <button type="button" class="preview-action-btn" onclick="submitCloseCompose('draft')"><span class="material-symbols-outlined">drafts</span>Save draft</button>
            <button type="button" class="preview-action-btn gold" onclick="submitCloseCompose('outbox')"><span class="material-symbols-outlined">send</span>Send now</button>
          </div>
          <p style="font-size:0.58rem;color:var(--burgundy);opacity:0.5;margin-top:0.75rem;line-height:1.45;">Creates a Close activity (logged on the lead). Send now uses status outbox per Close API. Configure Messaging “from” addresses in Settings.</p>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap.firstElementChild);
  return $('#closeComposeModal');
}

function fillCloseComposeContactOptions(lead, mode) {
  const sel = $('#ccmContactSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Optional: pick contact —</option>';
  (lead.contacts || []).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id || '';
    const emails = c.emails || [];
    const phones = c.phones || [];
    const email = emails[0]?.email || emails[0] || '';
    const phone = phones[0]?.phone || phones[0] || '';
    opt.dataset.email = typeof email === 'string' ? email : (email?.email || '');
    opt.dataset.phone = typeof phone === 'string' ? phone : (phone?.phone || '');
    const label = c.name || c.display_name || c.title || 'Contact';
    opt.textContent = `${label}${opt.dataset.email ? ' · ' + opt.dataset.email : ''}${opt.dataset.phone ? ' · ' + opt.dataset.phone : ''}`;
    sel.appendChild(opt);
  });
  sel.onchange = () => {
    const o = sel.selectedOptions[0];
    if (!o) return;
    if (mode === 'email' && o.dataset.email) $('#ccmTo').value = o.dataset.email;
    if (mode === 'sms' && o.dataset.phone) $('#ccmRemotePhone').value = o.dataset.phone;
  };
}

window.openCloseCompose = async function(mode, leadId, dealName, preset) {
  preset = preset || {};
  if (!leadId) {
    Toast.warning('No Close lead ID on this row. Sync CRM or use a deal from Needs Attention / Closing soon.');
    return;
  }
  const modal = ensureCloseComposeModal();
  modal.style.display = 'flex';
  modal.dataset.leadId = leadId;
  modal.dataset.mode = mode;
  $('#ccmTitle').textContent = mode === 'email' ? 'Email via Close CRM' : 'SMS via Close CRM';
  $('#ccmSub').textContent = dealName ? `${dealName} · ${leadId}` : leadId;
  const hint = $('#ccmHint');
  const em = SETTINGS.messaging?.email_from || '—';
  const sms = SETTINGS.messaging?.sms_from || '—';
  hint.textContent = mode === 'email'
    ? `Sending as (Settings → Messaging): ${em}`
    : `Your Close sending number (Settings → Messaging): ${sms}`;

  $('#ccmEmailForm').style.display = mode === 'email' ? 'block' : 'none';
  $('#ccmSmsForm').style.display = mode === 'sms' ? 'block' : 'none';
  $('#ccmTo').value = '';
  $('#ccmSubject').value = preset.subject || '';
  $('#ccmBody').value = preset.body_text || '';
  $('#ccmRemotePhone').value = '';
  $('#ccmSmsText').value = preset.text || '';

  try {
    const r = await fetch(`${SERVER}/close/lead/${encodeURIComponent(leadId)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('Could not load lead from Close');
    const lead = await r.json();
    fillCloseComposeContactOptions(lead, mode);
  } catch (e) {
    Toast.error(e.message || 'Failed to load Close lead');
  }
};

window.submitCloseCompose = async function(status) {
  const modal = $('#closeComposeModal');
  const leadId = modal?.dataset?.leadId;
  const mode = modal?.dataset?.mode;
  if (!leadId) return;
  const contact_id = $('#ccmContactSelect')?.value || undefined;
  try {
    if (mode === 'email') {
      const to = ($('#ccmTo')?.value || '').trim();
      if (!to) throw new Error('Add a recipient email.');
      await postCloseOutbound(`/close/lead/${encodeURIComponent(leadId)}/email`, {
        to: [to],
        subject: $('#ccmSubject')?.value || '',
        body_text: $('#ccmBody')?.value || '',
        contact_id,
        status,
      });
    } else {
      const remote_phone = ($('#ccmRemotePhone')?.value || '').trim();
      const text = ($('#ccmSmsText')?.value || '').trim();
      if (!remote_phone) throw new Error('Add the buyer phone number (E.164).');
      if (!text) throw new Error('Add SMS text.');
      await postCloseOutbound(`/close/lead/${encodeURIComponent(leadId)}/sms`, {
        remote_phone,
        text,
        contact_id,
        status,
      });
    }
    Toast.success(status === 'draft' ? 'Saved in Close (draft)' : 'Queued / sent via Close');
    modal.style.display = 'none';
    await refreshActivityFromServer();
  } catch (e) {
    Toast.error(e.message || 'Close request failed');
  }
};

function getAutomationOutboxPackets() {
  return (Q.completed || [])
    .filter(item => ['draft_close_crm_followup', 'prepare_critical_alert_review'].includes(item.type))
    .sort((a, b) => new Date(b.completed_at || b.queued_at || 0) - new Date(a.completed_at || a.queued_at || 0))
    .slice(0, 8);
}

function packetDispositionBadge(review) {
  if (!review?.disposition) return '';
  if (review.disposition === 'approved') return badge('approved', 'ready');
  if (review.disposition === 'archived') return badge('archived');
  return badge('reviewed', 'gold');
}

function getReadySendPackets() {
  return getAutomationOutboxPackets()
    .filter(item => item.review?.disposition === 'approved')
    .slice(0, 6);
}

window.previewAutomationPacket = function(packet, pin) {
  if (typeof packet === 'string') packet = JSON.parse(packet);
  const result = packet.result || {};
  const deal = findDealLike(packet.payload?.lead_id, packet.payload?.name || result.lead_name);
  const title = result.lead_name || packet.payload?.name || 'Automation packet';
  const sub = packet.type === 'prepare_critical_alert_review' ? 'Critical exception packet' : 'Follow-up draft packet';
  setPreview(`
    <div class="pv-title">${title}</div>
    <div class="pv-sub">${sub}</div>
    <div class="pv-divider"></div>
    <div class="pv-field"><span class="pv-field-label">Packet type</span><span class="pv-field-value">${packet.type.replace(/_/g, ' ')}</span></div>
    <div class="pv-field"><span class="pv-field-label">Completed</span><span class="pv-field-value">${new Date(packet.completed_at || packet.queued_at).toLocaleString()}</span></div>
    <div class="pv-field"><span class="pv-field-label">Source</span><span class="pv-field-value">${packet.source === 'automation_engine' ? 'Automation engine' : 'Manual queue'}</span></div>
    ${result.status ? `<div class="pv-field"><span class="pv-field-label">Status</span><span class="pv-field-value">${result.status}</span></div>` : ''}
    ${packet.review?.disposition ? `<div class="pv-field"><span class="pv-field-label">Review</span><span class="pv-field-value">${packet.review.disposition}</span></div>` : ''}
    ${result.related_stage ? `<div class="pv-field"><span class="pv-field-label">Stage</span><span class="pv-field-value">${result.related_stage}</span></div>` : ''}
    ${result.related_value ? `<div class="pv-field"><span class="pv-field-label">Value</span><span class="pv-field-value" style="color:var(--green)">${fmt$(result.related_value)}</span></div>` : ''}
    <div class="pv-divider"></div>
    <div class="pv-section-label">Packet note</div>
    <div class="script-block" style="white-space:pre-wrap;font-style:normal;">${result.draft_note || result.message || 'Packet prepared and ready for review.'}</div>
    ${packet.review?.note ? `<div class="pv-section-label">Review note</div><p style="font-size:0.72rem;line-height:1.55;color:var(--maroon);opacity:0.74;">${packet.review.note}</p>` : ''}
    ${packet.next_step?.label ? `<div class="pv-section-label">Next step</div><p style="font-size:0.72rem;line-height:1.55;color:var(--maroon);opacity:0.74;">${packet.next_step.label}</p>` : ''}
    ${result.action_required ? `<div class="pv-section-label">Required action</div><p style="font-size:0.73rem;line-height:1.55;color:var(--maroon);opacity:0.78;">${result.action_required}</p>` : ''}
    ${result.description ? `<div class="pv-section-label">Lead context</div><p style="font-size:0.72rem;line-height:1.55;color:var(--maroon);opacity:0.72;white-space:pre-wrap;">${result.description}</p>` : ''}
    ${renderPreviewActionRow([
      deal ? `<button class="preview-action-btn gold" onclick="openDealWorkspace('${String(deal.name || title).replace(/'/g, "\\'")}')"><span class="material-symbols-outlined">sell</span>Open deal</button>` : '',
      `<button class="preview-action-btn" onclick="pinMarkdownToPreview('${title.replace(/'/g, "\\'")} packet', ${esc(result.draft_note || result.message || '')})"><span class="material-symbols-outlined">push_pin</span>Pin note</button>`,
      packet.type === 'draft_close_crm_followup' && deal ? `<button class="preview-action-btn" onclick="aiDraftFollowup(${esc(deal)})"><span class="material-symbols-outlined">edit_note</span>AI draft</button>` : '',
      `<button class="preview-action-btn" onclick="reviewAutomationPacket('${packet.id}','approved')"><span class="material-symbols-outlined">done_all</span>Approve</button>`,
      `<button class="preview-action-btn" onclick="reviewAutomationPacket('${packet.id}','archived')"><span class="material-symbols-outlined">inventory_2</span>Archive</button>`,
    ].filter(Boolean))}
  `, pin);
};

function renderQueueHTML() {
  const pending = Q.pending || [];
  const done = (Q.completed || []).slice(0, 3);
  const freshPending = pending.filter(item => queueAgeMinutes(item) < 45);
  const stalePending = pending.filter(item => queueAgeMinutes(item) >= 45);
  if (!pending.length && !done.length) {
    return `<div class="preview-empty" style="height:4rem;"><span class="material-symbols-outlined">check_circle</span><p>Queue empty — all caught up</p></div>`;
  }
  let html = '';
  if (freshPending.length) {
    html += `<div class="pv-section-label" style="margin-bottom:0.3rem;">Fresh Pending (${freshPending.length})</div>`;
    html += freshPending.map(a => `
      <div class="q-item" style="margin-bottom:0.3rem;border-color:rgba(232,168,56,0.3);">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div><div style="font-size:0.72rem;font-weight:700;color:var(--maroon-deep);">${a.type.replace(/_/g,' ')}</div>
          <div style="font-size:0.62rem;color:var(--burgundy);opacity:0.5;">${a.payload?.name || ''} · ${new Date(a.queued_at).toLocaleTimeString()} · ${queueAgeMinutes(a)}m ago</div></div>
          ${badge('pending','medium')}
        </div>
      </div>
    `).join('');
  }
  if (stalePending.length) {
    html += `<div class="pv-section-label" style="margin-top:0.6rem;margin-bottom:0.3rem;">Legacy Backlog (${stalePending.length})</div>`;
    html += `<div class="q-item" style="margin-bottom:0.4rem;border-color:rgba(196,112,80,0.24);background:rgba(196,112,80,0.05);">
      <div style="font-size:0.7rem;font-weight:700;color:var(--maroon-deep);margin-bottom:0.2rem;">Older queue residue detected</div>
      <div style="font-size:0.65rem;color:var(--burgundy);opacity:0.72;line-height:1.5;">These items are older leftovers from earlier passes. Fresh automation packets will keep flowing above them, so the queue stays usable even while the backlog gets cleaned up server-side.</div>
    </div>`;
  }
  if (done.length) {
    html += `<div class="pv-section-label" style="margin-top:0.6rem;margin-bottom:0.3rem;">Recently done</div>`;
    html += done.map(a => `
      <div class="q-item" style="margin-bottom:0.3rem;border-color:rgba(107,191,150,0.2);">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div><div style="font-size:0.72rem;font-weight:700;color:var(--maroon-deep);">${a.type.replace(/_/g,' ')}</div>
          <div style="font-size:0.62rem;color:var(--burgundy);opacity:0.5;">${a.payload?.name || ''}</div></div>
          ${badge('done','won')}
        </div>
      </div>
    `).join('');
  }
  return html;
}

window.refreshQueueView = async function() {
  await refreshQueue();
  const panel = $('#queuePanel');
  if (panel) panel.innerHTML = renderQueueHTML();
};

window.requestSync = async function() {
  const a = await queueAction('sync_close_crm_pipeline', { requested_by: 'Andre Raw', timestamp: new Date().toISOString() });
  if (a) {
    setPreview(`<div class="pv-title">Sync Queued</div><div class="pv-sub">ID: ${a.id}</div><div class="pv-divider"></div><p style="font-size:0.73rem;line-height:1.5;color:var(--maroon);opacity:0.7;">Claude will pull fresh data from Close CRM during the next automation run and update all data files. Action ID: ${a.id}</p>`);
    Toast.info('Pipeline sync queued');
    await refreshQueueView();
  }
};

window.queueFollowUp = async function(leadId, name) {
  const a = await queueAction('draft_close_crm_followup', { lead_id: leadId, name, requested_at: new Date().toISOString() });
  if (a) {
    setPreview(`<div class="pv-title">Follow-up Queued</div><div class="pv-sub">${name}</div><div class="pv-divider"></div><p style="font-size:0.73rem;line-height:1.5;color:var(--maroon);opacity:0.7;">Claude will draft a personalized follow-up for <strong>${name}</strong> using Oracle templates and send it via Close CRM during the next run. Action ID: ${a.id}</p>`);
    Toast.success('Follow-up queued for ' + name);
    await refreshQueueView();
  }
};

window.queueTask = async function(leadId, name) {
  const a = await queueAction('create_clickup_task', { lead_id: leadId, name, requested_at: new Date().toISOString() });
  if (a) {
    setPreview(`<div class="pv-title">ClickUp Task Queued</div><div class="pv-sub">${name}</div><div class="pv-divider"></div><p style="font-size:0.73rem;line-height:1.5;color:var(--maroon);opacity:0.7;">Claude will create a follow-up task in ClickUp for <strong>${name}</strong> during the next automation run. Action ID: ${a.id}</p>`);
    await refreshQueueView();
  }
};

window.queueCriticalAlertReview = async function(leadId, name) {
  const a = await queueAction('prepare_critical_alert_review', { lead_id: leadId, name, requested_at: new Date().toISOString() });
  if (a) {
    setPreview(`<div class="pv-title">Critical Review Queued</div><div class="pv-sub">${name}</div><div class="pv-divider"></div><p style="font-size:0.73rem;line-height:1.5;color:var(--maroon);opacity:0.7;">Claude will build a review packet for this critical Close alert so Andre can resolve it fast without digging through the CRM manually. Action ID: ${a.id}</p>`);
    Toast.warning('Critical review packet queued for ' + name);
    await refreshQueueView();
  }
};

window.reviewAutomationPacket = async function(actionId, disposition) {
  if (!serverOnline) {
    Toast.warning('Server offline — cannot update packet review state');
    return;
  }
  try {
    const note = disposition === 'approved'
      ? 'Approved in command center for next action.'
      : 'Archived after operator review.';
    const r = await fetch(`${SERVER}/queue/${actionId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disposition, note, reviewed_by: 'Andre Raw' })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Review update failed');
    Toast.success(`Packet ${disposition}`);
    await refreshQueue();
    if (currentView === 'automation') renderAutomation();
  } catch(e) {
    console.error('Failed to review packet', e);
    Toast.error('Could not update packet');
  }
};

window.queueMorningBrief = async function() {
  const a = await queueAction('generate_morning_brief', { date: new Date().toDateString(), requested_at: new Date().toISOString() });
  if (a) {
    setPreview(`<div class="pv-title">Morning Brief Queued</div><div class="pv-sub">Today's Brief</div><div class="pv-divider"></div><p style="font-size:0.73rem;line-height:1.5;color:var(--maroon);opacity:0.7;">Claude will generate today's sales brief — deal priorities, cadences due, and top actions — and save it to the data folder for this view. Action ID: ${a.id}</p>`);
    Toast.info('Morning brief queued');
    await refreshQueueView();
  }
};

window.queueCadenceCheck = async function() {
  const a = await queueAction('check_cadences_due', { date: new Date().toDateString(), requested_at: new Date().toISOString() });
  if (a) {
    setPreview(`<div class="pv-title">Cadence Check Queued</div><div class="pv-sub">All active deals</div><div class="pv-divider"></div><p style="font-size:0.73rem;line-height:1.5;color:var(--maroon);opacity:0.7;">Claude will check all 107 active deals against your cadence protocols and flag any that are overdue for a touch. Action ID: ${a.id}</p>`);
    Toast.info('Cadence check queued');
    await refreshQueueView();
  }
};

window.queuePipelineSync = async function() {
  const a = await queueAction('full_pipeline_sync', { requested_at: new Date().toISOString() });
  if (a) {
    setPreview(`<div class="pv-title">Pipeline Sync Queued</div><div class="pv-sub">Full Close CRM → App sync</div><div class="pv-divider"></div><p style="font-size:0.73rem;line-height:1.5;color:var(--maroon);opacity:0.7;">Claude will pull all active opportunities from Close CRM and rebuild the pipeline data files. Your Command and Pipeline views will reflect live data after the next run. Action ID: ${a.id}</p>`);
    Toast.info('Full pipeline sync queued');
    await refreshQueueView();
  }
};

window.runAutomationNow = async function(id) {
  try {
    const r = await fetch(`${SERVER}/automation/run/${id}`, { method: 'POST' });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Automation failed');
    Toast.success('Automation ran: ' + id.replace(/_/g, ' '));
    await refreshAutomationStatus();
    if (currentView === 'automation') renderAutomation();
  } catch(e) {
    Toast.error(e.message);
  }
};

window.saveOpsNoteFromUI = async function() {
  try {
    const payload = {
      summary: $('#opsSummaryInput')?.value?.trim() || '',
      what_we_learned: $('#opsLearningInput')?.value?.trim() || '',
      what_we_added: $('#opsAddedInput')?.value?.trim() || '',
      what_it_affected: $('#opsAffectedInput')?.value?.trim() || '',
      help_signal: $('#opsHelpingInput')?.value?.trim() || '',
      bottleneck: $('#opsBottleneckInput')?.value?.trim() || '',
    };
    await saveOpsNote(payload);
    Toast.success('Daily ops note saved');
    if (currentView === 'automation') renderAutomation();
  } catch(e) {
    Toast.error(e.message);
  }
};

// ═══════════════════════════════════════
// TIMELINE — Calendar + DAG + Activity Log
// ═══════════════════════════════════════
let selectedTimelineDate = null;

function renderTimeline() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const log = ACT.log || [];

  // Build activity counts per day
  const dayCounts = {};
  const dayTypes = {};
  log.forEach(entry => {
    const d = entry.ts?.substring(0, 10);
    if (!d) return;
    dayCounts[d] = (dayCounts[d] || 0) + 1;
    if (!dayTypes[d]) dayTypes[d] = {};
    dayTypes[d][entry.type] = (dayTypes[d][entry.type] || 0) + 1;
  });

  // Calendar grid
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const todayStr = now.toISOString().substring(0, 10);
  if (!selectedTimelineDate) selectedTimelineDate = todayStr;

  let calendarCells = '';
  // Blank cells for offset
  for (let i = 0; i < firstDay; i++) calendarCells += '<div class="cal-cell cal-empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const count = dayCounts[dateStr] || 0;
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === selectedTimelineDate;
    const types = dayTypes[dateStr] || {};
    const dots = Object.keys(types).map(t => {
      const c = t === 'ai' ? 'var(--gold)' : t === 'sync' ? 'var(--cyan)' : t === 'queue' ? 'var(--amber)' : 'var(--burgundy)';
      return `<div style="width:4px;height:4px;border-radius:50%;background:${c};"></div>`;
    }).join('');
    calendarCells += `
      <div class="cal-cell${isToday ? ' cal-today' : ''}${isSelected ? ' cal-selected' : ''}${count > 0 ? ' cal-has-activity' : ''}" onclick="selectTimelineDate('${dateStr}')">
        <span class="cal-day">${d}</span>
        ${count > 0 ? `<div style="display:flex;gap:2px;justify-content:center;margin-top:2px;">${dots}</div>` : ''}
      </div>`;
  }

  // Day detail — activities for selected date
  const dayLog = log.filter(e => e.ts?.startsWith(selectedTimelineDate)).reverse();
  const selectedLabel = new Date(selectedTimelineDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const opsDay = OPS.daily?.[selectedTimelineDate] || null;

  // Build relationship graph data for this day
  const graphData = buildDayGraph(dayLog);

  stageScroll.innerHTML = `
    <div class="vh">
      <span class="label"><span class="material-symbols-outlined" style="font-size:0.75rem;">calendar_month</span> Timeline</span>
      <h2>Activity Timeline</h2>
      <p>Calendar view of all actions, AI calls, syncs, and automations</p>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
      <!-- CALENDAR -->
      <div class="panel-block" style="border-color:rgba(201,168,76,0.15);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.8rem;">
          <h2 style="margin:0;">${monthName}</h2>
          <div style="display:flex;gap:0.3rem;">
            <div style="display:flex;align-items:center;gap:0.25rem;font-size:0.58rem;color:var(--burgundy);"><div style="width:6px;height:6px;border-radius:50%;background:var(--gold);"></div> AI</div>
            <div style="display:flex;align-items:center;gap:0.25rem;font-size:0.58rem;color:var(--burgundy);"><div style="width:6px;height:6px;border-radius:50%;background:var(--cyan);"></div> Sync</div>
            <div style="display:flex;align-items:center;gap:0.25rem;font-size:0.58rem;color:var(--burgundy);"><div style="width:6px;height:6px;border-radius:50%;background:var(--amber);"></div> Queue</div>
          </div>
        </div>
        <div class="cal-grid">
          <div class="cal-header">Sun</div><div class="cal-header">Mon</div><div class="cal-header">Tue</div><div class="cal-header">Wed</div><div class="cal-header">Thu</div><div class="cal-header">Fri</div><div class="cal-header">Sat</div>
          ${calendarCells}
        </div>
      </div>

      <!-- DAY SUMMARY -->
      <div class="panel-block" style="border-color:rgba(201,168,76,0.15);">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.6rem;">
          <span class="material-symbols-outlined" style="font-size:1.1rem;color:var(--gold);">today</span>
          <h2 style="margin:0;">${selectedLabel}</h2>
          <span style="margin-left:auto;font-size:0.65rem;color:var(--burgundy);opacity:0.5;">${dayLog.length} event${dayLog.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="timeline-chip-row">
          <button class="timeline-chip${dayLog.some(e => e.type === 'ai') ? ' active' : ''}" onclick="navigateTo('oracle')">AI ${dayLog.filter(e=>e.type==='ai').length}</button>
          <button class="timeline-chip${dayLog.some(e => e.type === 'queue') ? ' active' : ''}" onclick="navigateTo('automation')">Queue ${dayLog.filter(e=>e.type==='queue').length}</button>
          <button class="timeline-chip${dayLog.some(e => e.type === 'sync') ? ' active' : ''}" onclick="navigateTo('automation')">Sync ${dayLog.filter(e=>e.type==='sync').length}</button>
        </div>
        ${dayLog.length === 0
          ? '<div style="text-align:center;padding:2rem;opacity:0.3;"><span class="material-symbols-outlined" style="font-size:2rem;">event_busy</span><p style="font-size:0.72rem;margin-top:0.5rem;">No activity recorded</p></div>'
          : `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.4rem;margin-bottom:0.8rem;">
              <div class="status-card"><div class="status-label">AI Calls</div><div class="status-value" style="font-family:'Fraunces',serif;font-weight:800;font-size:1.1rem;color:var(--gold);">${dayLog.filter(e=>e.type==='ai').length}</div></div>
              <div class="status-card"><div class="status-label">Syncs</div><div class="status-value" style="font-family:'Fraunces',serif;font-weight:800;font-size:1.1rem;color:var(--cyan);">${dayLog.filter(e=>e.type==='sync').length}</div></div>
              <div class="status-card"><div class="status-label">Queued</div><div class="status-value" style="font-family:'Fraunces',serif;font-weight:800;font-size:1.1rem;color:var(--amber);">${dayLog.filter(e=>e.type==='queue').length}</div></div>
              <div class="status-card"><div class="status-label">Total</div><div class="status-value" style="font-family:'Fraunces',serif;font-weight:800;font-size:1.1rem;color:var(--maroon-deep);">${dayLog.length}</div></div>
            </div>`
        }
        <div style="max-height:14rem;overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(201,168,76,0.2) transparent;">
          ${dayLog.map(e => {
            const time = new Date(e.ts).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
            const icon = e.type === 'ai' ? 'smart_toy' : e.type === 'sync' ? 'sync' : e.type === 'queue' ? 'bolt' : 'info';
            const color = e.type === 'ai' ? 'var(--gold)' : e.type === 'sync' ? 'var(--cyan)' : e.type === 'queue' ? 'var(--amber)' : 'var(--burgundy)';
            return `<button class="timeline-event" onmouseenter="previewActivity(${esc(e)})" onmouseleave="clearPreview()" onclick="previewActivity(${esc(e)}, true)">
              <div style="width:1.6rem;height:1.6rem;border-radius:0.4rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:rgba(201,168,76,0.05);">
                <span class="material-symbols-outlined" style="font-size:0.8rem;color:${color};">${icon}</span>
              </div>
              <div style="flex:1;min-width:0;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <span style="font-size:0.72rem;font-weight:600;color:var(--maroon-deep);">${e.summary}</span>
                  <span style="font-size:0.6rem;color:var(--burgundy);opacity:0.4;white-space:nowrap;">${time}</span>
                </div>
                ${e.details ? `<div style="font-size:0.65rem;color:var(--burgundy);opacity:0.6;margin-top:0.1rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${e.details.substring(0,120)}</div>` : ''}
                ${(e.related||[]).length ? `<div style="display:flex;gap:0.2rem;flex-wrap:wrap;margin-top:0.2rem;">${e.related.map(r => '<span style="font-size:0.58rem;padding:0.1rem 0.4rem;border-radius:9999px;border:1px solid rgba(201,168,76,0.15);color:var(--gold);">'+r+'</span>').join('')}</div>` : ''}
              </div>
            </button>`;
          }).join('')}
        </div>
        <div class="pv-divider"></div>
        <div class="pv-section-label">Daily ops memory</div>
        ${opsDay
          ? `<div style="display:grid;gap:0.35rem;">
              ${opsDay.summary ? `<div class="script-block" style="border-left-color:var(--gold);">${opsDay.summary}</div>` : ''}
              ${opsDay.what_we_learned?.length ? `<div style="font-size:0.7rem;color:var(--maroon);"><strong>Learning:</strong> ${opsDay.what_we_learned[0]}</div>` : ''}
              ${opsDay.what_we_added?.length ? `<div style="font-size:0.7rem;color:var(--maroon);"><strong>Added:</strong> ${opsDay.what_we_added[0]}</div>` : ''}
              ${opsDay.bottlenecks?.length ? `<div style="font-size:0.7rem;color:var(--coral);"><strong>Bottleneck:</strong> ${opsDay.bottlenecks[0]}</div>` : ''}
            </div>`
          : '<div style="font-size:0.68rem;color:var(--burgundy);opacity:0.5;">No explicit ops note saved for this day yet.</div>'}
      </div>
    </div>

    <div class="layout-grid-half">
      <div class="panel-block" style="border-color:rgba(201,168,76,0.15);min-height:24rem;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.6rem;">
          <h2 style="margin:0;"><span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);vertical-align:text-bottom;">hub</span> Relationship Graph — ${selectedLabel}</h2>
          <span style="font-size:0.6rem;color:var(--burgundy);opacity:0.4;">${graphData.nodes.length} nodes · ${graphData.edges.length} connections</span>
        </div>
        <p class="panel-note" style="margin-bottom:0.6rem;">Interactive day graph. Hover for context, click to pin details, and jump from the graph into deal work.</p>
        <canvas id="dagCanvas" width="900" height="400" style="width:100%;height:22rem;border-radius:0.6rem;background:#0A0A0A;border:1px solid rgba(201,168,76,0.06);cursor:default;"></canvas>
        <div id="dagInspector" class="dag-inspector">Hover a node to inspect the day's connections.</div>
      </div>
      <div class="panel-block" style="border-color:rgba(201,168,76,0.15);">
        <h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);">article</span> Andre Voice Context</h2>
        <p class="panel-note">Timeline, AI, and coaching all work better when Andre's real sales language is visible right next to live execution.</p>
        ${renderMiniMarkdownPanel('Strategic voice summary', DOCS.voiceSummary || 'Voice summary not loaded yet.', 'markdown', 'var(--gold)')}
        ${renderPreviewActionRow([
          `<button class="preview-action-btn gold" onclick="pinMarkdownToPreview('Andre Strategic Voice Summary', DOCS.voiceSummary)"><span class="material-symbols-outlined">push_pin</span>Pin summary</button>`,
          `<button class="preview-action-btn" onclick="navigateTo('coaching')"><span class="material-symbols-outlined">school</span>Coaching</button>`
        ])}
      </div>
    </div>
  `;

  // Render the DAG after DOM update
  setTimeout(() => renderDAG(graphData), 50);
}

window.selectTimelineDate = function(dateStr) {
  selectedTimelineDate = dateStr;
  renderTimeline();
};

// Build graph data from a day's activity log + pipeline data
function buildDayGraph(dayLog) {
  const nodes = [];
  const edges = [];
  const nodeMap = {};

  function addNode(id, label, type, value, meta) {
    if (nodeMap[id]) return;
    nodeMap[id] = true;
    nodes.push({ id, label, type, value: value || 1, meta: meta || {} });
  }

  // Center node: Andre
  addNode('andre', 'Andre', 'person', 10, { kind: 'person', name: 'Andre Raw' });

  // Add deals from pipeline that were touched today
  const touchedDeals = new Set();
  dayLog.forEach(e => {
    (e.related || []).forEach(r => {
      if (r) touchedDeals.add(r);
    });
  });

  // Add all high-value deals as context nodes
  (L.high_value_deals || []).slice(0, 12).forEach(d => {
    const wasTouched = touchedDeals.has(d.name);
    addNode('deal_' + d.name, d.name, 'deal', Math.max(2, (d.value || 0) / 2000), { kind: 'deal', deal: d });
    edges.push({ from: 'andre', to: 'deal_' + d.name, strength: wasTouched ? 1 : 0.3 });
  });

  // Add activity nodes and connect to deals
  dayLog.forEach((e, i) => {
    const actionId = 'act_' + i;
    const icon = e.type === 'ai' ? 'AI' : e.type === 'sync' ? 'Sync' : e.type === 'queue' ? 'Queue' : 'Event';
    addNode(actionId, icon + ': ' + (e.summary || '').substring(0, 25), 'action_' + e.type, 2, { kind: 'activity', activity: e });

    // Connect action to related deals
    if ((e.related || []).length > 0) {
      e.related.forEach(r => {
        const dealId = 'deal_' + r;
        if (nodeMap[dealId]) {
          edges.push({ from: actionId, to: dealId, strength: 0.8 });
        } else {
          const contactId = 'contact_' + r;
          addNode(contactId, r, 'contact', 1.4, { kind: 'contact', name: r, activity: e });
          edges.push({ from: actionId, to: contactId, strength: 0.65 });
          edges.push({ from: 'andre', to: contactId, strength: 0.35 });
        }
      });
    } else {
      // Connect to Andre if no deal relation
      edges.push({ from: 'andre', to: actionId, strength: 0.5 });
    }
  });

  return { nodes, edges };
}

// Force-directed DAG renderer (pure canvas — no library needed)
function renderDAG(data) {
  const canvas = document.getElementById('dagCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth * 2;  // retina
  const H = canvas.height = canvas.offsetHeight * 2;
  ctx.scale(2, 2);
  const w = W / 2, h = H / 2;

  if (data.nodes.length === 0) {
    ctx.fillStyle = 'rgba(201,168,76,0.15)';
    ctx.font = '13px DM Sans';
    ctx.textAlign = 'center';
    ctx.fillText('No relationship data for this day', w/2, h/2);
    return;
  }

  // Initialize node positions randomly
  const sim = data.nodes.map((n, i) => ({
    ...n,
    x: w/2 + (Math.random() - 0.5) * w * 0.6,
    y: h/2 + (Math.random() - 0.5) * h * 0.6,
    vx: 0, vy: 0,
    r: Math.min(Math.max(n.value * 1.5, 4), 20),
  }));

  // Put Andre in center
  const andreNode = sim.find(n => n.id === 'andre');
  if (andreNode) { andreNode.x = w/2; andreNode.y = h/2; }

  const nodeIndex = {};
  sim.forEach((n, i) => nodeIndex[n.id] = i);

  const edgeSim = data.edges.map(e => ({
    source: nodeIndex[e.from],
    target: nodeIndex[e.to],
    strength: e.strength || 0.5
  })).filter(e => e.source !== undefined && e.target !== undefined);

  // Run simulation
  const iterations = 120;
  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - iter / iterations;
    const repulsion = 800 * alpha;
    const attraction = 0.02 * alpha;

    // Repulsion between all nodes
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        let dx = sim[i].x - sim[j].x;
        let dy = sim[i].y - sim[j].y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        let force = repulsion / (dist * dist);
        let fx = dx / dist * force;
        let fy = dy / dist * force;
        sim[i].vx += fx; sim[i].vy += fy;
        sim[j].vx -= fx; sim[j].vy -= fy;
      }
    }

    // Attraction along edges
    edgeSim.forEach(e => {
      const s = sim[e.source], t = sim[e.target];
      let dx = t.x - s.x, dy = t.y - s.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      let force = attraction * dist * e.strength;
      s.vx += dx / dist * force; s.vy += dy / dist * force;
      t.vx -= dx / dist * force; t.vy -= dy / dist * force;
    });

    // Center gravity
    sim.forEach(n => {
      n.vx += (w/2 - n.x) * 0.005 * alpha;
      n.vy += (h/2 - n.y) * 0.005 * alpha;
    });

    // Apply velocities with damping
    sim.forEach(n => {
      n.vx *= 0.85; n.vy *= 0.85;
      n.x += n.vx; n.y += n.vy;
      n.x = Math.max(n.r + 10, Math.min(w - n.r - 10, n.x));
      n.y = Math.max(n.r + 10, Math.min(h - n.r - 10, n.y));
    });
  }

  graphState = { nodes: sim, selectedId: null };
  const inspector = $('#dagInspector');

  function draw(activeNode) {
    ctx.clearRect(0, 0, w, h);

    edgeSim.forEach(e => {
      const s = sim[e.source], t = sim[e.target];
      const highlighted = activeNode && (s.id === activeNode.id || t.id === activeNode.id);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = highlighted ? 'rgba(232,212,138,0.42)' : `rgba(201,168,76,${0.06 + e.strength * 0.15})`;
      ctx.lineWidth = highlighted ? 1.6 : 0.5 + e.strength;
      ctx.stroke();
    });

    sim.forEach(n => {
      const colors = {
        person: '#C9A84C',
        deal: '#4A9E68',
        contact: '#B89060',
        action_ai: '#C9A84C',
        action_sync: '#6A98A8',
        action_queue: '#C8943A',
        action_system: '#8668A8',
      };
      const color = colors[n.type] || '#A89060';
      const r = parseInt(color.slice(1,3),16), g = parseInt(color.slice(3,5),16), b = parseInt(color.slice(5,7),16);

      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + (activeNode?.id === n.id ? 7 : 4), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${activeNode?.id === n.id ? 0.22 : 0.1})`;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${activeNode?.id === n.id ? 0.44 : 0.25})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${r},${g},${b},${activeNode?.id === n.id ? 0.95 : 0.6})`;
      ctx.lineWidth = activeNode?.id === n.id ? 2.2 : 1.5;
      ctx.stroke();

      ctx.fillStyle = `rgba(${r},${g},${b},0.95)`;
      ctx.font = `${n.type === 'person' ? '600 10px' : '500 8px'} DM Sans`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (n.r > 8) ctx.fillText(n.label.substring(0, 12), n.x, n.y);
      else ctx.fillText(n.label.substring(0, 20), n.x, n.y + n.r + 10);
    });
  }

  function pickNode(evt) {
    const rect = canvas.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;
    return sim.find(n => Math.hypot(n.x - x, n.y - y) <= n.r + 6) || null;
  }

  function updateInspector(node) {
    if (!inspector) return;
    if (!node) {
      inspector.textContent = "Hover a node to inspect the day's connections.";
      return;
    }
    const meta = node.meta || {};
    const secondary = meta.deal?.stage || meta.activity?.summary || meta.name || '';
    inspector.innerHTML = `<strong>${node.label}</strong><span>${(meta.kind || node.type).replace(/_/g, ' ')}</span><span>${secondary}</span>`;
  }

  draw(null);
  canvas.onmousemove = evt => {
    const node = pickNode(evt);
    canvas.style.cursor = node ? 'pointer' : 'default';
    updateInspector(node);
    draw(node);
  };
  canvas.onmouseleave = () => {
    updateInspector(null);
    draw(null);
  };
  canvas.onclick = evt => {
    const node = pickNode(evt);
    if (!node) return;
    if (node.meta?.kind === 'deal' && node.meta.deal) previewDeal(null, node.meta.deal, true);
    else if (node.meta?.kind === 'activity' && node.meta.activity) previewActivity(node.meta.activity, true);
    else if (node.meta?.kind === 'contact') previewActivity(node.meta.activity || { summary: node.label, related: [node.label], type: 'contact' }, true);
    else setPreview(`<div class="pv-title">${node.label}</div><div class="pv-sub">${(node.meta?.kind || node.type).replace(/_/g,' ')}</div>`, true);
    draw(node);
    updateInspector(node);
  };
}

// ═══════════════════════════════════════
// ORACLE AI CHAT
// ═══════════════════════════════════════
let chatHistory = [];
let oracleComposerState = {
  dealName: '',
  channel: 'email',
  objective: 'follow_up',
  tone: 'sharp',
};

function getOracleDraftTargets() {
  return (L.high_value_deals || L.all_deals || []).slice().filter(Boolean);
}

function buildComposerPrompt() {
  const deal = findDealByName(oracleComposerState.dealName) || getOracleDraftTargets()[0];
  if (!deal) return 'Draft a professional sales follow-up.';
  const plan = buildDealCommsPlan(deal);
  const channel = oracleComposerState.channel || 'email';
  const objective = oracleComposerState.objective.replace(/_/g, ' ');
  const tone = oracleComposerState.tone;
  const template = channel === 'sms' ? plan.sms : plan.email;
  return [
    `Draft a ${channel.toUpperCase()} for ${deal.name}.`,
    `Objective: ${objective}.`,
    `Tone: ${tone}, aligned with Andre's voice: ${plan.tone}.`,
    `Deal stage: ${deal.stage}.`,
    `Event: ${deal.event || 'Unknown'} at ${deal.venue || 'TBD'}.`,
    `Value: ${fmt$(deal.value)}. Confidence: ${deal.confidence || 'unknown'}%.`,
    plan.packet ? `Use the Oracle message lane "${plan.packet.name}".` : '',
    template ? `Use this template as a structural starting point, but personalize it hard:\n${template.subject ? 'Subject: ' + template.subject + '\n' : ''}${template.body}` : '',
    `Output cleanly with subject line first if this is email, then the final message only.`,
  ].filter(Boolean).join('\n\n');
}

window.updateOracleComposer = function(key, value) {
  oracleComposerState[key] = value;
};

window.oracleDraftFromComposer = async function() {
  const prompt = buildComposerPrompt();
  await oracleSend(prompt);
};

function renderOracle() {
  const aiReady = SETTINGS.ai?.openai_api_key_set;
  const topDeal = (L.high_value_deals || [])[0];
  const oracleIntelPanel = DOCS.voiceReadme || DOCS.voiceSummary;
  const composerDeals = getOracleDraftTargets().slice(0, 12);
  if (!oracleComposerState.dealName && composerDeals[0]) oracleComposerState.dealName = composerDeals[0].name;

  stageScroll.innerHTML = `
    <div class="vh">
      <span class="label"><span class="material-symbols-outlined" style="font-size:0.75rem;">smart_toy</span> Oracle AI</span>
      <h2>Sales Oracle</h2>
      <p>AI-powered sales intelligence — ask about deals, get coaching, draft messages</p>
    </div>

    ${!aiReady ? `
      <div class="panel-block" style="border-color:rgba(201,168,76,0.25);text-align:center;padding:2rem;">
        <span class="material-symbols-outlined" style="font-size:3rem;color:var(--gold);margin-bottom:1rem;">key</span>
        <h2 style="margin-bottom:0.5rem;">Connect Your AI</h2>
        <p class="panel-note" style="max-width:24rem;margin:0 auto;">Add your OpenAI API key in Settings to unlock Oracle — your AI sales assistant that knows your pipeline, playbook, and coaching gaps.</p>
        <button onclick="showView('settings')" style="margin-top:1rem;padding:0.6rem 1.5rem;border-radius:0.6rem;border:none;background:#C9A84C;color:#0C0C0C;font-family:inherit;font-weight:700;font-size:0.78rem;cursor:pointer;">Go to Settings</button>
      </div>
    ` : `
      <div class="oracle-layout">
        <section class="oracle-conversation" aria-label="Oracle conversation">
          <div class="oracle-thread-header">
            <div>
              <h2 class="oracle-thread-title"><span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);vertical-align:text-bottom;">forum</span> Conversation</h2>
              <p class="oracle-thread-sub">Guided mode: each reply ends with sign-off next steps; your taps and A+–F grades train suggestions (local only).</p>
            </div>
          </div>
          <div id="chatMessages" class="oracle-thread">
          ${chatHistory.length === 0 ? `
            <div class="oracle-empty-hint">
              <span class="material-symbols-outlined" style="font-size:2.5rem;color:var(--gold);">auto_awesome</span>
              <div class="oracle-empty-title">Start a thread</div>
              <p>Type below or use a shortcut. Replies appear here — scroll this panel to read the full conversation.</p>
            </div>
            <div class="oracle-quick-grid">
              <button class="oracle-quick-btn" onclick="oracleSend('What are my top 3 priority deals and what should I do with each right now?')">
                <span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);">priority_high</span>
                <span>Top priority deals</span>
              </button>
              <button class="oracle-quick-btn" onclick="oracleSend('Draft a follow-up message for my highest value open deal — make it sharp and specific to where the buyer is right now')">
                <span class="material-symbols-outlined" style="font-size:1rem;color:var(--cyan);">edit_note</span>
                <span>Draft a follow-up</span>
              </button>
              <button class="oracle-quick-btn" onclick="oracleSend('Which deals have the most risk right now? For each, tell me what the real problem is and give me a specific recovery move')">
                <span class="material-symbols-outlined" style="font-size:1rem;color:var(--coral);">warning</span>
                <span>Deals at risk</span>
              </button>
              <button class="oracle-quick-btn" onclick="oracleSend('Give me my game plan for today. Prioritize by what moves the most money the fastest. Be specific — deal names, dollar amounts, exact actions.')">
                <span class="material-symbols-outlined" style="font-size:1rem;color:var(--green);">today</span>
                <span>Today's game plan</span>
              </button>
              <button class="oracle-quick-btn" onclick="oracleSend('Look at my stalled deals and give me a re-engagement strategy for each one. What message, what angle, what timing?')">
                <span class="material-symbols-outlined" style="font-size:1rem;color:var(--amber);">restart_alt</span>
                <span>Revive stalled deals</span>
              </button>
              <button class="oracle-quick-btn" onclick="oracleSend('What are my biggest coaching gaps right now? Give me one specific thing to practice on my next call.')">
                <span class="material-symbols-outlined" style="font-size:1rem;color:var(--purple);">school</span>
                <span>Coaching insight</span>
              </button>
            </div>
          ` : chatHistory.map(m => renderChatMessage(m)).join('')}
          </div>
          <div class="oracle-composer-wrap">
            <div class="oracle-composer-row">
              <textarea id="oracleInput" data-surface="oracle-composer" rows="1" placeholder="Message Oracle…" oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px';" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();oracleSend();}"></textarea>
              <button type="button" id="oracleSendBtn" onclick="oracleSend()" title="Send">
                <span class="material-symbols-outlined" style="font-size:1.1rem;">send</span>
              </button>
            </div>
            <div class="oracle-composer-meta">
              <span>Shift+Enter new line · ${SETTINGS.ai?.model || 'OpenAI'}</span>
              ${chatHistory.length > 0 ? '<button type="button" class="oracle-clear-chat" onclick="clearOracleChat()">Clear thread</button>' : ''}
            </div>
          </div>
        </section>

        <details class="oracle-tools">
          <summary>Pipeline tools &amp; drafting cockpit</summary>
          <div class="oracle-tools-inner">
            <div class="layout-grid-half">
              <div class="panel-block panel-accent-gold">
                <h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);">hub</span> Oracle Control Strip</h2>
                <div class="status-strip" style="grid-template-columns:repeat(3,1fr);margin-bottom:0.8rem;">
                  <div class="status-card"><div class="status-label">Pipeline</div><div class="status-value">${fmt$(L.summary?.total_pipeline)}</div></div>
                  <div class="status-card"><div class="status-label">Today</div><div class="status-value">${T.task_summary?.today || 0} tasks</div></div>
                  <div class="status-card"><div class="status-label">At Risk</div><div class="status-value">${fmt$(L.summary?.at_risk_revenue)}</div></div>
                </div>
                ${renderPreviewActionRow([
                  topDeal ? `<button class="preview-action-btn gold" onclick="openDealWorkspace('${topDeal.name.replace(/'/g, "\\'")}')"><span class="material-symbols-outlined">sell</span>Open top deal</button>` : '',
                  `<button class="preview-action-btn" onclick="oracleSend('Give me a clean executive summary of everything that matters right now: biggest money, biggest risk, biggest next action.')"><span class="material-symbols-outlined">assistant</span>Exec summary</button>`
                ].filter(Boolean))}
              </div>
              <div class="panel-block">
                <h2><span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);">markdown</span> Andre Voice Panel</h2>
                ${renderMiniMarkdownPanel('Call-language operating context', oracleIntelPanel || 'Voice panel not loaded yet.', 'record_voice_over', 'var(--gold)')}
                ${renderPreviewActionRow([
                  `<button class="preview-action-btn gold" onclick="pinMarkdownToPreview('Andre Voice Panel', DOCS.voiceReadme || DOCS.voiceSummary)"><span class="material-symbols-outlined">push_pin</span>Pin panel</button>`,
                  `<button class="preview-action-btn" onclick="navigateTo('timeline')"><span class="material-symbols-outlined">calendar_month</span>Timeline</button>`
                ])}
              </div>
            </div>
            <div class="panel-block oracle-composer-shell">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.8rem;">
                <h2 style="margin-bottom:0;"><span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);">edit_square</span> Drafting Cockpit</h2>
                <button class="preview-action-btn gold" onclick="oracleDraftFromComposer()"><span class="material-symbols-outlined">auto_awesome</span>Draft now</button>
              </div>
              <p class="panel-note">Choose the deal, channel, and objective first. Oracle will draft with Andre's tone, the deal context, and the best matching message lane.</p>
              <div class="composer-grid">
                <label class="composer-field">
                  <span class="composer-label">Deal</span>
                  <select class="composer-select" onchange="updateOracleComposer('dealName', this.value)">
                    ${composerDeals.map(d => `<option value="${d.name.replace(/"/g, '&quot;')}" ${oracleComposerState.dealName === d.name ? 'selected' : ''}>${d.name} · ${fmt$(d.value)} · ${d.stage}</option>`).join('')}
                  </select>
                </label>
                <label class="composer-field">
                  <span class="composer-label">Channel</span>
                  <select class="composer-select" onchange="updateOracleComposer('channel', this.value)">
                    <option value="email" ${oracleComposerState.channel === 'email' ? 'selected' : ''}>Email</option>
                    <option value="sms" ${oracleComposerState.channel === 'sms' ? 'selected' : ''}>SMS</option>
                  </select>
                </label>
                <label class="composer-field">
                  <span class="composer-label">Objective</span>
                  <select class="composer-select" onchange="updateOracleComposer('objective', this.value)">
                    <option value="follow_up" ${oracleComposerState.objective === 'follow_up' ? 'selected' : ''}>Follow-up</option>
                    <option value="quote_push" ${oracleComposerState.objective === 'quote_push' ? 'selected' : ''}>Quote push</option>
                    <option value="tasting_conversion" ${oracleComposerState.objective === 'tasting_conversion' ? 'selected' : ''}>Tasting conversion</option>
                    <option value="stalled_recovery" ${oracleComposerState.objective === 'stalled_recovery' ? 'selected' : ''}>Stalled recovery</option>
                  </select>
                </label>
                <label class="composer-field">
                  <span class="composer-label">Tone</span>
                  <select class="composer-select" onchange="updateOracleComposer('tone', this.value)">
                    <option value="sharp" ${oracleComposerState.tone === 'sharp' ? 'selected' : ''}>Sharp</option>
                    <option value="warm" ${oracleComposerState.tone === 'warm' ? 'selected' : ''}>Warm</option>
                    <option value="urgent" ${oracleComposerState.tone === 'urgent' ? 'selected' : ''}>Urgent</option>
                    <option value="calm" ${oracleComposerState.tone === 'calm' ? 'selected' : ''}>Calm</option>
                  </select>
                </label>
              </div>
              <div class="composer-preview">
                <div class="composer-preview-label">Prompt preview</div>
                <div class="composer-preview-body">${buildComposerPrompt().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>
              </div>
            </div>
          </div>
        </details>
      </div>
    `}
  `;
}

// Markdown renderer — uses marked.js if available, graceful fallback
function renderMd(text) {
  if (!text) return '';
  if (typeof marked !== 'undefined') {
    try {
      marked.setOptions({ breaks: true, gfm: true });
      return marked.parse(text);
    } catch(e) { /* fallback */ }
  }
  // Fallback: basic escaping + line breaks
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

function oracleGradeNoteDomId(turnId) {
  return 'ogn_' + String(turnId).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function rerenderOracleChatOnly() {
  const el = $('#chatMessages');
  if (el && currentView === 'oracle') {
    el.innerHTML = chatHistory.map(m => renderChatMessage(m)).join('');
    el.scrollTop = el.scrollHeight;
  }
}

function renderChatMessage(m) {
  const isUser = m.role === 'user';
  const content = isUser ? m.content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') : renderMd(m.content);
  const steps = (!isUser && m.nextSteps && m.nextSteps.length) ? m.nextSteps : [];
  const turnIdJs = m.turnId != null ? JSON.stringify(m.turnId) : 'null';
  const noteId = !isUser && m.turnId ? oracleGradeNoteDomId(m.turnId) : '';
  const gradesRow = (!isUser && m.turnId && !m.oracleGrade && !m.oracleGradeDraft)
    ? `<div class="oracle-grade-row"><span class="oracle-grade-label">Rate this reply</span><div class="oracle-grade-chips">${['A+','A','B','C','D','F'].map(g => `<button type="button" class="oracle-grade-chip" onclick="oraclePickGrade(${turnIdJs},${JSON.stringify(g)})">${g}</button>`).join('')}</div></div>`
    : (!isUser && m.turnId && !m.oracleGrade && m.oracleGradeDraft)
      ? `<div class="oracle-grade-row oracle-grade-draft">
          <span class="oracle-grade-label">Grade <strong>${String(m.oracleGradeDraft).replace(/</g,'&lt;')}</strong> — why? (optional, helps Oracle learn)</span>
          <textarea id="${noteId}" class="oracle-grade-note-input" rows="2" placeholder="e.g. Too wordy / missed deal names / exactly the tone I want…"></textarea>
          <div class="oracle-grade-draft-actions">
            <button type="button" class="preview-action-btn gold" onclick="oracleCommitGrade(${turnIdJs})"><span class="material-symbols-outlined">check</span>Save rating</button>
            <button type="button" class="preview-action-btn" onclick="oracleCancelGrade(${turnIdJs})">Cancel</button>
          </div>
        </div>`
      : (!isUser && m.turnId && m.oracleGrade
        ? `<div class="oracle-grade-done">Graded <strong>${String(m.oracleGrade).replace(/</g,'&lt;')}</strong>${m.oracleGradeNote ? ` · <span class="oracle-grade-note-preview">${String(m.oracleGradeNote).replace(/</g,'&lt;').replace(/\n/g,' ').slice(0, 160)}${(m.oracleGradeNote||'').length > 160 ? '…' : ''}</span>` : ''}</div>`
        : '');
  const stepsRow = steps.length
    ? `<div class="oracle-next-steps"><div class="oracle-next-steps-label">Next steps</div><div class="oracle-next-steps-chips">${steps.map((s, i) => `<button type="button" class="oracle-step-chip" onclick="oracleRunGuidedStep(${turnIdJs},${i})"><span class="material-symbols-outlined">arrow_forward</span>${String(s.label).replace(/</g,'&lt;')}</button>`).join('')}</div></div>`
    : '';
  return `
    <div style="display:flex;gap:0.6rem;align-items:flex-start;${isUser ? 'flex-direction:row-reverse;' : ''}">
      <div style="width:1.8rem;height:1.8rem;border-radius:0.5rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;${isUser ? 'background:rgba(201,168,76,0.15);' : 'background:rgba(74,158,104,0.1);'}">
        <span class="material-symbols-outlined" style="font-size:0.9rem;${isUser ? 'color:#C9A84C;' : 'color:#4A9E68;'}">${isUser ? 'person' : 'smart_toy'}</span>
      </div>
      <div class="md-content" style="max-width:80%;padding:0.8rem 1rem;border-radius:0.75rem;${isUser ? 'background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.15);' : 'background:#161616;border:1px solid rgba(255,255,255,0.05);'}">
        <div style="font-size:0.78rem;color:#F0E8D4;line-height:1.6;">${content}</div>
        ${stepsRow}
        ${gradesRow}
        ${!isUser ? `<div class="chat-message-actions"><button class="preview-action-btn" onclick="pinMarkdownToPreview('Oracle Response', ${esc(m.content)})"><span class="material-symbols-outlined">push_pin</span>Pin</button><button class="preview-action-btn" onclick="navigator.clipboard.writeText(${esc(m.content)});Toast.success('Copied to clipboard')"><span class="material-symbols-outlined">content_copy</span>Copy</button></div>` : ''}
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════
// AI ENGINE — All AI calls go through here
// ═══════════════════════════════════════
/** Build API message list for Oracle free chat — pipeline context only on the first user turn. */
function buildOracleChatPayload(history) {
  const context = buildOracleContext();
  const out = [];
  let firstUser = true;
  for (const m of history) {
    if (m.role === 'user') {
      out.push({
        role: 'user',
        content: firstUser ? `${context}\n\n${m.content}` : m.content
      });
      firstUser = false;
    } else if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: m.content });
    }
  }
  return out;
}

async function aiCall(userMessage, actionType, dealContext, threadMessages) {
  const context = buildOracleContext();
  const dealInfo = dealContext ? `\n\n[DEAL FOCUS]\nName: ${dealContext.name}\nValue: $${(dealContext.value||0).toLocaleString()}\nStage: ${dealContext.stage}\nEvent: ${dealContext.event || 'Unknown'}\nVenue: ${dealContext.venue || 'TBD'}\nGuests: ${dealContext.guests || 'TBD'}\nConfidence: ${dealContext.confidence || '?'}%\nPriority: ${dealContext.priority || 'medium'}\nRisk Flags: ${(dealContext.risk||[]).join(', ') || 'None'}\n[END DEAL FOCUS]` : '';

  const messages = Array.isArray(threadMessages) && threadMessages.length > 0
    ? threadMessages
    : [{ role: 'user', content: context + dealInfo + '\n\n' + userMessage }];

  const r = await fetch(`${SERVER}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action_type: actionType || null,
      messages,
      guided_oracle: Array.isArray(threadMessages) && threadMessages.length > 0
    })
  });
  let data = {};
  try {
    data = await r.json();
  } catch (_) {
    return `Server error (${r.status}). Check that the API is reachable.`;
  }
  if (!r.ok) {
    return data.error || `Request failed (${r.status}). ${data.message || ''}`.trim();
  }
  return data.output_text || data.output?.[0]?.content?.[0]?.text || data.error || 'No response received.';
}

async function presentAiResult(reply, icon, title, meta = {}) {
  await persistAiArtifact({ type: meta.type || 'ai_result', title, content: reply, ...meta });
  showAiModal(reply, icon, title);
}

function showTypingIndicator() {
  return `
    <div id="typingIndicator" style="display:flex;gap:0.6rem;align-items:flex-start;">
      <div style="width:1.8rem;height:1.8rem;border-radius:0.5rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:rgba(74,158,104,0.1);">
        <span class="material-symbols-outlined" style="font-size:0.9rem;color:#4A9E68;">smart_toy</span>
      </div>
      <div style="padding:0.8rem 1rem;border-radius:0.75rem;background:#161616;border:1px solid rgba(255,255,255,0.05);">
        <div style="display:flex;gap:0.3rem;align-items:center;">
          <div style="width:6px;height:6px;border-radius:50%;background:#C9A84C;animation:typingDot 1.4s infinite;"></div>
          <div style="width:6px;height:6px;border-radius:50%;background:#C9A84C;animation:typingDot 1.4s infinite 0.2s;"></div>
          <div style="width:6px;height:6px;border-radius:50%;background:#C9A84C;animation:typingDot 1.4s infinite 0.4s;"></div>
        </div>
      </div>
    </div>`;
}

let oracleChatLoading = false;

window.oracleSend = async function(quickMessage) {
  if (oracleChatLoading) return;
  const input = $('#oracleInput');
  const message = quickMessage || (input ? input.value.trim() : '');
  if (!message) return;

  const turnId = 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  chatHistory.push({ role: 'user', content: message, turnId });
  persistChatHistory();

  const sendBtn = $('#oracleSendBtn');
  oracleChatLoading = true;
  if (sendBtn) { sendBtn.disabled = true; sendBtn.style.opacity = '0.45'; }

  const chatArea = $('#chatMessages');
  if (chatArea) {
    chatArea.innerHTML = chatHistory.map(m => renderChatMessage(m)).join('') + showTypingIndicator();
    chatArea.scrollTop = chatArea.scrollHeight;
  }
  if (input) { input.value = ''; input.style.height = 'auto'; }

  try {
    const threadMessages = buildOracleChatPayload(chatHistory);
    const reply = await aiCall(null, null, null, threadMessages);
    const { displayText, steps } = parseOracleGuidedReply(reply);
    chatHistory.push({ role: 'assistant', content: displayText, turnId, nextSteps: steps });
    persistChatHistory();
    persistAiArtifact({ type: 'oracle_chat', title: 'Oracle Chat', content: displayText });
    Toast.success('Oracle responded');
  } catch(e) {
    chatHistory.push({ role: 'assistant', content: 'Connection error — make sure the server is running and your API key is configured in Settings.', turnId, nextSteps: [] });
    persistChatHistory();
    Toast.error('Failed to reach Oracle');
  } finally {
    oracleChatLoading = false;
    if (sendBtn) { sendBtn.disabled = false; sendBtn.style.opacity = '1'; }
  }

  if ($('#chatMessages')) {
    $('#chatMessages').innerHTML = chatHistory.map(m => renderChatMessage(m)).join('');
    $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
  }
};

window.oracleRunGuidedStep = async function(turnId, stepIndex) {
  const msg = chatHistory.find(m => m.role === 'assistant' && m.turnId === turnId);
  if (!msg || !msg.nextSteps || msg.nextSteps[stepIndex] == null) return;
  const step = msg.nextSteps[stepIndex];
  if (step.action === 'oracle_prompt' && oracleChatLoading) {
    Toast.warning('Oracle is still replying — wait a moment.');
    return;
  }
  ORACLE_CHOICE_LOG.push({
    ts: new Date().toISOString(),
    turn_id: turnId,
    step_index: stepIndex,
    action: step.action,
    label: step.label,
    id: step.id,
    payload: step.payload || {}
  });
  ORACLE_CHOICE_LOG = ORACLE_CHOICE_LOG.slice(-120);
  await persistOracleChoiceLog();

  const p = step.payload || {};
  const act = step.action;
  Toast.success(step.label || 'Done');

  if (act === 'navigate' && p.view) {
    navigateTo(p.view);
    return;
  }
  if (act === 'oracle_prompt' && p.text) {
    await oracleSend(p.text);
    return;
  }
  if (act === 'open_deal' && p.dealName) {
    openDealWorkspace(p.dealName);
    return;
  }
  if (act === 'refresh_inbox') {
    await refreshCloseInboxIntel();
    return;
  }
  if (act === 'open_palette' || act === 'command_palette') {
    openCommandPalette();
    return;
  }
  Toast.warning('Unknown or incomplete step: ' + (act || '?'));
};

window.oraclePickGrade = function(turnId, grade) {
  if (turnId == null) return;
  const msg = chatHistory.find(m => m.role === 'assistant' && m.turnId === turnId);
  if (!msg || msg.oracleGrade) return;
  msg.oracleGradeDraft = grade;
  rerenderOracleChatOnly();
  setTimeout(() => {
    const ta = document.getElementById(oracleGradeNoteDomId(turnId));
    if (ta) ta.focus();
  }, 50);
};

window.oracleCancelGrade = function(turnId) {
  const msg = chatHistory.find(m => m.role === 'assistant' && m.turnId === turnId);
  if (!msg) return;
  delete msg.oracleGradeDraft;
  rerenderOracleChatOnly();
};

window.oracleCommitGrade = async function(turnId) {
  if (turnId == null) return;
  const idx = chatHistory.findIndex(m => m.role === 'assistant' && m.turnId === turnId);
  if (idx === -1) return;
  const asst = chatHistory[idx];
  const grade = asst.oracleGradeDraft;
  if (!grade) return;

  let userQuery = '';
  for (let i = idx - 1; i >= 0; i--) {
    if (chatHistory[i].role === 'user') {
      userQuery = chatHistory[i].content || '';
      break;
    }
  }

  const noteEl = document.getElementById(oracleGradeNoteDomId(turnId));
  const note = noteEl ? String(noteEl.value || '').trim() : '';

  delete asst.oracleGradeDraft;
  asst.oracleGrade = grade;
  asst.oracleGradeNote = note || '';

  ORACLE_GRADED_CORPUS.unshift({
    ts: new Date().toISOString(),
    turn_id: turnId,
    grade,
    note: note || null,
    query: userQuery.slice(0, 600),
    response_snippet: (asst.content || '').slice(0, 900)
  });
  ORACLE_GRADED_CORPUS = ORACLE_GRADED_CORPUS.slice(0, 80);
  await persistOracleGraded();
  await persistChatHistory();

  try {
    const ratedBy = (SETTINGS.operator && (SETTINGS.operator.name || SETTINGS.operator.email)) || 'andre';
    await fetch(`${SERVER}/api/hrmr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turn_id: turnId, grade, note: note || null, rated_by: ratedBy })
    });
  } catch (e) {
    console.warn('[HRMR] server persist failed (local copy saved):', e);
  }

  rerenderOracleChatOnly();
  Toast.success('Rating saved — Oracle context updated');
};

window.clearOracleChat = async function() {
  chatHistory = [];
  await persistChatHistory();
  renderOracle();
};

// ═══════════════════════════════════════
// AI ACTION FUNCTIONS — Doctrine-powered
// ═══════════════════════════════════════
window.aiDraftFollowup = async function(deal) {
  const d = typeof deal === 'string' ? JSON.parse(deal.replace(/&quot;/g,'"').replace(/&#39;/g,"'")) : deal;
  showAiModal('Drafting follow-up for ' + d.name + '...', 'edit_note');
  try {
    const reply = await aiCall(
      `Draft a follow-up message for this deal. The buyer is at the "${d.stage}" stage. Consider any risk flags and the deal value when choosing tone and urgency.`,
      'draft_followup', d
    );
    await presentAiResult(reply, 'edit_note', d.name + ' — Follow-up Draft', { type: 'draft_followup', deal_name: d.name });
    Toast.success('Follow-up drafted');
  } catch(e) { showAiModal('Failed to generate — check your connection and API key.', 'error', 'Error'); Toast.error('AI call failed'); }
};

window.aiAnalyzeDeal = async function(deal) {
  const d = typeof deal === 'string' ? JSON.parse(deal.replace(/&quot;/g,'"').replace(/&#39;/g,"'")) : deal;
  showAiModal('Analyzing ' + d.name + '...', 'analytics');
  try {
    const reply = await aiCall(
      `Analyze this deal. What's the real likelihood of closing? What's working, what's stalling, and what's the single most important next move?`,
      'analyze_deal', d
    );
    await presentAiResult(reply, 'analytics', d.name + ' — Deal Analysis', { type: 'analyze_deal', deal_name: d.name });
    Toast.success('Analysis complete');
  } catch(e) { showAiModal('Failed to generate — check your connection and API key.', 'error', 'Error'); Toast.error('AI call failed'); }
};

window.aiHandleObjection = async function(deal) {
  const d = typeof deal === 'string' ? JSON.parse(deal.replace(/&quot;/g,'"').replace(/&#39;/g,"'")) : deal;
  showAiModal('Building objection strategy for ' + d.name + '...', 'shield');
  try {
    const reply = await aiCall(
      `This deal has stalled or the buyer is pushing back. Based on the stage and risk flags, what objections are likely? Give me ready-to-use responses and a re-engagement strategy.`,
      'handle_objection', d
    );
    await presentAiResult(reply, 'shield', d.name + ' — Objection Playbook', { type: 'handle_objection', deal_name: d.name });
    Toast.success('Objection playbook ready');
  } catch(e) { showAiModal('Failed to generate — check your connection and API key.', 'error', 'Error'); Toast.error('AI call failed'); }
};

window.aiCoachMe = async function(deal) {
  let d = null;
  let skillTopic = null;
  let title = 'Pipeline Coaching';
  let prompt = `Based on my current pipeline, what's the single biggest coaching insight I need right now? Be specific — use deal names and numbers.`;

  if (deal) {
    if (typeof deal === 'string') {
      // Check if it's JSON (deal object) or just a skill topic string
      try {
        d = JSON.parse(deal.replace(/&quot;/g,'"').replace(/&#39;/g,"'"));
        prompt = `Give me a coaching tip for this specific deal. What would a master closer do differently right now?`;
        title = d.name + ' — Coaching';
      } catch(e) {
        // It's a skill topic string
        skillTopic = deal;
        prompt = `Give me a detailed, actionable coaching session on ${skillTopic}. Include: key mindset shifts, 3-5 specific techniques, common mistakes to avoid, and real-world examples. Make it practical and immediately useful.`;
        title = skillTopic + ' — Coaching';
      }
    } else {
      // It's a deal object
      d = deal;
      prompt = `Give me a coaching tip for this specific deal. What would a master closer do differently right now?`;
      title = d.name + ' — Coaching';
    }
  }

  showAiModal('Getting coaching insight...', 'school');
  try {
    const reply = await aiCall(prompt, 'coaching_tip', d);
    await presentAiResult(reply, 'school', title, { type: 'coaching_tip', deal_name: d?.name || null });
    Toast.success('Coaching tip ready');
  } catch(e) { showAiModal('Failed to generate — check your connection and API key.', 'error', 'Error'); Toast.error('AI call failed'); }
};

window.aiDiscoveryQuestions = async function(deal) {
  const d = typeof deal === 'string' ? JSON.parse(deal.replace(/&quot;/g,'"').replace(/&#39;/g,"'")) : deal;
  showAiModal('Building discovery questions for ' + d.name + '...', 'help');
  try {
    const reply = await aiCall(
      `Generate discovery questions for my next conversation with this buyer. I need questions that uncover the real decision-making dynamics, budget authority, and emotional drivers.`,
      'discovery_questions', d
    );
    await presentAiResult(reply, 'help', d.name + ' — Discovery Questions', { type: 'discovery_questions', deal_name: d.name });
    Toast.success('Questions ready');
  } catch(e) { showAiModal('Failed to generate — check your connection and API key.', 'error', 'Error'); Toast.error('AI call failed'); }
};

window.aiTastingFollowup = async function(deal) {
  const d = typeof deal === 'string' ? JSON.parse(deal.replace(/&quot;/g,'"').replace(/&#39;/g,"'")) : deal;
  showAiModal('Drafting tasting follow-up for ' + d.name + '...', 'restaurant');
  try {
    const reply = await aiCall(
      `This buyer just had a tasting with us. Draft a follow-up sequence that converts this tasting into a signed contract. Be warm but create natural urgency.`,
      'tasting_followup', d
    );
    await presentAiResult(reply, 'restaurant', d.name + ' — Post-Tasting Strategy', { type: 'tasting_followup', deal_name: d.name });
    Toast.success('Tasting follow-up drafted');
  } catch(e) { showAiModal('Failed to generate — check your connection and API key.', 'error', 'Error'); Toast.error('AI call failed'); }
};

window.aiStalledRecovery = async function(deal) {
  const d = typeof deal === 'string' ? JSON.parse(deal.replace(/&quot;/g,'"').replace(/&#39;/g,"'")) : deal;
  showAiModal('Building recovery plan for ' + d.name + '...', 'restart_alt');
  try {
    const reply = await aiCall(
      `This deal has gone cold or stalled. Build a re-engagement strategy — what message, what channel, what angle will get this buyer talking again?`,
      'stalled_deal_recovery', d
    );
    await presentAiResult(reply, 'restart_alt', d.name + ' — Stalled Deal Recovery', { type: 'stalled_deal_recovery', deal_name: d.name });
    Toast.success('Recovery plan ready');
  } catch(e) { showAiModal('Failed to generate — check your connection and API key.', 'error', 'Error'); Toast.error('AI call failed'); }
};

// AI Result Modal
function showAiModal(content, icon, title) {
  let modal = $('#aiModal');
  const isLoading = !title;
  if (!modal) {
    const div = document.createElement('div');
    div.innerHTML = `
      <div id="aiModal" style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);animation:fadeIn 200ms ease;">
        <div id="aiModalInner" style="width:90%;max-width:36rem;max-height:80vh;background:#141414;border:1.5px solid rgba(201,168,76,0.2);border-radius:1rem;overflow:hidden;display:flex;flex-direction:column;animation:slideUp 250ms ease;">
          <div id="aiModalHeader" style="padding:1rem 1.2rem;border-bottom:1px solid rgba(201,168,76,0.1);display:flex;align-items:center;gap:0.6rem;">
            <span class="material-symbols-outlined" id="aiModalIcon" style="font-size:1.2rem;color:var(--gold);">${icon||'smart_toy'}</span>
            <span id="aiModalTitle" style="font-family:'Fraunces',serif;font-weight:700;font-size:0.95rem;color:var(--maroon-deep);flex:1;">${title||'Oracle is thinking...'}</span>
            <button onclick="$('#aiModal').remove()" style="background:none;border:none;color:var(--burgundy);cursor:pointer;padding:0.3rem;opacity:0.5;"><span class="material-symbols-outlined" style="font-size:1rem;">close</span></button>
          </div>
          <div id="aiModalBody" style="padding:1.2rem;overflow-y:auto;flex:1;scrollbar-width:thin;scrollbar-color:rgba(201,168,76,0.2) transparent;">
            ${isLoading
              ? '<div style="display:flex;align-items:center;gap:0.6rem;color:var(--burgundy);"><div style="display:flex;gap:0.3rem;"><div style="width:6px;height:6px;border-radius:50%;background:#C9A84C;animation:typingDot 1.4s infinite;"></div><div style="width:6px;height:6px;border-radius:50%;background:#C9A84C;animation:typingDot 1.4s infinite 0.2s;"></div><div style="width:6px;height:6px;border-radius:50%;background:#C9A84C;animation:typingDot 1.4s infinite 0.4s;"></div></div><span style="font-size:0.78rem;">' + content + '</span></div>'
              : '<div class="md-content" style="font-size:0.78rem;color:#F0E8D4;line-height:1.7;">' + renderMd(content) + '</div>'}
          </div>
          <div id="aiModalFooter" style="padding:0.8rem 1.2rem;border-top:1px solid rgba(201,168,76,0.1);display:flex;justify-content:flex-end;gap:0.4rem;">
            ${!isLoading ? '<button onclick="pinMarkdownToPreview($(\'#aiModalTitle\').textContent, $(\'#aiModalBody\').innerText);Toast.success(\'Pinned to preview\')" style="padding:0.4rem 1rem;border-radius:9999px;border:1.5px solid rgba(201,168,76,0.35);background:transparent;color:#F0E8D4;font-size:0.68rem;font-weight:700;cursor:pointer;font-family:inherit;"><span class="material-symbols-outlined" style="font-size:0.75rem;">push_pin</span> Pin</button><button onclick="navigator.clipboard.writeText($(\'#aiModalBody\').innerText);Toast.success(\'Copied to clipboard\')" style="padding:0.4rem 1rem;border-radius:9999px;border:1.5px solid #C9A84C;background:transparent;color:#C9A84C;font-size:0.68rem;font-weight:700;cursor:pointer;font-family:inherit;"><span class="material-symbols-outlined" style="font-size:0.75rem;">content_copy</span> Copy</button><button onclick="$(\'#aiModal\').remove()" style="padding:0.4rem 1rem;border-radius:9999px;border:none;background:#C9A84C;color:#0C0C0C;font-size:0.68rem;font-weight:700;cursor:pointer;font-family:inherit;">Done</button>' : ''}
          </div>
        </div>
      </div>`;
    document.body.appendChild(div.firstElementChild);
  } else {
    // Update existing modal
    const mi = $('#aiModalIcon'); if (mi) mi.textContent = icon || 'smart_toy';
    const mt = $('#aiModalTitle'); if (mt) mt.textContent = title || 'Oracle is thinking...';
    const mb = $('#aiModalBody');
    if (mb) mb.innerHTML = isLoading
      ? '<div style="display:flex;align-items:center;gap:0.6rem;color:var(--burgundy);"><div style="display:flex;gap:0.3rem;"><div style="width:6px;height:6px;border-radius:50%;background:#C9A84C;animation:typingDot 1.4s infinite;"></div><div style="width:6px;height:6px;border-radius:50%;background:#C9A84C;animation:typingDot 1.4s infinite 0.2s;"></div><div style="width:6px;height:6px;border-radius:50%;background:#C9A84C;animation:typingDot 1.4s infinite 0.4s;"></div></div><span style="font-size:0.78rem;">' + content + '</span></div>'
      : '<div class="md-content" style="font-size:0.78rem;color:#F0E8D4;line-height:1.7;">' + renderMd(content) + '</div>';
    const mf = $('#aiModalFooter');
    if (mf) mf.innerHTML = !isLoading ? '<button onclick="pinMarkdownToPreview($(\'#aiModalTitle\').textContent, $(\'#aiModalBody\').innerText);Toast.success(\'Pinned to preview\')" style="padding:0.4rem 1rem;border-radius:9999px;border:1.5px solid rgba(201,168,76,0.35);background:transparent;color:#F0E8D4;font-size:0.68rem;font-weight:700;cursor:pointer;font-family:inherit;"><span class="material-symbols-outlined" style="font-size:0.75rem;">push_pin</span> Pin</button><button onclick="navigator.clipboard.writeText($(\'#aiModalBody\').innerText);Toast.success(\'Copied to clipboard\')" style="padding:0.4rem 1rem;border-radius:9999px;border:1.5px solid #C9A84C;background:transparent;color:#C9A84C;font-size:0.68rem;font-weight:700;cursor:pointer;font-family:inherit;"><span class="material-symbols-outlined" style="font-size:0.75rem;">content_copy</span> Copy</button><button onclick="$(\'#aiModal\').remove()" style="padding:0.4rem 1rem;border-radius:9999px;border:none;background:#C9A84C;color:#0C0C0C;font-size:0.68rem;font-weight:700;cursor:pointer;font-family:inherit;">Done</button>' : '';
  }
}

function buildOracleContext() {
  const e = P.executive_summary || {};
  const topDeals = (L.high_value_deals || L.all_deals || []).slice(0, 8);
  const tasks = (T.tasks?.today || []).slice(0, 5);
  const risks = (L.risk_patterns || []).slice(0, 4);
  const gaps = (P.development_areas || []).map(g => g.area + ': ' + g.description).join('; ');

  return `[CONTEXT — Andre Raw's Current Sales State]
Pipeline: $${(L.summary?.total_pipeline||0).toLocaleString()} total, ${e.active_deals||0} active deals, ${e.won_deals||0} won, ${fmtPct(e.win_rate)} win rate
Score: 3,613 points (#1), 1.80x bonus multiplier, $52,910 90-day revenue
Top deals: ${topDeals.map(d => d.name + ' ($' + (d.value||0).toLocaleString() + ', ' + d.stage + ', ' + (d.confidence||'?') + '% conf)').join(' | ')}
Today's tasks: ${tasks.map(t => t.lead + ': ' + t.action).join(' | ')}
Risk flags: ${risks.map(r => r.flag + ' (' + r.count + ' deals)').join(', ')}
Development areas: ${gaps}
[END CONTEXT]${buildOracleDirectorContext()}`;
}

/** Injected after pipeline context — steers guided steps + tone from local HRMR signals */
function buildOracleDirectorContext() {
  const choices = ORACLE_CHOICE_LOG || [];
  const grades = ORACLE_GRADED_CORPUS || [];
  const recentC = choices.slice(-18);
  const recentG = grades.slice(-12);
  if (!recentC.length && !recentG.length) return '';
  let s = '\n\n[DIRECTOR SIGNAL — guided Oracle / HRMR]\n';
  if (recentC.length) {
    s += 'Recent one-tap actions the rep chose (oldest→newest): ' + recentC.map(c => (c.label || c.id || '?') + ' [' + (c.action || '') + ']').join(' → ') + '\n';
  }
  if (recentG.length) {
    s += 'Recent grades on Oracle replies (oldest→newest), with rep notes where given:\n';
    recentG.forEach(g => {
      s += `  • ${g.grade}${g.note ? ': "' + String(g.note).replace(/"/g, "'").slice(0, 220) + (String(g.note).length > 220 ? '…' : '') + '"' : ' (no note)'}\n`;
    });
  }
  s += 'Bias next-step suggestions toward actions they actually take; match depth/tone to their grade pattern (e.g. more concise if they rate verbosity poorly).\n[END DIRECTOR SIGNAL]';
  return s;
}

const ORACLE_NEXT_STEPS_DELIM = '---ORACLE_NEXT_STEPS---';

function parseOracleGuidedReply(raw) {
  if (!raw || typeof raw !== 'string') return { displayText: String(raw || ''), steps: [] };
  const idx = raw.indexOf(ORACLE_NEXT_STEPS_DELIM);
  if (idx === -1) return { displayText: raw.trim(), steps: [] };
  const displayText = raw.slice(0, idx).trim();
  let after = raw.slice(idx + ORACLE_NEXT_STEPS_DELIM.length).trim();
  after = after.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/m, '').trim();
  try {
    const obj = JSON.parse(after);
    const steps = Array.isArray(obj.steps)
      ? obj.steps.filter(s => s && typeof s.label === 'string' && typeof s.action === 'string')
      : [];
    return { displayText, steps };
  } catch (_) {
    return { displayText, steps: [] };
  }
}

// ═══════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════
async function loadSettings() {
  try {
    const r = await fetch(`${SERVER}/settings`);
    if (r.ok) {
      SETTINGS = await r.json();
      await IDB.set('settings', SETTINGS);
    }
  } catch(e) { console.warn('Could not load settings'); }
}

function renderSettings() {
  const ai = SETTINGS.ai || {};
  const gen = SETTINGS.general || {};
  const operator = SETTINGS.operator || {};
  const crm = SETTINGS.crm || {};
  const clickup = SETTINGS.clickup || {};
  const messaging = SETTINGS.messaging || {};
  const verification = LIVE.verification || {};
  const keySet = ai.openai_api_key_set;
  const keyPreview = ai.openai_api_key_preview || '';
  const model = ai.model || 'gpt-5.4-nano';
  const models = ai.models_available || ['gpt-5.4-nano','gpt-4.1-mini','gpt-4.1','gpt-5-mini','gpt-5'];
  const lastSyncLabel = LIVE?._meta?.last_synced ? new Date(LIVE._meta.last_synced).toLocaleString() : 'Never';

  stageScroll.innerHTML = `
    <div class="vh"><span class="label"><span class="material-symbols-outlined">settings</span> Settings</span><h2>Settings</h2><p>Configure API keys, AI models, and application preferences.</p></div>

    <!-- AI / BYOK Section -->
    <div class="panel-block settings-section" style="border-color:var(--gold);">
      <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:1rem;">
        <div style="width:2.4rem;height:2.4rem;border-radius:0.65rem;background:linear-gradient(135deg,rgba(232,180,76,0.15),rgba(232,168,56,0.05));display:flex;align-items:center;justify-content:center;">
          <span class="material-symbols-outlined" style="font-size:1.2rem;color:var(--gold);">smart_toy</span>
        </div>
        <div>
          <h2 style="margin-bottom:0;font-size:1rem;">AI Assistant — OpenAI</h2>
          <p style="font-size:0.68rem;color:var(--burgundy);opacity:0.5;margin-top:0.1rem;">Bring your own API key to enable in-app AI features.</p>
        </div>
        <div style="margin-left:auto;">
          ${keySet
            ? '<span class="settings-status settings-status--active"><span class="pulse-dot" style="background:var(--green);color:var(--green);"></span> Connected</span>'
            : '<span class="settings-status settings-status--inactive"><span class="pulse-dot" style="background:var(--coral);color:var(--coral);"></span> Not configured</span>'}
        </div>
      </div>

      <div class="settings-field">
        <label class="settings-label">OpenAI API Key</label>
        <div class="settings-key-row">
          <div class="settings-input-wrap">
            <input type="password" id="aiKeyInput" class="settings-input"
              placeholder="${keySet ? 'Key saved — enter new key to replace' : 'sk-...'}"
              value=""
              autocomplete="off" spellcheck="false" />
            <button class="settings-eye-btn" id="aiKeyToggleVis" title="Show/hide key">
              <span class="material-symbols-outlined" style="font-size:0.9rem;">visibility_off</span>
            </button>
          </div>
          <button class="settings-btn settings-btn--primary" id="aiKeySave" disabled>Save Key</button>
          ${keySet ? '<button class="settings-btn settings-btn--danger" id="aiKeyRemove">Remove</button>' : ''}
        </div>
        ${keySet ? `<div class="settings-hint" style="color:var(--green);">Current key: <code>${keyPreview}</code></div>` : '<div class="settings-hint">Your key is stored on the server only. It never leaves this machine.</div>'}
        <div id="aiKeyStatus" class="settings-key-status"></div>
      </div>

      <div class="settings-field" style="margin-top:1rem;">
        <label class="settings-label">Model</label>
        <div class="settings-select-wrap">
          <select id="aiModelSelect" class="settings-select" ${!keySet ? 'disabled' : ''}>
            ${models.map(m => `<option value="${m}" ${m === model ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </div>
        <div class="settings-hint">Choose which OpenAI model powers the AI features. Nano is cheapest, GPT-5 is most capable.</div>
      </div>

      ${keySet ? `
      <div class="settings-field" style="margin-top:1rem;">
        <label class="settings-label">Quick Test</label>
        <div class="settings-key-row">
          <input type="text" id="aiTestInput" class="settings-input" placeholder="Ask the AI something..." value="" />
          <button class="settings-btn settings-btn--primary" id="aiTestSend">Send</button>
        </div>
        <div id="aiTestResult" class="settings-test-result"></div>
      </div>
      ` : ''}
    </div>

    <!-- General Settings -->
    <div class="panel-block settings-section">
      <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:1rem;">
        <div style="width:2.4rem;height:2.4rem;border-radius:0.65rem;background:rgba(201,168,76,0.05);display:flex;align-items:center;justify-content:center;">
          <span class="material-symbols-outlined" style="font-size:1.2rem;color:var(--burgundy);">tune</span>
        </div>
        <div>
          <h2 style="margin-bottom:0;font-size:1rem;">General</h2>
          <p style="font-size:0.68rem;color:var(--burgundy);opacity:0.5;margin-top:0.1rem;">Application behavior and display settings.</p>
        </div>
      </div>

      <div class="settings-field">
        <label class="settings-label">Auto-Sync Interval (minutes)</label>
        <div class="settings-key-row">
          <input type="number" id="syncIntervalInput" class="settings-input" style="max-width:8rem;"
            value="${gen.auto_sync_interval_minutes || 15}" min="1" max="120" />
          <button class="settings-btn settings-btn--primary" id="syncIntervalSave">Update</button>
        </div>
        <div class="settings-hint">How often the app automatically syncs data from Close CRM.</div>
      </div>
    </div>

    <div class="panel-block settings-section">
      <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:1rem;">
        <div style="width:2.4rem;height:2.4rem;border-radius:0.65rem;background:rgba(201,168,76,0.05);display:flex;align-items:center;justify-content:center;">
          <span class="material-symbols-outlined" style="font-size:1.2rem;color:var(--gold);">badge</span>
        </div>
        <div>
          <h2 style="margin-bottom:0;font-size:1rem;">Andre's Live Workspace Identity</h2>
          <p style="font-size:0.68rem;color:var(--burgundy);opacity:0.5;margin-top:0.1rem;">This is the stuff that should belong to Andre, not to your machine.</p>
        </div>
      </div>
      <div class="composer-grid">
        <label class="composer-field">
          <span class="composer-label">Operator name</span>
          <input id="operatorNameInput" class="settings-input" value="${operator.name || ''}" />
        </label>
        <label class="composer-field">
          <span class="composer-label">Role</span>
          <input id="operatorRoleInput" class="settings-input" value="${operator.role || ''}" />
        </label>
        <label class="composer-field">
          <span class="composer-label">Email</span>
          <input id="operatorEmailInput" class="settings-input" value="${operator.email || ''}" />
        </label>
        <label class="composer-field">
          <span class="composer-label">Phone</span>
          <input id="operatorPhoneInput" class="settings-input" value="${operator.phone || ''}" />
        </label>
        <label class="composer-field">
          <span class="composer-label">Close user ID</span>
          <input id="closeUserIdInput" class="settings-input" value="${crm.close_user_id || ''}" placeholder="user_..." />
        </label>
        <label class="composer-field">
          <span class="composer-label">ClickUp list ID</span>
          <input id="clickupListInput" class="settings-input" value="${clickup.list_id || ''}" placeholder="List or folder ID" />
        </label>
        <label class="composer-field">
          <span class="composer-label">Email from</span>
          <input id="emailFromInput" class="settings-input" value="${messaging.email_from || ''}" placeholder="andre@company.com" />
        </label>
        <label class="composer-field">
          <span class="composer-label">SMS from</span>
          <input id="smsFromInput" class="settings-input" value="${messaging.sms_from || ''}" placeholder="+1..." />
        </label>
      </div>
      <div class="settings-key-row" style="margin-top:1rem;">
        <button class="settings-btn settings-btn--primary" id="workspaceIdentitySave">Save Workspace Identity</button>
      </div>
      <div class="settings-hint">These values now live in machine-local settings so Andre can have his own CRM user, ClickUp target, phone, and email.</div>
    </div>

    <div class="panel-block settings-section">
      <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:1rem;">
        <div style="width:2.4rem;height:2.4rem;border-radius:0.65rem;background:rgba(107,191,150,0.1);display:flex;align-items:center;justify-content:center;">
          <span class="material-symbols-outlined" style="font-size:1.2rem;color:var(--green);">verified</span>
        </div>
        <div>
          <h2 style="margin-bottom:0;font-size:1rem;">Freshness + source check</h2>
          <p style="font-size:0.68rem;color:var(--burgundy);opacity:0.5;margin-top:0.1rem;">Last Close sync time and the current live source status for Andre's file-backed CRM snapshots.</p>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.5rem;">
        <div class="settings-connection-row" style="display:block;">
          <div style="font-size:0.62rem;color:var(--burgundy);opacity:0.6;">Last sync</div>
          <div style="font-weight:700;font-size:0.82rem;">${lastSyncLabel}</div>
        </div>
        <div class="settings-connection-row" style="display:block;">
          <div style="font-size:0.62rem;color:var(--burgundy);opacity:0.6;">Source status</div>
          <div style="font-weight:700;font-size:0.82rem;text-transform:capitalize;">${verification.status || 'unknown'}</div>
        </div>
        <div class="settings-connection-row" style="display:block;">
          <div style="font-size:0.62rem;color:var(--burgundy);opacity:0.6;">Coverage</div>
          <div style="font-weight:700;font-size:0.82rem;">${verification.coverage_pct != null ? verification.coverage_pct + '%' : '—'}</div>
        </div>
        <div class="settings-connection-row" style="display:block;">
          <div style="font-size:0.62rem;color:var(--burgundy);opacity:0.6;">Checked rows</div>
          <div style="font-weight:700;font-size:0.82rem;">${verification.matched_deal_count != null && verification.live_unique_lead_names != null ? `${verification.matched_deal_count} / ${verification.live_unique_lead_names}` : verification.matched_deal_count != null ? String(verification.matched_deal_count) : '—'}</div>
        </div>
      </div>
      <div class="settings-hint" style="margin-top:0.65rem;line-height:1.45;">Close returned <strong>${verification.live_opportunity_count != null ? verification.live_opportunity_count : (LIVE.pipeline_snapshot?.total_active_opportunities ?? '—')}</strong> active opportunities. Pipeline and task intelligence are refreshed through <code style="font-size:0.6rem;">/api/live/*</code> from the Close-direct file tree.</div>
      ${verification.notes?.length ? `<div class="settings-hint" style="margin-top:0.5rem;">${verification.notes.map(n => String(n).replace(/</g, '&lt;')).join(' ')}</div>` : ''}
    </div>

    <!-- Connection Status -->
    <div class="panel-block settings-section">
      <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:1rem;">
        <div style="width:2.4rem;height:2.4rem;border-radius:0.65rem;background:rgba(107,191,150,0.1);display:flex;align-items:center;justify-content:center;">
          <span class="material-symbols-outlined" style="font-size:1.2rem;color:var(--green);">cable</span>
        </div>
        <div>
          <h2 style="margin-bottom:0;font-size:1rem;">Connections</h2>
          <p style="font-size:0.68rem;color:var(--burgundy);opacity:0.5;margin-top:0.1rem;">Status of external service integrations.</p>
        </div>
      </div>
      <div style="display:grid;gap:0.5rem;">
        <div class="settings-connection-row">
          <span class="material-symbols-outlined" style="font-size:1rem;color:var(--rose);">cloud</span>
          <span style="font-weight:600;font-size:0.78rem;">Close CRM</span>
          <span style="margin-left:auto;">${serverOnline ? '<span class="settings-status settings-status--active"><span class="pulse-dot" style="background:var(--green);color:var(--green);"></span> Connected</span>' : '<span class="settings-status settings-status--inactive"><span class="pulse-dot" style="background:var(--coral);color:var(--coral);"></span> Offline</span>'}</span>
        </div>
        <div class="settings-connection-row">
          <span class="material-symbols-outlined" style="font-size:1rem;color:var(--gold);">smart_toy</span>
          <span style="font-weight:600;font-size:0.78rem;">OpenAI API</span>
          <span style="margin-left:auto;">${keySet ? `<span class="settings-status settings-status--active"><span class="pulse-dot" style="background:var(--green);color:var(--green);"></span> ${model}</span>` : '<span class="settings-status settings-status--inactive"><span class="pulse-dot" style="background:var(--coral);color:var(--coral);"></span> No key</span>'}</span>
        </div>
        <div class="settings-connection-row">
          <span class="material-symbols-outlined" style="font-size:1rem;color:var(--cyan);">dns</span>
          <span style="font-weight:600;font-size:0.78rem;">Command Server</span>
          <span style="margin-left:auto;">${serverOnline ? '<span class="settings-status settings-status--active"><span class="pulse-dot" style="background:var(--green);color:var(--green);"></span> localhost:3141</span>' : '<span class="settings-status settings-status--inactive"><span class="pulse-dot" style="background:var(--coral);color:var(--coral);"></span> Offline</span>'}</span>
        </div>
      </div>
    </div>

    <div class="mc-footer">Settings are stored locally on this server instance. API keys never leave this machine.</div>
  `;

  // Wire up event handlers after render
  setTimeout(wireSettingsHandlers, 0);
}

function wireSettingsHandlers() {
  const keyInput   = $('#aiKeyInput');
  const saveBtn    = $('#aiKeySave');
  const removeBtn  = $('#aiKeyRemove');
  const toggleVis  = $('#aiKeyToggleVis');
  const modelSel   = $('#aiModelSelect');
  const statusEl   = $('#aiKeyStatus');
  const testInput  = $('#aiTestInput');
  const testBtn    = $('#aiTestSend');
  const testResult = $('#aiTestResult');
  const syncInput  = $('#syncIntervalInput');
  const syncBtn    = $('#syncIntervalSave');
  const workspaceBtn = $('#workspaceIdentitySave');

  if (!keyInput) return;

  // Enable save when key has content
  keyInput.addEventListener('input', () => {
    saveBtn.disabled = keyInput.value.trim().length < 3;
  });

  // Toggle visibility
  if (toggleVis) {
    toggleVis.addEventListener('click', () => {
      const isPass = keyInput.type === 'password';
      keyInput.type = isPass ? 'text' : 'password';
      toggleVis.querySelector('.material-symbols-outlined').textContent = isPass ? 'visibility' : 'visibility_off';
    });
  }

  // Save key
  saveBtn.addEventListener('click', async () => {
    const key = keyInput.value.trim();
    if (!key) return;
    saveBtn.textContent = 'Validating...';
    saveBtn.disabled = true;
    statusEl.innerHTML = '<span style="color:var(--amber);">Checking key with OpenAI...</span>';

    try {
      const vr = await fetch(`${SERVER}/ai/validate-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key })
      }).then(r => r.json());

      if (vr.valid) {
        await fetch(`${SERVER}/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ai: { openai_api_key: key } })
        });
        statusEl.innerHTML = '<span style="color:var(--green);font-weight:600;">Key saved and validated.</span>';
        await loadSettings();
        setTimeout(() => renderSettings(), 800);
      } else {
        statusEl.innerHTML = '<span style="color:var(--coral);font-weight:600;">Invalid key: ' + (vr.error || 'Unknown error') + '</span>';
        saveBtn.textContent = 'Save Key';
        saveBtn.disabled = false;
      }
    } catch(e) {
      statusEl.innerHTML = '<span style="color:var(--coral);">Connection error: ' + e.message + '</span>';
      saveBtn.textContent = 'Save Key';
      saveBtn.disabled = false;
    }
  });

  // Remove key
  if (removeBtn) {
    removeBtn.addEventListener('click', async () => {
      if (!confirm('Remove your OpenAI API key? AI features will be disabled.')) return;
      await fetch(`${SERVER}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai: { openai_api_key: '' } })
      });
      await loadSettings();
      renderSettings();
    });
  }

  // Model change
  if (modelSel) {
    modelSel.addEventListener('change', async () => {
      await fetch(`${SERVER}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai: { model: modelSel.value } })
      });
      await loadSettings();
      statusEl.innerHTML = `<span style="color:var(--green);">Model updated to ${modelSel.value}</span>`;
      setTimeout(() => { if (statusEl) statusEl.innerHTML = ''; }, 2000);
    });
  }

  // Quick test
  if (testBtn && testInput) {
    const sendTest = async () => {
      const msg = testInput.value.trim();
      if (!msg) return;
      testBtn.disabled = true;
      testBtn.textContent = 'Thinking...';
      testResult.innerHTML = '<span style="color:var(--amber);">Sending to OpenAI...</span>';

      try {
        const r = await fetch(`${SERVER}/ai/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: msg }]
          })
        });
        const data = await r.json();
        if (data.error) {
          testResult.innerHTML = `<span style="color:var(--coral);">Error: ${data.error}</span>`;
        } else {
          const text = data.output_text || data.output?.[0]?.content?.[0]?.text || JSON.stringify(data.output);
          testResult.innerHTML = `<div class="settings-test-response">${text}</div>`;
        }
      } catch(e) {
        testResult.innerHTML = `<span style="color:var(--coral);">Error: ${e.message}</span>`;
      }
      testBtn.disabled = false;
      testBtn.textContent = 'Send';
    };

    testBtn.addEventListener('click', sendTest);
    testInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendTest(); });
  }

  // Sync interval
  if (syncBtn && syncInput) {
    syncBtn.addEventListener('click', async () => {
      const val = parseInt(syncInput.value);
      if (isNaN(val) || val < 1 || val > 120) return;
      await fetch(`${SERVER}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ general: { auto_sync_interval_minutes: val } })
      });
      syncBtn.textContent = 'Saved!';
      setTimeout(() => { syncBtn.textContent = 'Update'; }, 1500);
    });
  }

  if (workspaceBtn) {
    workspaceBtn.addEventListener('click', async () => {
      workspaceBtn.textContent = 'Saving...';
      await fetch(`${SERVER}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operator: {
            name: $('#operatorNameInput')?.value || '',
            role: $('#operatorRoleInput')?.value || '',
            email: $('#operatorEmailInput')?.value || '',
            phone: $('#operatorPhoneInput')?.value || '',
          },
          crm: {
            close_user_id: $('#closeUserIdInput')?.value || '',
          },
          clickup: {
            list_id: $('#clickupListInput')?.value || '',
            enabled: Boolean($('#clickupListInput')?.value),
          },
          messaging: {
            email_from: $('#emailFromInput')?.value || '',
            sms_from: $('#smsFromInput')?.value || '',
            enabled: Boolean($('#emailFromInput')?.value || $('#smsFromInput')?.value),
          }
        })
      });
      await loadSettings();
      workspaceBtn.textContent = 'Saved!';
      Toast.success('Workspace identity updated');
      setTimeout(() => { workspaceBtn.textContent = 'Save Workspace Identity'; }, 1500);
    });
  }
}

// ═══════════════════════════════════════
// SERVER + LIVE DATA
// ═══════════════════════════════════════
// Use same-origin URLs when the UI is served by Express (local :3141 or Render).
// Only pin to :3141 when the static UI is opened from another dev port (e.g. Live Server).
const SERVER = (() => {
  if (typeof window === 'undefined') return '';
  const { hostname, port } = window.location;
  const local = hostname === 'localhost' || hostname === '127.0.0.1';
  if (!local) return '';
  if (port === '3141') return '';
  return `http://${hostname}:3141`;
})();
let LIVE = {}; // live_close_crm.json
let Q    = {}; // action_queue.json
/** Aggregated Close “inbox-class” intel (tasks + triage comms) from GET /close/inbox/snapshot */
let CLOSE_INBOX = null;
/** Design-only automation flow; persisted in localStorage */
let automationBlueprintState = { catalog: null, steps: [] };
let serverOnline = false;

async function loadJSON(path) {
  try { const r = await fetch(path, {cache:'no-store'}); if (!r.ok) throw new Error(); return r.json(); }
  catch(e) { console.warn('Failed to load', path); return {}; }
}

async function loadText(path) {
  try {
    const r = await fetch(path, { cache:'no-store' });
    if (!r.ok) throw new Error();
    return r.text();
  } catch(e) {
    console.warn('Failed to load text', path);
    return '';
  }
}

async function refreshAutomationStatus() {
  if (!serverOnline) return;
  try {
    AUT = await fetch(`${SERVER}/automation/status`, { cache:'no-store' }).then(r => r.json());
    if (currentView === 'automation') renderAutomation();
  } catch(e) {
    console.warn('Failed to load automation status');
  }
}

async function checkServer() {
  const wasOnline = serverOnline;
  try {
    const r = await fetch(`${SERVER}/status`, { signal: AbortSignal.timeout(1500) });
    serverOnline = r.ok;
  } catch(e) { serverOnline = false; }
  updateServerBadge();
  if (serverOnline && !wasOnline) {
    loadAppSurfaceMap();
    loadCloseInboxSnapshot();
    if (currentView === 'command') renderCommand();
  }
}

function updateServerBadge() {
  const el = $('#serverStatus');
  if (!el) return;
  if (serverOnline) {
    el.innerHTML = `<span class="pulse-dot" style="background:var(--green);color:var(--green);"></span> Live`;
    el.style.color = 'var(--green)';
  } else {
    el.innerHTML = `<span class="pulse-dot" style="background:var(--coral);color:var(--coral);"></span> Offline`;
    el.style.color = 'var(--coral)';
  }
}

function updateDataFreshness() {
  const el = $('#dataFreshness');
  if (!el) return;
  const syncedAt = LIVE?._meta?.last_synced;
  const verification = LIVE?.verification || {};
  if (!syncedAt) {
    el.textContent = 'No sync yet';
    el.removeAttribute('title');
    return;
  }
  const pct = verification.coverage_pct;
  const matched = verification.matched_deal_count;
  const unique = verification.live_unique_lead_names;
  const coverage = pct != null
    ? `${pct}% source coverage${matched != null && unique != null ? ` (${matched}/${unique} checked)` : ''}`
    : 'source check ready';
  el.textContent = `${timeAgo(syncedAt)} sync · ${coverage}`;
  el.title = 'Live source check: pipeline, task, and snapshot data now come from the Close-direct file tree through /api/live/* endpoints.';
  el.style.color = verification.status === 'critical'
    ? 'var(--coral)'
    : verification.status === 'warning'
      ? 'var(--amber)'
      : 'var(--burgundy)';
}

function todayKey() {
  return new Date().toISOString().substring(0, 10);
}

function getTodayOps() {
  return OPS.daily?.[todayKey()] || {
    summary: '',
    what_happened: [],
    what_we_learned: [],
    what_we_added: [],
    what_it_affected: [],
    wins: [],
    help_signals: [],
    bottlenecks: [],
    metrics: {},
  };
}

function renderOpsList(items, emptyLabel) {
  if (!items?.length) return `<div style="font-size:0.68rem;color:var(--burgundy);opacity:0.5;">${emptyLabel}</div>`;
  return items.slice(0, 5).map(item => `<div class="q-item" style="margin-bottom:0.3rem;"><div class="q-item-sub" style="font-size:0.68rem;color:var(--maroon);opacity:0.82;">${item}</div></div>`).join('');
}

async function saveOpsNote(payload) {
  const r = await fetch(`${SERVER}/ops/note`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Could not save ops note');
  OPS = await fetch(`${SERVER}/ops`, { cache: 'no-store' }).then(res => res.json());
  await IDB.set('ops', OPS);
  return data;
}

async function queueAction(type, payload) {
  if (!serverOnline) {
    Toast.warning('Server offline — start the server with: node server.js');
    return null;
  }
  try {
    const r = await fetch(`${SERVER}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload })
    });
    const data = await r.json();
    await refreshQueue();
    return data.action;
  } catch(e) {
    console.error('Failed to queue action', e);
    return null;
  }
}

async function refreshQueue() {
  if (!serverOnline) return;
  try {
    Q = await fetch(`${SERVER}/queue`).then(r => r.json());
    renderQueueStatus();
  } catch(e) {}
}

function renderQueueStatus() {
  const el = $('#queueStatus');
  if (!el) return;
  const pending = Q.pending?.length || 0;
  const done = Q.completed?.length || 0;
  el.innerHTML = pending > 0
    ? `<span style="color:var(--amber);font-weight:700;">${pending} pending</span> · ${done} done`
    : `<span style="color:var(--green);">Queue clear</span> · ${done} done`;
}

// ═══════════════════════════════════════
// BOOT
// ═══════════════════════════════════════
async function boot() {
  // Show loading skeleton
  stageScroll.innerHTML = `
    <div style="animation:fadeIn 300ms ease;">
      <div style="height:8rem;border-radius:1.2rem;background:linear-gradient(90deg,#1A1A1A 25%,#222 50%,#1A1A1A 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;margin-bottom:1.2rem;"></div>
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:0.55rem;margin-bottom:1.2rem;">
        ${[1,2,3,4,5,6].map(() => '<div style="height:6rem;border-radius:1.2rem;background:linear-gradient(90deg,#1A1A1A 25%,#222 50%,#1A1A1A 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;"></div>').join('')}
      </div>
      <div style="height:4rem;border-radius:0.9rem;background:linear-gradient(90deg,#1A1A1A 25%,#222 50%,#1A1A1A 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;margin-bottom:0.8rem;"></div>
      <div style="height:12rem;border-radius:1.2rem;background:linear-gradient(90deg,#1A1A1A 25%,#222 50%,#1A1A1A 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;"></div>
    </div>
  `;

  // Try IndexedDB cache first for instant render
  const hasCached = await IDB.loadFromCache();
  await loadAiPersistence();
  if (hasCached) {
    showView('command');
    console.log('[BOOT] Rendered from cache — fetching fresh data in background...');
  }

  // Fetch fresh data from server.
  // Pipeline + tasks + live snapshot are now served through /api/live/*.
  // Everything else still comes from the data/ JSON files (file-watched).
  try {
    const [profile, kpis, pipeline, tasks, ops, templates, cadences, scenarios, live, queue, activity, voiceSummary, voiceReadme] = await Promise.all([
      loadJSON(`${SERVER}/data/andre_profile.json`),
      loadJSON(`${SERVER}/data/andre_kpis.json`),
      loadJSON(`${SERVER}/api/live/pipeline`),
      loadJSON(`${SERVER}/api/live/tasks`),
      loadJSON(`${SERVER}/data/ops_tracker.json`),
      loadJSON(`${SERVER}/data/oracle_templates.json`),
      loadJSON(`${SERVER}/data/oracle_cadences.json`),
      loadJSON(`${SERVER}/data/oracle_scenarios.json`),
      loadJSON(`${SERVER}/api/live/snapshot`),
      loadJSON(`${SERVER}/data/action_queue.json`),
      loadJSON(`${SERVER}/data/activity_log.json`),
      loadText(`${SERVER}/data/andre_language_map/ANDRE_STRATEGIC_VOICE_SUMMARY.md`),
      loadText(`${SERVER}/data/andre_language_map/ASSETS_README.md`),
    ]);
    [P, K, L, T, OPS, OT, OC, OS, LIVE, Q, ACT] = [profile, kpis, pipeline, tasks, ops, templates, cadences, scenarios, live, queue, activity];
    DOCS = { voiceSummary, voiceReadme };
    // Cache to IndexedDB for next load
    await IDB.cacheAll();
  } catch(e) {
    console.warn('[BOOT] Server fetch failed, using cached data', e);
  }

  await checkServer();
  await loadSettings();
  await refreshAutomationStatus();
  await loadAppSurfaceMap();
  await loadCloseInboxSnapshot();
  loadAutomationBlueprintFromStorage();
  updateDataFreshness();
  setInterval(checkServer, 15000);
  setInterval(refreshQueue, 30000);
  setInterval(refreshAutomationStatus, 30000);
  setInterval(loadCloseInboxSnapshot, 120000);
  // Re-cache every 5 minutes
  setInterval(() => IDB.cacheAll(), 5 * 60 * 1000);
  showView('command');

  // Connect to live data stream (SSE)
  connectDataStream();
}

// ═══════════════════════════════════════
// LIVE DATA STREAM (Server-Sent Events)
// When any data file in data/ changes on disk,
// the server pushes an event → we refetch that
// specific file and re-render the current view.
// This makes data/ the source of truth for all tools.
// ═══════════════════════════════════════
// Each slot can fetch from either a static data/ file (legacy)
// or a live API endpoint (Close file-tree backed by default). The `path` field is
// what gets fetched on refresh, so live slots stay live.
const SLOT_MAP = {
  profile:   { var: () => P,    set: v => { P = v; },    path: '/data/andre_profile.json' },
  kpis:      { var: () => K,    set: v => { K = v; },    path: '/data/andre_kpis.json' },
  pipeline:  { var: () => L,    set: v => { L = v; },    path: '/api/live/pipeline' },
  tasks:     { var: () => T,    set: v => { T = v; },    path: '/api/live/tasks' },
  ops:       { var: () => OPS,  set: v => { OPS = v; },  path: '/data/ops_tracker.json' },
  templates: { var: () => OT,   set: v => { OT = v; },   path: '/data/oracle_templates.json' },
  cadences:  { var: () => OC,   set: v => { OC = v; },   path: '/data/oracle_cadences.json' },
  scenarios: { var: () => OS,   set: v => { OS = v; },   path: '/data/oracle_scenarios.json' },
  live:      { var: () => LIVE, set: v => { LIVE = v; }, path: '/api/live/snapshot' },
  queue:     { var: () => Q,    set: v => { Q = v; },    path: '/data/action_queue.json' },
  settings:  { var: () => SETTINGS, set: v => { SETTINGS = v; }, path: '/data/settings.json' },
  activity:  { var: () => ACT,  set: v => { ACT = v; },  path: '/data/activity_log.json' },
};

function connectDataStream() {
  if (typeof EventSource === 'undefined') return; // no SSE support
  const es = new EventSource(`${SERVER}/events`);
  let reconnectDelay = 1000;

  es.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'connected') {
        console.log('[SSE] Connected to live data stream');
        reconnectDelay = 1000;
        return;
      }
      const slotCfg = SLOT_MAP[msg.slot];
      if (!slotCfg) return;

      console.log(`[SSE] ${msg.file} changed — refreshing ${msg.slot}`);
      try {
        const fresh = msg.slot === 'settings'
          ? await fetch(`${SERVER}/settings`, { cache: 'no-store' }).then(r => r.json())
          : await loadJSON(`${SERVER}${slotCfg.path}`);
        slotCfg.set(fresh);
        await IDB.set(msg.slot, fresh);

        // Close sync mirrors live_close_crm.json -> SSE slot `live`. Refresh all three
        // live slots so command/deals/actions stay aligned after each sweep.
        if (msg.slot === 'live') {
          const [p, t, snap] = await Promise.all([
            loadJSON(`${SERVER}/api/live/pipeline`),
            loadJSON(`${SERVER}/api/live/tasks`),
            loadJSON(`${SERVER}/api/live/snapshot`),
          ]);
          SLOT_MAP.pipeline.set(p);
          SLOT_MAP.tasks.set(t);
          SLOT_MAP.live.set(snap);
          await IDB.set('pipeline', p);
          await IDB.set('tasks', t);
          await IDB.set('live', snap);
        }

        updateDataFreshness();

        const viewDataDeps = {
          command: ['profile','kpis','pipeline','tasks','live','ops'],
          pipeline: ['pipeline','scenarios'],
          actions: ['tasks'],
          performance: ['kpis','scenarios'],
          coaching: ['profile','tasks','cadences','templates'],
          deals: ['pipeline','scenarios'],
          automation: ['tasks','cadences','live','queue','templates','ops'],
          oracle: ['settings'],
          settings: ['settings'],
          timeline: ['activity','pipeline','tasks','ops'],
        };
        const deps = viewDataDeps[currentView] || [];
        const touched = msg.slot === 'live' ? ['live', 'pipeline', 'tasks'] : [msg.slot];
        if (touched.some(s => deps.includes(s))) {
          showView(currentView);
          Toast.info(`Data updated: ${msg.slot}`);
        }
      } catch(e) {
        console.warn(`[SSE] Failed to refresh ${msg.file}:`, e.message);
      }
    } catch(e) { /* ignore parse errors */ }
  };

  es.onerror = () => {
    console.warn('[SSE] Connection lost — reconnecting in', reconnectDelay + 'ms');
    es.close();
    setTimeout(connectDataStream, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000); // exponential backoff, max 30s
  };
}

const openPaletteBtn = $('#openCommandPaletteBtn');
if (openPaletteBtn) openPaletteBtn.addEventListener('click', () => openCommandPalette());

// Theme toggle (Lucide icons)
$('#themeToggle').addEventListener('click', () => {
  document.body.classList.toggle('dark');
  const lucideEl = $('#themeToggle').querySelector('[data-lucide]');
  if (lucideEl) {
    lucideEl.setAttribute('data-lucide', document.body.classList.contains('dark') ? 'sun' : 'moon');
    if (window.lucide) lucide.createIcons();
  }
});

$('#openSettingsBtn')?.addEventListener('click', () => {
  $$('.sb-btn').forEach(b => b.classList.remove('active'));
  showView('settings');
});

// ═══════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const pal = $('#commandPalette');
    if (pal && pal.style.display === 'flex') {
      e.preventDefault();
      closeCommandPalette();
      return;
    }
  }

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    toggleCommandPalette();
    return;
  }

  // Don't trigger view shortcuts when typing in an input/textarea
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  const key = e.key.toLowerCase();
  const shortcuts = {
    '1': 'command',  '2': 'pipeline', '3': 'actions',
    '4': 'performance', '5': 'coaching', '6': 'deals',
    '7': 'automation', '8': 'timeline', '9': 'oracle',
  };

  if (shortcuts[key]) {
    e.preventDefault();
    $$('.sb-btn').forEach(b => b.classList.remove('active'));
    const target = $(`.sb-btn[data-view="${shortcuts[key]}"]`);
    if (target) target.classList.add('active');
    showView(shortcuts[key]);
    return;
  }

  // S = Settings
  if (key === 's' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    $$('.sb-btn').forEach(b => b.classList.remove('active'));
    showView('settings');
    return;
  }

  // ? = show shortcut help
  if (key === '?' || (e.shiftKey && key === '/')) {
    e.preventDefault();
    Toast.info('Keys: ⌘K search · 1-9 views · S = settings · / = Oracle · ? = help', 5000);
    return;
  }

  // / = focus Oracle input
  if (key === '/' && !e.shiftKey) {
    e.preventDefault();
    if (currentView !== 'oracle') {
      $$('.sb-btn').forEach(b => b.classList.remove('active'));
      const target = $(`.sb-btn[data-view="oracle"]`);
      if (target) target.classList.add('active');
      showView('oracle');
    }
    setTimeout(() => { const inp = $('#oracleInput'); if (inp) inp.focus(); }, 100);
    return;
  }
});

boot();
