#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXPORT_DIR = path.join(ROOT, 'data', 'andre_close_focus', 'saved_views_export');
const OUT_DIR = path.join(ROOT, 'data', 'andre_close_focus', 'lattice_catalog');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(path.join(EXPORT_DIR, file), 'utf8'));
}

function writeJSONTxt(name, data) {
  fs.writeFileSync(path.join(OUT_DIR, name), `${JSON.stringify(data, null, 2)}\n`);
}

function isoNow() {
  return new Date().toISOString();
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(Number(n) || 0)));
}

function dateMs(value) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function daysSince(value) {
  const ms = dateMs(value);
  if (ms == null) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / 86400000));
}

function latestDate(values) {
  const valid = values.map(dateMs).filter(v => v != null).sort((a, b) => b - a);
  return valid[0] ? new Date(valid[0]).toISOString() : null;
}

function firstDate(values) {
  const valid = values.map(dateMs).filter(v => v != null).sort((a, b) => a - b);
  return valid[0] ? new Date(valid[0]).toISOString() : null;
}

function id(prefix, parts) {
  return `${prefix}_${parts.filter(Boolean).join('_')}`.replace(/[^a-zA-Z0-9_:-]+/g, '_').slice(0, 180);
}

function textHas(text, words) {
  const s = String(text || '').toLowerCase();
  return words.some(w => s.includes(w));
}

function classifyText(text) {
  const s = String(text || '').toLowerCase();
  return {
    intent: [
      textHas(s, ['quote', 'proposal', 'pricing', 'price']) ? 'quote_discussion' : null,
      textHas(s, ['tasting', 'sample']) ? 'tasting_interest' : null,
      textHas(s, ['book', 'reserve', 'confirm', 'deposit']) ? 'booking_intent' : null,
      textHas(s, ['wedding', 'corporate', 'church', 'birthday', 'party']) ? 'event_context' : null,
    ].filter(Boolean),
    objections: [
      textHas(s, ['budget', 'expensive', 'price', 'cost']) ? 'budget' : null,
      textHas(s, ['date', 'timing', 'soon', 'available']) ? 'timing' : null,
      textHas(s, ['menu', 'guest', 'people', 'venue', 'location']) ? 'scope_or_logistics' : null,
    ].filter(Boolean),
    commitment: [
      textHas(s, ['yes', 'confirm', 'book', 'deposit', 'tasting']) ? 'positive_commitment' : null,
      textHas(s, ['sent', 'attached', 'quote']) ? 'quote_sent_or_discussed' : null,
    ].filter(Boolean),
  };
}

