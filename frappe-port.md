# Frappe Framework — Core Features & Node.js Port Plan

## Project goal & context

- **Goal:** Port the Frappe framework (Python/MariaDB/Redis metadata-driven full-stack framework, the engine underlying ERPNext) to Node.js, for learning purposes.
- **Scope:** Port the generic DocType meta-engine itself — not ERPNext or any specific app built on top of it.
- **Working directory:** `/work/code/my-work/frappe-nodejs` (not yet a git repository as of this writing).
- **Key design decision to make before scaffolding Phase 0/1:** Python's dynamic introspection (metaclasses, `getattr`, hooks resolved by naming convention) doesn't map 1:1 to Node/JS. Lean on TypeScript's type system + an explicit registry pattern instead of trying to replicate Python's dynamism directly.
- **Recommended learning path:** Build Phases 0–3 (below) end-to-end against one toy DocType (e.g. "Task") before moving further — that's the smallest slice that proves the meta-driven architecture actually works. Everything after is additive.

## What Frappe actually is

Frappe (Python + MariaDB/Postgres + Redis) is a **metadata-driven full-stack framework**: instead of writing model classes, controllers, and CRUD UI by hand, you define a **DocType** (a JSON schema stored in the DB) and the framework generates the database table, REST API, permissions, list/form UI, and reports from it. ERPNext is just ~1000 DocTypes built on top of this engine. Porting "Frappe" really means porting this generic engine, not any specific app.

## Main features, grouped by layer

**1. Meta / Schema layer (the heart of the framework)**
- DocType system — schema-as-data (fields, types, validations, permissions) stored in the DB itself
- Auto schema sync ("bench migrate") — DB tables created/altered from DocType JSON on deploy
- Child tables (one-to-many nested rows), Link fields (foreign keys), Dynamic Links, Fetch fields (auto-pull related values)
- Naming series / autoname rules
- Custom Fields & Property Setters — end users extend schema without code

**2. Data / ORM layer**
- `frappe.get_doc` / Document class — active-record ORM with lifecycle hooks (`validate`, `before_save`, `on_submit`, `on_cancel`, `on_trash`, etc.)
- Query builder + raw SQL escape hatch (`frappe.qb`, `frappe.db.sql`)
- Submittable documents (draft → submitted → cancelled state machine, amendments)
- Version/change tracking, document locking

**3. API layer**
- Auto-generated REST API for every DocType (list/get/insert/update/delete)
- RPC-style whitelisted methods (`frappe.whitelist()`), client-callable server methods
- Webhooks, OAuth2 provider, API keys/secrets

**4. Permission & security**
- Role-based permissions (per DocType, per action)
- Row-level "User Permissions" (restrict a user to specific records)
- Field-level permissions, "if owner" rules
- Session/auth (password, OAuth, 2FA)

**5. Business logic / low-code**
- Server Scripts & Client Scripts (scripting without deployment)
- Workflow engine (state-machine approvals with transition rules)
- Notification/Alert rules, Assignment rules
- Scheduler (cron-like background jobs)
- Background jobs via Redis queue (RQ)

**6. UI layer**
- "Desk" — a generic SPA that renders list view, form view, report view, kanban, calendar, gantt purely from DocType meta
- Report Builder + Query Reports + Script Reports
- Print Format engine (Jinja → PDF)
- Dashboards (number cards, charts)
- Website engine — public-facing pages/portal generated from DocTypes

**7. Operational / platform features**
- Multi-tenancy via "sites" (one codebase, many isolated DB+files per site) — `bench` CLI manages this
- Data Import/Export tool
- Backup/restore, patches (versioned data migrations)
- Real-time updates via Socket.IO
- Email (send/receive, IMAP polling, templates)
- Translation/i18n, global search, file/attachment management

## Porting reality check

The hardest part to port isn't any single feature — it's that Python's dynamic introspection (metaclasses, `getattr`, controller hooks resolved by naming convention) is what makes the DocType engine feel "magic." In Node.js you'll want to lean on TypeScript's type system + a registry pattern instead of trying to replicate Python dynamism 1:1. That's a design decision worth making explicitly before you start, not something to discover mid-port.

## Prioritized porting plan

| Phase | Goal | Features | Suggested Node stack |
|---|---|---|---|
| **0 — Foundation** | Nothing works without this | Site/config bootstrap, DB connection, Redis connection | Fastify/Express, Knex or Prisma (raw query needs favor Knex), ioredis |
| **1 — Meta engine** | The actual core of Frappe | DocType schema definition + storage, schema sync (create/alter tables from schema), basic field types | Custom DocType registry + Knex schema builder; Zod for field validation |
| **2 — ORM & CRUD** | Make DocTypes usable | Document class w/ lifecycle hooks, child tables, Link/Fetch fields, naming series | Custom `Document` class per DocType; hook system via EventEmitter |
| **3 — API + Auth** | Make it a usable backend | Auto REST API per DocType, whitelisted RPC methods, session auth, role permissions | Fastify routes generated from meta; JWT/session middleware |
| **4 — Row-level security** | Needed before real multi-user use | User Permissions, field-level permission checks | Query filter injection layer |
| **5 — Background & real-time** | Async workhorse features | Job queue, scheduler, Socket.IO live updates | BullMQ, node-cron, socket.io |
| **6 — Low-code layer** | Big productivity multiplier | Server Scripts (sandboxed JS eval), Workflow engine, Notifications | `vm2`/isolated-vm for sandboxing, custom state machine |
| **7 — UI shell** | Makes it demoable | Generic list/form view driven by meta, Report Builder | React/Vue SPA reading DocType meta from API |
| **8 — Document lifecycle extras** | Polish for "real" ERP use | Submittable docs (draft/submit/cancel/amend), version tracking | — |
| **9 — Peripheral features** | Nice-to-have, not blocking | Print format/PDF, Data Import/Export, website engine, multi-tenant sites, backups | Puppeteer/pdf-lib, multer |

**Recommended learning path:** build Phases 0–3 first against one toy DocType (e.g. "Task") until you can create a schema, get a working REST CRUD API, and enforce basic role checks. That's the smallest slice that proves the meta-driven architecture actually works — everything after is additive.
