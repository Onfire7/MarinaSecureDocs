# MarinaSecure

A permissions-driven operations platform for overnight security, maintenance, and front-office staff at marinas — built to run offline on the dock, sync automatically, and be configured differently for every property that adopts it.

> **What this document set is — and who it's for.** Implementation
> documentation, written for the agents and developers building the
> application. It defines the architecture, data model, permission logic,
> per-role requirements and page-by-page specifications in enough detail to
> implement from directly, and stops short of implementation code.
>
> **Format transition in progress.** These docs were written as HTML so they
> could be read and steered in a browser during planning. That phase is over;
> they are being converted to Markdown, where the people reading them
> actually work. The cross-cutting documents below are converted. The page
> specs are still HTML under `pages/`, and convert one at a time as each page
> is touched — folding in that page's wireframe and moving beside its
> component in `src/`.

## The problem

Marinas run overnight security and maintenance operations on a patchwork of paper logs, radio calls, spreadsheets, and whatever the previous office manager left behind. Shift handoffs lose information. Incident reports live in someone's notebook. Maintenance requests get relayed by word of mouth. Owner and slip information isn't available to the person standing at the boat who needs it. And every marina does it slightly differently — so anything built for one has to bend without breaking for the next.

MarinaSecure replaces that patchwork with a single system that a night guard can use standing on a dark dock with one bar of signal, that an office manager can use to log a customer call, and that an owner-operator can reconfigure without touching code when their operation doesn't match the defaults.

## The application's user roles

These are the end users the _application_ serves — the personas every requirement in this document set exists for. (The documentation itself is addressed to you, the implementer.)

- **Security** — guards on overnight rounds, completing checklists, checking in at physical checkpoints, logging incidents, and raising maintenance tickets as they walk the property.
- **Maintenance** — staff working a shared ticket queue, tracking asset condition and meters, and completing scheduled and reactive work.
- **Office** — front-desk and administrative staff handling calls, texts, reservations, owner and contact records.
- **Manager / Owner** — oversight, reporting, and the administrative configuration that lets one system fit very different marinas.

A single person often wears more than one of these hats. The system reflects that directly — see [Permissions](permissions.md) for how roles and access combine per user, and [Role Workflows](workflows.md) for the functional requirements each role imposes on the implementation.

## Design principles

> Configurable, not hard-coded
>
> Location types, checklist templates, permission sets, ticket workflows, and incident categories are all admin-defined per marina. Nothing about a specific marina's operation is assumed in the schema.

> Offline is the default, not an edge case
>
> A guard on a dock with no signal is a normal condition, not a failure state. The system is built around local-first data from the ground up.

> Every marina is its own island
>
> Each marina gets its own subdomain, its own deployment, its own database, and its own phone integration. No shared infrastructure, no cross-tenant data model to defend.

> An honest, permanent record
>
> The Activity Log is an immutable audit trail of what happened and when — generated automatically as a byproduct of using the system, not a separate thing anyone has to maintain.

## The stack, at a glance

Full detail lives in [Stack & Architecture](architecture.md). In short:

- **Frontend** — a static site, deployed per-marina to its own Netlify site and subdomain.
- **Database** — InstantDB, giving the app local-first storage and automatic sync with no custom offline logic to build.
- **Telephony** — Twilio Functions per marina integrating Twilio for calls and SMS, writing directly into that marina's InstantDB instance. No dedicated server to host.
- **Auth** — Clerk, via its native InstantDB integration, supporting both personal devices and (via Clerk's multi-session support) shared shift devices.

## How to read this document set

Documents are ordered for a first read-through. Where something described
here is specified but not yet built, it carries a **Status** note pointing at
[the roadmap](ROADMAP.md) — the audit that produced this structure found
several places where the docs described intent as though it were reality, and
these markers exist so that cannot recur silently.

| Document | What it covers |
|---|---|
| [Terminology](../CONTEXT.md) | The domain glossary, at the repo root — read this first if a term elsewhere is unclear. |
| [Stack & Architecture](architecture.md) | The technical shape of the system: hosting, database, Twilio Functions, sync and offline behavior, where work runs, and how the schema evolves. |
| [Data Model](data-model.md) | Every entity, its fields, and its relationships. |
| [Permissions](permissions.md) | The role and trinary-permission system, and the full permission list. |
| [Role Workflows](workflows.md) | Per-role functional requirements, written as end-to-end narratives. |
| [API Structure](api-structure.md) | How the frontend, InstantDB, and Twilio Functions communicate. |
| [Page Specifications](pages/index.html) | A detailed spec for every screen in the application. |
| [Wireframes](wireframes/index.html) | Low-fidelity HTML wireframes. Being folded into their page specs and retired. |
| [Roadmap](ROADMAP.md) | Planned phases and deferred work, each with the reason it was deferred. |
| [Open tasks](TODO.md) | The current punch list. |
| [Decisions](adr/) | Architecture decision records. |

Two files outside this folder are part of the same set: [`CONTEXT.md`](../CONTEXT.md), the
domain glossary, and [`CLAUDE.md`](../CLAUDE.md), the working conventions,
development workflow, and accumulated debugging lessons. Both live at the repo
root deliberately — proximity to the code is what keeps them current.