function scoreLead(lead, activities, tasks) {
  const allActs = [
    ...arr(activities.activities?.emails),
    ...arr(activities.activities?.sms),
    ...arr(activities.activities?.calls),
    ...arr(activities.activities?.notes),
  ];
  const lastActivity = latestDate(allActs.map(a => a.activity_at || a.date_created));
  const recencyDays = daysSince(lastActivity);
  const inbound = allActs.filter(a => a.direction === 'inbound').length;
  const outbound = allActs.filter(a => a.direction === 'outbound' || a.status === 'sent').length;
  const hasPhone = lead.contacts?.some(c => c.phones?.length);
  const hasEmail = lead.contacts?.some(c => c.emails?.length);
  const openTasks = arr(tasks).filter(t => !t.is_complete);
  const viewNames = arr(lead.saved_view_names).join(' ');
  const value = Number(lead.opportunity_value_total || 0);
  const urgency = clamp((viewNames.includes('Today') ? 90 : 45) + (viewNames.includes('Needs Response') ? 35 : 0) + (openTasks.length * 8) - ((recencyDays || 0) * 2));
  const momentum = clamp(30 + inbound * 8 + outbound * 2 + (viewNames.includes('Booked Tastings') ? 35 : 0) - ((recencyDays || 0) * 3));
  const friction = clamp((!hasPhone ? 25 : 0) + (!hasEmail ? 20 : 0) + (viewNames.includes('Dormant') ? 35 : 0) + (viewNames.includes('No Connect') ? 25 : 0));
  const relationship = clamp(30 + Math.min(35, inbound * 7) + Math.min(20, arr(activities.activities?.calls).length * 4));
  const closeProbability = clamp(lead.opportunities?.some(o => String(o.status_label || '').toLowerCase().includes('tasting')) ? 75 : 35 + momentum * 0.25 - friction * 0.2);
  const revenueValue = clamp(value ? Math.min(100, value / 150) : 20);
  const attentionCost = clamp(30 + openTasks.length * 8 + friction * 0.35);
  const nextActionClarity = clamp(openTasks.length ? 80 : viewNames.includes('No Connect') ? 65 : 45);
  const priorityScore = clamp(0.24 * urgency + 0.18 * revenueValue + 0.18 * closeProbability + 0.14 * momentum + 0.10 * relationship + 0.10 * nextActionClarity - 0.06 * friction - 0.12 * attentionCost);
  const saveabilityScore = clamp(0.30 * relationship + 0.25 * momentum + 0.20 * revenueValue + 0.20 * nextActionClarity + 0.15 * urgency - 0.20 * friction);
  const decayRiskScore = clamp(0.34 * urgency + 0.24 * friction + 0.18 * (100 - momentum) + 0.14 * (100 - relationship) + 0.10 * (100 - nextActionClarity));
  const actionNowScore = clamp(0.30 * urgency + 0.20 * nextActionClarity + 0.20 * momentum + 0.15 * closeProbability + 0.10 * revenueValue - 0.15 * attentionCost);
  return {
    urgency, momentum, friction,
    relationship_strength: relationship,
    close_probability: closeProbability,
    revenue_value: revenueValue,
    attention_cost: attentionCost,
    next_action_clarity: nextActionClarity,
    priority_score: priorityScore,
    saveability_score: saveabilityScore,
    decay_risk_score: decayRiskScore,
    action_now_score: actionNowScore,
  };
}

function nextActionFor(lead, score, activities, tasks) {
  const openTasks = arr(tasks).filter(t => !t.is_complete);
  const hasPhone = lead.contacts?.some(c => c.phones?.length);
  const hasEmail = lead.contacts?.some(c => c.emails?.length);
  const viewNames = arr(lead.saved_view_names).join(' ');
  if (viewNames.includes('Needs Response')) return ['send_sms', 'Reply to inbound message', 'sms'];
  if (viewNames.includes('Booked Tastings')) return ['confirm_event_details', 'Confirm tasting details and next step', hasPhone ? 'sms' : 'email'];
  if (openTasks[0]) return ['schedule_follow_up', openTasks[0].text || 'Complete open Close task', hasPhone ? 'call' : 'email'];
  if (viewNames.includes('No Connect')) return [hasPhone ? 'call_now' : 'send_email', 'Make first real connection attempt', hasPhone ? 'call' : 'email'];
  if (viewNames.includes('Dormant')) return ['reactivate_lead', 'Send reactivation follow-up', hasEmail ? 'email' : 'sms'];
  if (score.decay_risk_score > 65) return ['review_manually', 'Review lead before decay risk increases', null];
  return [hasPhone ? 'send_sms' : 'send_email', 'Send concise follow-up', hasPhone ? 'sms' : 'email'];
}

