# Product intent — Comeketo command center

This document is the **line in the sand**: what we are building, what we are **not** building, and how today’s UI connects to the larger system.

## What this is not

We are **not** building a Close CRM clone. Close remains the system of record for leads, activities, email/SMS, and tasks. We do not aim to replicate every Close screen, workflow builder, or report.

## What this is

A **unified intelligence surface** for the rep and stakeholders: a clean command center that **compresses** the highest-signal operational reality into a small set of mechanics—Oracle, pipeline context, automation hooks, and **live intel** from Close.

The primary external signal for “what needs attention now” should track **Close Inbox–class work**: tasks assigned to the rep (today / future), email and SMS that need triage, and recent calls—not only static pipeline JSON. That feed is the best **intel** for what to do next, even when the full CRM graph (leads, workflows, long history) still matters elsewhere.

## Human in the loop, AI as geometry

The long-term posture is **semi-autonomous**: the **salesperson commits**—sends, schedules, chooses the next move—while AI systems handle **automation, compression, fan-out, and aggregation**, presenting options and pressure in a structured way. “Geometry” here means preferences and constraints expressed as relationships (what contrasts with what, under a chosen comparator), not a black-box autopilot.

## Where it evolves: ratio lattice (north star)

A useful mental model for later functionality is a **ratio lattice**: many **oscillators** (deals, tasks, messages, cadences, models, policies), each with a **low-order preference** for interactions that are more relevant relative to a selected **comparator** (e.g. revenue at risk, time to event, relationship strength). Observing under different comparators yields different lattices of preference—this app becomes one **viewport** into that structure, wired for **plug-and-play** with your deeper automation stack as it lands.

## Why ship this UI now

The business needs something **real and visible quickly**: a polished web app that already **does** something meaningfully different from using Close alone—compressed command view, Oracle, outbound via Close, inbox intel—while staying simple enough to extend without painting us into a “fake CRM” corner.

When your larger system is ready, this layer should **integrate** (same APIs, events, and clear boundaries), not compete with it.
