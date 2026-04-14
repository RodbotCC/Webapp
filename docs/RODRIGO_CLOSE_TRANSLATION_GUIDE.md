# Comeketo UI to Close Translation Guide

Purpose: translate the language used inside the Comeketo Sales Command Center into plain English and then map it to the actual object or signal it comes from in Close.

This file is for Rodrigo and anyone else who needs to understand:

- what each dashboard is actually showing
- which terms are true Close concepts
- which terms are Comeketo app concepts layered on top of Close
- where each number comes from

## The Short Version

The app is not a separate CRM.

It is a focused operating layer on top of Close for Andre.

That means:

- Close is the system of record for leads, contacts, opportunities, tasks, emails, calls, and SMS
- the app sweeps Close and reshapes that data into dashboards, alerts, queues, and AI guidance
- some labels on the site are Close-native
- some labels are Comeketo shorthand for a bundle of Close signals

## First Principle: Object Translation

These are the most important translations on the whole site.

| Comeketo app term | What it really means | Close equivalent |
|---|---|---|
| Lead | A person/company record we may sell to | `Lead` |
| Contact | A specific person under a lead, with phone/email | `Contact` on a lead |
| Deal | Usually a sales situation tied to money and stage | Usually a Close `Opportunity`, sometimes shown through its parent lead |
| Active lead | A lead that is still operationally relevant in Andre's current scope | Usually a lead with an active opportunity, active tasks, or fresh attention signals |
| Active deal | An open opportunity still in play | `Opportunity` with non-won / non-lost status |
| Pipeline | The full set of active opportunities | All active `Opportunity` rows |
| Task | Something Andre needs to do | Close `Task` |
| Inbox intel | Recent action items and communication signals | Close tasks + email + SMS + call activity summarized |
| Cadence | A recommended follow-up lane or sequence | App-layer grouping built from Close state, not a native Close object |
| Oracle | The app's AI advisor | AI layer using Close-derived context |
| Lattice | The app's decision/ranking layer | App-layer scoring model built from Close data |
| Action queue | Work packets waiting for automation or review | App-owned queue, not a Close-native object |
| Automation outbox | Drafted packets ready for review/send | App-owned output built from Close signals |

## The Most Important Vocabulary Fix

### "Active lead"

This is the phrase most likely to confuse Rodrigo.

Inside this app, "active lead" does not always mean "a plain lead record exists in Close."

It usually means:

- the lead is inside Andre's current focused operating scope
- and there is still live sales work attached to it

That live sales work usually means one or more of:

- an active opportunity
- a task due
- a recent communication needing follow-up
- a risk or attention flag

So if the app says "active lead," Rodrigo should mentally read it as:

"A lead in Close that still has live sales work attached to it."

### "Deal"

On this site, "deal" is often used as operator shorthand, not strict database language.

Usually:

- if money, stage, confidence, risk, or pipeline are being shown, "deal" means a Close opportunity
- if a side panel opens around that item, the app may show the whole lead workspace around the opportunity

So the safest translation is:

"Deal" = "the lead plus its current selling opportunity, viewed as one work unit."

## Where Each Dashboard Gets Its Meaning

## Command

This is the executive operating view.

It is not a raw Close page. It is a summary layer built from:

- `data/live_close_crm.json`
- `data/live_pipeline.json`
- `data/live_tasks.json`
- Andre-focused lattice data

### Terms on Command

| UI label | What it means | Close mapping |
|---|---|---|
| Needs Attention | Open opportunities that the app thinks need immediate human review | Active opportunities flagged from Close using risk/urgency rules |
| Tasks Today | Tasks due today | Close tasks due today |
| Locked Revenue | Revenue treated as already secured | Derived from active/won opportunity state in the pipeline snapshot |
| Pipeline Value | Total dollar value of active opportunities | Sum of active Close opportunity values |
| Win Rate | Wins divided by resolved opportunities | Derived from won/lost opportunity counts |
| Top Deal | Highest-value current opportunity in the live snapshot | Largest active Close opportunity |
| Top Priority Deal | The top recommended work target right now | App recommendation built from lattice logic over Close data |
| Manager Directive | App-generated explanation of why that target/action matters | AI/app interpretation of Close-derived signals |
| Executive War Room | Highest-pressure money/risk view | Active opportunities + tasks + alerts from Close |
| Critical Exceptions | Things the app thinks are dangerous enough to surface immediately | Alert logic built from Close opportunities/tasks/activity |
| Morning Brief | A condensed "what should happen today" plan | Built from Close tasks, attention flags, bottlenecks, and closing windows |
| Send Today | Highest-priority outbound or task actions for today | Mostly Close tasks and close-window opportunities |
| Slipping | Deals or leads losing momentum | Attention flags and alerts derived from Close |
| Waiting On Us | Bottlenecks/open loops where Comeketo still owes the next move | Built from Close tasks/open loop logic |