function build() {
  ensureDir(OUT_DIR);
  const generatedAt = isoNow();
  const summary = readJSON('summary.json');
  const leads = readJSON('leads.json');
  const contacts = readJSON('contacts.json');
  const activitiesByLead = readJSON('activities_by_lead.json');
  const savedViews = readJSON('saved_views.json');

  const tasks = [];
  const emails = [];
  const sms = [];
  const calls = [];
  const notes = [];
  const conversations = [];
  const opportunities = [];
  const signalEvents = [];
  const nextBestActions = [];
  const leadContacts = [];
  const actionLog = [];

  const contactByLead = new Map();
  for (const c of contacts) {
    if (!contactByLead.has(c.lead_id)) contactByLead.set(c.lead_id, []);
    contactByLead.get(c.lead_id).push(c);
  }

  for (const lead of leads) {
    const enrichment = activitiesByLead[lead.id] || {};
    const leadTasks = arr(enrichment.tasks);
    const leadScore = scoreLead(lead, enrichment, leadTasks);
    const [actionType, actionTitle, channel] = nextActionFor(lead, leadScore, enrichment, leadTasks);
    const conversationId = id('conv', [lead.id]);

    for (const contact of arr(contactByLead.get(lead.id))) {
      leadContacts.push({
        lead_contact_id: id('lead_contact', [lead.id, contact.contact_id]),
        lead_id: lead.id,
        contact_id: contact.contact_id,
        role_label: contact.title || null,
        is_primary: contact.contact_id === lead.contacts?.[0]?.contact_id,
        is_decision_maker: null,
        is_champion: leadScore.relationship_strength >= 60,
        is_blocker: false,
        first_contacted_at: null,
        last_contacted_at: latestDate([
          ...arr(enrichment.activities?.emails).map(a => a.activity_at),
          ...arr(enrichment.activities?.sms).map(a => a.activity_at),
          ...arr(enrichment.activities?.calls).map(a => a.activity_at),
        ]),
        created_at: lead.date_created,
        updated_at: lead.date_updated,
      });
    }

    for (const opp of arr(lead.opportunities)) {
      opportunities.push({
        opportunity_id: opp.id,
        lead_id: lead.id,
        owner_user_id: 'andre',
        title: opp.contact_name || lead.name,
        status: opp.status_type || 'active',
        stage: opp.status_label || null,
        pipeline: opp.pipeline_id || null,
        estimated_value: opp.value || 0,
        probability_percent: opp.confidence || 0,
        event_date: opp.close_at || null,
        close_date_target: opp.close_at || null,
        primary_contact_id: opp.contact_id || null,
        next_step_text: actionTitle,
        next_step_due_at: leadTasks[0]?.due_date || null,
        last_stage_change_at: opp.date_updated || null,
        last_activity_at: latestDate(arr(enrichment.activities?.general).map(a => a.activity_at)),
        created_at: opp.date_created || lead.date_created,
        updated_at: opp.date_updated || lead.date_updated,
        archived: false,
        sales_scoring: leadScore,
      });
    }

    for (const task of leadTasks) {
      const dueMs = dateMs(task.due_date || task.date);
      const now = Date.now();
      tasks.push({
        task_id: task.id,
        lead_id: lead.id,
        contact_id: task.contact_id || null,
        opportunity_id: null,
        conversation_id: conversationId,
        owner_user_id: 'andre',
        task_type: 'close_task',
        title: task.text || 'Close task',
        description: task.text || null,
        status: task.is_complete ? 'completed' : dueMs && dueMs < now ? 'overdue' : 'open',
        priority_label: task.priority || null,
        due_at: task.due_date || task.date || null,
        completed_at: task.is_complete ? task.date_updated : null,
        created_at: task.date_created,
        updated_at: task.date_updated,
        promise_origin: 'close_task',
        promise_text: task.text || null,
        channel_hint: channel,
        blocking: !task.is_complete,
        auto_generated: false,
        sales_scoring: {
          urgency: dueMs && dueMs < now ? 90 : 55,
          importance: leadScore.priority_score,
          attention_cost: 35,
          expected_impact: leadScore.action_now_score,
          clarity: task.text ? 80 : 45,
          action_now_score: leadScore.action_now_score,
        },
      });
    }

    for (const e of arr(enrichment.activities?.emails)) {
      const classified = classifyText(`${e.subject || ''} ${e.body_preview || ''}`);
      emails.push({
        email_id: e.id,
        lead_id: lead.id,
        contact_id: e.contact_id || null,
        conversation_id: conversationId,
        owner_user_id: 'andre',
        direction: e.direction || 'outbound',
        thread_id: null,
        subject: e.subject || null,
        body_text: e.body_preview || null,
        body_summary: e.body_preview || null,
        sent_at: e.direction === 'outbound' ? e.activity_at : null,
        received_at: e.direction === 'inbound' ? e.activity_at : null,
        opened_at: null,
        reply_received: e.direction === 'inbound',
        attachments: [],
        intent_signals: classified.intent,
        objection_signals: classified.objections,
        commitment_signals: classified.commitment,
        quote_attached: classified.intent.includes('quote_discussion'),
        revision_requested: classified.objections.includes('scope_or_logistics'),
        created_at: e.date_created,
        updated_at: e.date_updated,
      });
    }

    for (const s of arr(enrichment.activities?.sms)) {
      const classified = classifyText(s.text);
      sms.push({
        sms_id: s.id,
        lead_id: lead.id,
        contact_id: s.contact_id || null,
        conversation_id: conversationId,
        owner_user_id: 'andre',
        direction: s.direction || null,
        remote_phone: s.remote_phone || null,
        local_phone: s.local_phone || null,
        body_text: s.text || '',
        body_summary: s.text || '',
        sent_at: s.direction === 'outbound' ? s.activity_at : null,
        received_at: s.direction === 'inbound' ? s.activity_at : null,
        status: s.status || null,
        intent_signals: classified.intent,
        objection_signals: classified.objections,
        commitment_signals: classified.commitment,
        created_at: s.date_created,
        updated_at: s.date_updated,
      });
    }

    for (const c of arr(enrichment.activities?.calls)) {
      const classified = classifyText(c.note);
      calls.push({
        call_id: c.id,
        lead_id: lead.id,
        contact_id: c.contact_id || null,
        conversation_id: conversationId,
        owner_user_id: 'andre',
        direction: c.direction || null,
        status: c.status || c.disposition || null,
        duration_seconds: c.duration || 0,
        started_at: c.activity_at,
        ended_at: null,
        outcome: c.disposition || null,
        summary: c.note || null,
        transcript: null,
        summary_tags: [...classified.intent, ...classified.objections, ...classified.commitment],
        promise_made: textHas(c.note, ['follow', 'send', 'call', 'quote']),
        promise_due_at: null,
        next_step_text: null,
        quote_discussed: classified.intent.includes('quote_discussion'),
        budget_discussed: classified.objections.includes('budget'),
        event_date_discussed: classified.objections.includes('timing'),
        created_at: c.date_created,
        updated_at: c.date_updated,
      });
    }

    for (const n of arr(enrichment.activities?.notes)) {
      notes.push({
        note_id: n.id,
        lead_id: lead.id,
        contact_id: n.contact_id || null,
        conversation_id: conversationId,
        title: n.title || null,
        body_text: n.note || '',
        created_at: n.date_created,
        updated_at: n.date_updated,
      });
    }

    const allActivityTimes = [
      ...arr(enrichment.activities?.emails).map(a => a.activity_at),
      ...arr(enrichment.activities?.sms).map(a => a.activity_at),
      ...arr(enrichment.activities?.calls).map(a => a.activity_at),
      ...arr(enrichment.activities?.notes).map(a => a.activity_at),
    ];
    const lastInboundAt = latestDate([
      ...arr(enrichment.activities?.emails).filter(a => a.direction === 'inbound').map(a => a.activity_at),
      ...arr(enrichment.activities?.sms).filter(a => a.direction === 'inbound').map(a => a.activity_at),
      ...arr(enrichment.activities?.calls).filter(a => a.direction === 'inbound').map(a => a.activity_at),
    ]);
    const lastOutboundAt = latestDate([
      ...arr(enrichment.activities?.emails).filter(a => a.direction === 'outbound' || a.status === 'sent').map(a => a.activity_at),
      ...arr(enrichment.activities?.sms).filter(a => a.direction === 'outbound').map(a => a.activity_at),
      ...arr(enrichment.activities?.calls).filter(a => a.direction === 'outbound').map(a => a.activity_at),
    ]);
    conversations.push({
      conversation_id: conversationId,
      lead_id: lead.id,
      contact_ids: arr(contactByLead.get(lead.id)).map(c => c.contact_id),
      owner_user_id: 'andre',
      channel_mix: ['email', 'sms', 'call'].filter(ch => {
        if (ch === 'email') return arr(enrichment.activities?.emails).length;
        if (ch === 'sms') return arr(enrichment.activities?.sms).length;
        return arr(enrichment.activities?.calls).length;
      }),
      call_ids: arr(enrichment.activities?.calls).map(a => a.id),
      email_ids: arr(enrichment.activities?.emails).map(a => a.id),
      sms_ids: arr(enrichment.activities?.sms).map(a => a.id),
      message_count: arr(enrichment.activities?.emails).length + arr(enrichment.activities?.sms).length + arr(enrichment.activities?.calls).length,
      first_activity_at: firstDate(allActivityTimes),
      last_activity_at: latestDate(allActivityTimes),
      last_inbound_at: lastInboundAt,
      last_outbound_at: lastOutboundAt,
      current_state: lastInboundAt && (!lastOutboundAt || dateMs(lastInboundAt) > dateMs(lastOutboundAt)) ? 'awaiting_rep_reply' : 'awaiting_customer_reply',
      summary: `${lead.name}: ${arr(lead.saved_view_names).join(', ')}`,
      sentiment: null,
      intent_signals: [],
      objection_signals: [],
      commitment_signals: [],
      next_step_mentions: [actionTitle],
      created_at: lead.date_created,
      updated_at: lead.date_updated,
      sales_scoring: {
        momentum: leadScore.momentum,
        relationship_strength: leadScore.relationship_strength,
        friction: leadScore.friction,
        reply_probability: clamp(leadScore.relationship_strength + leadScore.momentum * 0.25 - leadScore.friction * 0.2),
        clarity_of_next_step: leadScore.next_action_clarity,
      },
    });

    const signalBase = {
      lead_id: lead.id,
      opportunity_id: lead.opportunities?.[0]?.id || null,
      contact_id: lead.contacts?.[0]?.contact_id || null,
      detected_by: 'andre_lattice_catalog_builder',
      created_at: generatedAt,
    };
    const leadSignals = [
      ['saved_view_membership', arr(lead.saved_view_names).join(', '), 15, 15, 0, 0],
      ['contact_indexed', `${arr(contactByLead.get(lead.id)).length} contact(s) indexed`, 5, 5, 0, 10],
      leadScore.decay_risk_score > 65 ? ['decay_risk', `Decay risk ${leadScore.decay_risk_score}`, 20, -15, 20, -10] : null,
      leadScore.momentum > 65 ? ['momentum', `Momentum ${leadScore.momentum}`, 5, 20, -5, 10] : null,
    ].filter(Boolean);
    const signalIds = [];
    for (const [type, summaryText, urgencyImpact, momentumImpact, frictionImpact, relationshipImpact] of leadSignals) {
      const signalId = id('sig', [lead.id, type]);
      signalIds.push(signalId);
      signalEvents.push({
        signal_event_id: signalId,
        target_object_type: 'lead',
        target_object_id: lead.id,
        ...signalBase,
        source_type: 'derived',
        event_type: type,
        event_timestamp: latestDate(allActivityTimes) || lead.date_updated || generatedAt,
        channel: null,
        payload_summary: summaryText,
        raw_reference_id: null,
        intent_signals: [],
        objection_signals: type === 'decay_risk' ? ['responsiveness'] : [],
        commitment_signals: type === 'momentum' ? ['active_engagement'] : [],
        urgency_impact: urgencyImpact,
        momentum_impact: momentumImpact,
        friction_impact: frictionImpact,
        relationship_impact: relationshipImpact,
        confidence: 75,
      });
    }

    nextBestActions.push({
      next_best_action_id: id('nba', [lead.id, actionType]),
      target_object_type: 'lead',
      target_object_id: lead.id,
      action_type: actionType,
      title: actionTitle,
      description: `${actionTitle} for ${lead.name}`,
      recommended_channel: channel,
      recommended_due_at: leadTasks[0]?.due_date || null,
      recommended_owner_user_id: 'andre',
      source_model: 'deterministic_andre_lattice_v0',
      generated_at: generatedAt,
      expires_at: null,
      superseded_at: null,
      supporting_signals: signalIds,
      blocking_signals: [],
      required_inputs: [
        !lead.contacts?.some(c => c.emails?.length) ? 'email_missing' : null,
        !lead.contacts?.some(c => c.phones?.length) ? 'phone_missing' : null,
      ].filter(Boolean),
      automation_eligible: !!channel && leadScore.next_action_clarity >= 60,
      human_review_required: true,
      sales_scoring: {
        priority_score: leadScore.priority_score,
        action_now_score: leadScore.action_now_score,
        expected_impact: leadScore.momentum,
        saveability_score: leadScore.saveability_score,
        confidence: 72,
        attention_cost: leadScore.attention_cost,
      },
      derived_flags: {
        is_top_recommendation: leadScore.action_now_score >= 70,
        is_fast_win: leadScore.attention_cost < 45 && leadScore.action_now_score >= 60,
        is_rescue_action: leadScore.decay_risk_score >= 70,
        is_automation_candidate: !!channel && leadScore.next_action_clarity >= 70,
        is_time_sensitive: leadScore.urgency >= 75,
      },
      recommended_outputs: {
        reasoning_summary: `${arr(lead.saved_view_names).join(', ')}; action_now=${leadScore.action_now_score}; priority=${leadScore.priority_score}`,
        counterfactual_if_ignored: leadScore.decay_risk_score >= 65 ? 'Lead may continue cooling off or remain unconnected.' : 'Momentum may decay if no follow-up happens.',
        reasoning_tags: arr(lead.saved_view_names).map(v => v.replace(/^A:\s*/, '')),
      },
    });
  }

  const normalizedLeads = leads.map(lead => {
    const enrichment = activitiesByLead[lead.id] || {};
    const leadTasks = arr(enrichment.tasks);
    const leadScore = scoreLead(lead, enrichment, leadTasks);
    const [actionType, actionTitle, channel] = nextActionFor(lead, leadScore, enrichment, leadTasks);
    const contactsForLead = arr(contactByLead.get(lead.id));
    const latestInboundAt = latestDate([
      ...arr(enrichment.activities?.emails).filter(a => a.direction === 'inbound').map(a => a.activity_at),
      ...arr(enrichment.activities?.sms).filter(a => a.direction === 'inbound').map(a => a.activity_at),
      ...arr(enrichment.activities?.calls).filter(a => a.direction === 'inbound').map(a => a.activity_at),
    ]);
    const latestOutboundAt = latestDate([
      ...arr(enrichment.activities?.emails).filter(a => a.direction === 'outbound' || a.status === 'sent').map(a => a.activity_at),
      ...arr(enrichment.activities?.sms).filter(a => a.direction === 'outbound').map(a => a.activity_at),
      ...arr(enrichment.activities?.calls).filter(a => a.direction === 'outbound').map(a => a.activity_at),
    ]);
    return {
      lead_id: lead.id,
      crm_source: 'close',
      display_name: lead.name,
      company_name: null,
      primary_contact_id: contactsForLead[0]?.contact_id || null,
      contact_ids: contactsForLead.map(c => c.contact_id),
      owner_user_id: 'andre',
      lead_status: lead.status_label || 'unknown',
      opportunity_ids: arr(lead.opportunities).map(o => o.id),
      conversation_ids: [id('conv', [lead.id])],
      task_ids: leadTasks.map(t => t.id),
      quote_ids: [],
      tasting_ids: arr(lead.saved_view_names).some(v => v.includes('Tasting')) ? [id('tasting', [lead.id])] : [],
      custom_field_values: {
        event_date: null,
        event_type: null,
        guest_count: null,
        budget_range: null,
        venue: null,
        city: null,
        source_channel: lead.custom?.['05. 👥 Franchise'] || null,
      },
      latest_inbound_at: latestInboundAt,
      latest_outbound_at: latestOutboundAt,
      last_activity_at: latestDate([
        latestInboundAt,
        latestOutboundAt,
        ...arr(enrichment.activities?.notes).map(a => a.activity_at),
      ]),
      next_due_at: leadTasks[0]?.due_date || null,
      created_at: lead.date_created,
      updated_at: lead.date_updated,
      archived: false,
      tags: [...arr(lead.saved_view_names), ...Object.values(lead.custom || {}).flat().map(String).filter(v => v && v.length < 80)],
      notes_summary: lead.description || null,
      sales_scoring: leadScore,
      derived_flags: {
        is_stalled: leadScore.decay_risk_score >= 65,
        is_hot: leadScore.priority_score >= 70,
        has_quote_out: textHas(JSON.stringify(enrichment), ['quote']),
        has_upcoming_event: false,
        has_pending_promise: leadTasks.some(t => !t.is_complete),
        has_budget_friction: textHas(JSON.stringify(enrichment), ['budget', 'price', 'cost']),
        needs_human_review: true,
      },
      recommended_outputs: {
        recommended_next_action: actionTitle,
        recommended_channel: channel,
        reasoning_tags: arr(lead.saved_view_names),
      },
    };
  });

  const normalizedContacts = contacts.map(c => ({
    contact_id: c.contact_id,
    lead_id: c.lead_id,
    full_name: c.contact_name,
    first_name: String(c.contact_name || '').split(/\s+/)[0] || null,
    last_name: String(c.contact_name || '').split(/\s+/).slice(1).join(' ') || null,
    role_title: c.title || null,
    email_addresses: arr(c.emails).map(e => e.email),
    phone_numbers: arr(c.phones).map(p => p.phone),
    preferred_channel: c.can_sms ? 'sms' : c.can_email ? 'email' : null,
    timezone: c.timezone || null,
    is_primary_contact: c.contact_id === arr(contactByLead.get(c.lead_id))[0]?.contact_id,
    is_decision_maker: null,
    is_planner: null,
    engagement_level: null,
    last_contacted_at: leadContacts.find(lc => lc.contact_id === c.contact_id)?.last_contacted_at || null,
    created_at: null,
    updated_at: null,
    notes_summary: null,
    tags: arr(c.saved_view_ids),
  }));

  const catalogIndex = {
    catalog_name: 'andre_close_focus_lattice_catalog',
    generated_at: generatedAt,
    source_export: EXPORT_DIR,
    source_summary: summary,
    files: [
      '_Canonical_definitions.txt',
      'Sales_user.txt',
      'Leads.txt',
      'Contacts.txt',
      'Join_lead_contacts.txt',
      'Opportunity.txt',
      'Conversations.txt',
      'Emails.txt',
      'Sms.txt',
      'Calls.txt',
      'Notes.txt',
      'Tasks:Promise.txt',
      'Signal_event.txt',
      'Next_best_action.txt',
      'Action_log.txt',
      'Raw_close_leads.txt',
      'Raw_close_contacts.txt',
      'Raw_close_emails.txt',
      'Raw_close_sms.txt',
      'Raw_close_calls.txt',
      'Raw_close_tasks.txt',
      'Raw_close_saved_views.txt',
    ],
    counts: {
      leads: normalizedLeads.length,
      contacts: normalizedContacts.length,
      lead_contacts: leadContacts.length,
      opportunities: opportunities.length,
      conversations: conversations.length,
      emails: emails.length,
      sms: sms.length,
      calls: calls.length,
      notes: notes.length,
      tasks: tasks.length,
      signal_events: signalEvents.length,
      next_best_actions: nextBestActions.length,
    },
  };

  writeJSONTxt('_Canonical_definitions.txt', {
    schema_name: 'andre_canonical_definitions',
    description: 'Andre-focused normalized sales catalog vocabulary derived from the Ratio Lattice bundle pattern.',
    generated_at: generatedAt,
    normalized_enums: {
      channel_enum: ['email', 'call', 'sms', 'task', 'note'],
      direction_enum: ['inbound', 'outbound', 'internal'],
      object_type_enum: ['lead', 'contact', 'conversation', 'call', 'email', 'sms', 'opportunity', 'task_promise', 'signal_event', 'next_best_action'],
      next_best_action_type_enum: ['call_now', 'send_email', 'send_sms', 'schedule_follow_up', 'confirm_event_details', 'reactivate_lead', 'review_manually'],
    },
    base_score_definitions: {
      urgency: 'How costly delay is right now.',
      momentum: 'How alive and advancing the lead currently is.',
      friction: 'How much resistance or missing data is present.',
      relationship_strength: 'How strong the communication bond appears.',
      close_probability: 'Practical likelihood of progress under current conditions.',
      revenue_value: 'Commercial importance based on opportunity value.',
      attention_cost: 'How much rep effort is needed.',
      next_action_clarity: 'How obvious the next move is.',
    },
  });
  writeJSONTxt('Sales_user.txt', [{
    sales_user_id: 'andre',
    crm_user_id: 'andre_close_owner',
    full_name: 'Andre Raw',
    email: 'team@comeketocatering.com',
    role: 'sales',
    team_name: 'Comeketo',
    active: true,
    timezone: 'America/New_York',
    channel_preferences: ['call', 'sms', 'email'],
    created_at: generatedAt,
    updated_at: generatedAt,
  }]);
  writeJSONTxt('Leads.txt', normalizedLeads);
  writeJSONTxt('Contacts.txt', normalizedContacts);
  writeJSONTxt('Join_lead_contacts.txt', leadContacts);
  writeJSONTxt('Opportunity.txt', opportunities);
  writeJSONTxt('Conversations.txt', conversations);
  writeJSONTxt('Emails.txt', emails);
  writeJSONTxt('Sms.txt', sms);
  writeJSONTxt('Calls.txt', calls);
  writeJSONTxt('Notes.txt', notes);
  writeJSONTxt('Tasks:Promise.txt', tasks);
  writeJSONTxt('Signal_event.txt', signalEvents);
  writeJSONTxt('Next_best_action.txt', nextBestActions);
  writeJSONTxt('Action_log.txt', actionLog);
  writeJSONTxt('Raw_close_leads.txt', leads);
  writeJSONTxt('Raw_close_contacts.txt', contacts);
  writeJSONTxt('Raw_close_emails.txt', Object.values(activitiesByLead).flatMap(v => arr(v.activities?.emails)));
  writeJSONTxt('Raw_close_sms.txt', Object.values(activitiesByLead).flatMap(v => arr(v.activities?.sms)));
  writeJSONTxt('Raw_close_calls.txt', Object.values(activitiesByLead).flatMap(v => arr(v.activities?.calls)));
  writeJSONTxt('Raw_close_tasks.txt', Object.values(activitiesByLead).flatMap(v => arr(v.tasks)));
  writeJSONTxt('Raw_close_saved_views.txt', savedViews);
  writeJSONTxt('INDEX.txt', catalogIndex);

  const toc = catalogIndex.files.concat(['INDEX.txt']);
  const bundleParts = [
    'ANDRE CLOSE FOCUS LATTICE CATALOG — FULL BUNDLE',
    `Source: ${EXPORT_DIR}`,
    `Generated: ${generatedAt}`,
    `Files included: ${toc.length}`,
    '',
    'TABLE OF CONTENTS',
    '----------------------------------------',
    ...toc.map((file, i) => `${String(i + 1).padStart(3, ' ')}. ${file}`),
    '',
    '==============================================================================',
    '',
  ];
  for (const file of toc) {
    bundleParts.push(
      '',
      '══════════════════════════════════════════════════════════════════════════════',
      `FILE: ${file}`,
      '══════════════════════════════════════════════════════════════════════════════',
      '',
      fs.readFileSync(path.join(OUT_DIR, file), 'utf8').trimEnd(),
      ''
    );
  }
  fs.writeFileSync(path.join(OUT_DIR, 'ANDRE_CLOSE_FOCUS_LATTICE_FULL_BUNDLE.txt'), `${bundleParts.join('\n')}\n`);

  console.log(JSON.stringify(catalogIndex, null, 2));
}

build();