## Pipeline

This is the funnel view.

It translates active Close opportunities into a stage-based operating board.

### Terms on Pipeline

| UI label | What it means | Close mapping |
|---|---|---|
| Stage | Where the opportunity sits in the sales process | Close opportunity status/stage label |
| Value | Expected dollar amount | Close opportunity value |
| Confidence | How likely the opportunity is to close | Close opportunity confidence |
| At Risk Revenue | Revenue tied to deals with risk signals | Derived from opportunity confidence/risk conditions |
| High Value Deals | The highest-dollar open opportunities | Active Close opportunities sorted by value |
| Risk Pattern | Repeated issue across opportunities | Derived from Close opportunity/task/activity conditions |

## Actions

This is the task and next-move view.

It is mostly Close task data plus app-owned prioritization.

### Terms on Actions

| UI label | What it means | Close mapping |
|---|---|---|
| Today | Must-do tasks due now | Close tasks due today |
| Within 48h | Near-term tasks | Close tasks due soon |
| Watch List | Tasks or leads worth monitoring but not immediate | Derived from Close task/opportunity timing |
| Bottlenecks | Leads stalled because a required step is missing | App interpretation of Close task/deal state |
| Open Loops | Unanswered questions or unresolved next steps | App interpretation of pending work in Close |

## Deals

This is the workbench for a specific sales record.

It often opens around a lead but shows the sales opportunity context attached to that lead.

### Terms on Deals

| UI label | What it means | Close mapping |
|---|---|---|
| Deal Workspace | The app's working view for a lead/opportunity combo | Lead + related opportunity + tasks + comms in Close |
| Communication Guidance | Suggested best channel and tone | Derived from Close data plus app logic |
| Best Channel | The most likely useful lane right now | App recommendation from email/phone/SMS availability and recent Close activity |
| Draft | Create an AI draft | App action that uses Close lead/contact context |
| Analyze | Ask Oracle to interpret the record | AI pass over Close-derived data |
| Email (Close) | Open/send email through Close | Close email activity |
| SMS (Close) | Open/send SMS through Close | Close SMS activity |
| Task (Close) | Create a task in Close | Close task creation |

## Automation

This is the machine-operations view.

It is mostly app-owned orchestration around Close, not Close itself.

### Terms on Automation

| UI label | What it means | Close mapping |
|---|---|---|
| Live Action Center | The operating system for current work | App layer using Close data |
| Daily Operating Memory | Daily log of what happened and what changed | App-owned memory, not Close-native |
| Money In Attention | Dollar value of opportunities currently needing action | Sum of flagged active Close opportunities |
| Packets Waiting | Draft action packets waiting for review | App-owned review queue |
| Reviewed Today | Packets Andre or operator already handled | App-owned queue history |
| Automation Engine | Background jobs that refresh and prepare work | App-owned server automation over Close |
| Close Sync Pulse | Refresh the live Close snapshot | Direct Close sweep |
| Attention Follow-up Sweep | Auto-select urgent follow-up targets | App logic over Close opportunities/tasks |
| Closing Window Sweep | Focus on near-close opportunities | App logic over Close dates and values |
| Cadence Watch | Refresh cadence-style action views | App logic built from Close tasks/opps |
| Brief Refresh | Rebuild the Morning Brief | App summary built from Close |
| Action Queue | Pending machine work | App queue, not a Close object |
| Automation Outbox | Prepared packets ready for review/send | App-owned drafted actions |
| Ready To Send | Approved outbound packets | App-approved drafts based on Close context |

## Timeline

This is the chronological operating memory.

It combines:

- sync events
- AI events
- queue events
- operational notes

This is not a Close timeline replica. It is the app's operational history.

## Oracle

Oracle is not its own database.

Oracle is the reasoning layer on top of:

- live Close snapshots
- Andre-focused lattice catalog
- app operating memory
- HRMR feedback history

### Terms on Oracle

| UI label | What it means | Close mapping |
|---|---|---|
| Next Steps | Suggested actions the operator can click | App recommendations built from Close-derived context |
| Rate This Reply | A+, A, B, C, D, F grading | App-owned feedback, not Close |
| Approve / Revise / Reject | Human certification of AI recommendation | App-owned review loop |
| Archive + Clear | Save conversation and clear thread | App-owned memory archive |
| Guided Mode | Oracle is trying to propose concrete next moves | AI behavior using app + Close context |

## Lattice

This is the decision lab, not a Close screen.

It ranks possible work using comparator logic.

### Terms on Lattice

| UI label | What it means | Close mapping |
|---|---|---|
| Comparator | A ranking dimension like urgency, doctrine fit, contactability, decay risk | App-owned score built from Close fields/signals |
| Comparator Stack | The currently dominant ranking logic | App-owned visualization |
| Balanced Lattice | A blended ranking | App-owned algebra |
| Doctrine Fit | How strongly a lead matches Comeketo's preferred selling logic | App-owned score derived from Close facts |
| Contactability | Whether we actually have a usable lane to reach them | Derived from Close contact email/phone data |
| Decay Risk | Risk that the lead goes cold if ignored | App-owned score derived from timing/activity in Close |
| Best Next Action | The current winning move | App recommendation produced from Close-derived scores |

## Performance

This is the scoreboard layer.

Important nuance:

- some values here are live enough to be useful
- some are baseline or transcript-analysis metrics from `andre_kpis.json`
- this is not a pure "live Close only" screen

That means Rodrigo should treat this as a coaching/performance board, not a literal mirror of Close reports.

## Coaching

This is training and scripting support.

It is built from:

- templates
- doctrine
- scenarios
- communication patterns

It is app logic informed by Close data, not a native Close screen.

## Settings

Settings is where the app's own integrations live:

- AI key
- AI model
- sender info
- automation preferences

This is app configuration, not Close configuration.

## Translation of the Most Common Numbers

| Number on site | Meaning | Source |
|---|---|---|
| Active Deals | Count of open opportunities in play | `live_close_crm.json.pipeline_snapshot.total_active_opportunities` |
| Needs Attention | Count of opportunities currently flagged by the app | `live_close_crm.json.pipeline_snapshot.needs_attention_count` |
| Closing This Week | Count of opportunities with a close window inside the current week logic | `live_close_crm.json.pipeline_snapshot.closing_this_week` |
| Top Deal Value | Highest-value active opportunity | `live_close_crm.json.pipeline_snapshot.top_deal_value` |
| Pipeline Value | Total active pipeline dollars | `live_pipeline.json.summary.total_pipeline` |
| Locked Revenue | Revenue treated as secured | `live_pipeline.json.summary.locked_in_revenue` |
| At Risk Revenue | Revenue tied to risky active opportunities | `live_pipeline.json.summary.at_risk_revenue` |
| Won Count | Opportunities marked won | `live_pipeline.json.summary.won_count` |
| Lost Count | Opportunities marked lost | `live_pipeline.json.summary.lost_count` |
| Tasks Today | Close tasks due today | `live_tasks.json.task_summary.today` |

## What Is Native to Close vs Native to the App

### Close-native

- leads
- contacts
- opportunities
- tasks
- emails
- SMS
- calls
- notes
- opportunity value
- confidence
- stage/status

### App-native

- Oracle
- Lattice
- comparator stack
- doctrine fit
- best next action
- action queue
- automation outbox
- packets
- daily operating memory
- Morning Brief
- Executive War Room
- Critical Exceptions
- Communication Command Deck

## The Safest Way to Explain the Site to Rodrigo

Use this language:

1. Close is the raw CRM.
2. This app is the operating layer for Andre.
3. When the app says "deal," it usually means the active selling situation around a Close opportunity.
4. When the app says "active lead," it means "a Close lead that still has live sales work attached to it."
5. Oracle and Lattice do not replace Close. They help decide what to do with what Close already knows.

## If We Want To Tighten The Language Later

These are the labels most worth standardizing next:

- change "Active lead" to "Lead with live work"
- change "Deal" to "Opportunity" anywhere we are talking strictly about pipeline money/stage
- change "Packet" to "Prepared action"
- change "Needs Attention" to "Flagged opportunities"
- change "Top Priority Deal" to "Top recommended work target"

That would make the app line up much more cleanly with how Close users already think.
