# Ticket time tracking — design

2026-07-11. Extends the ticket foundation added in `f2e315d` (schema table +
`tickets.create` mutation) into a full feature: a creation form, a tickets page
with table and card views, client/project detail pages that list tickets, and
per-client hours for the current billing period and trailing 3 mo / 6 mo / 1 yr
windows.

## Goals

1. Form to create tickets, attributed to a project (and its client).
2. `/tickets` page with **both** a table view and a card view, toggleable.
3. Client detail and project detail pages, each listing that entity's tickets.
4. Client detail shows hours for: current billing period, 3 months, 6 months,
   1 year.

Out of scope (future work): editing/deleting tickets, external-tracker sync
(GitHub/Jira/Linear APIs), and automatically attributing tracked time to a
ticket via the heartbeat `task` field (which is the git branch — a natural
future join key for branch-per-ticket workflows).

## Decisions

- **"Current billing period" = since the client's last successful invoice**
  (`open`/`paid`/`void`, by `createdAt`), or all history if never invoiced.
  This matches the watermark semantics `revenue.repoUnbilledBreakdown` already
  uses; Ledger has no calendar billing cycle.
- **Tracked vs ticketed hours are reported separately.** Tracked hours come
  from heartbeats via `billableMs` (per-device sessionization + interval
  union), the same math invoicing uses. Ticket hours are the sum of declared
  `totalTimeMs`, bucketed by ticket `_creationTime`. Adding them together
  would double-count when tracked work was also declared on a ticket, so the
  UI shows tracked as the headline number and ticketed as a secondary line.
- **No schema changes beyond one index.** The `tickets` table from `f2e315d`
  stays as-is; add `by_user_project ["userId", "projectId"]` for the project
  detail page. `clientId` stays denormalized on the ticket (a project may have
  no client, so the form asks for both, auto-filling client from the project).
- **Reactive bounded scans, no caches.** Hours queries follow the existing
  `REPO_SCAN_LIMIT`+`truncated` pattern rather than aggregate tables or crons —
  consistent with `revenue.ts` and right for this data volume. Alternatives
  considered: `@convex-dev/aggregate` (overkill at this scale) and a cached
  per-client figure like `unbilledMsCache` (stale, more moving parts).
- **All new Convex functions live in existing modules** (`tickets.ts`,
  `clients.ts`, `projects.ts`) so the checked-in `_generated/api.d.ts` needs no
  regeneration.

## Backend (cloud/convex)

### schema.ts

Add to `tickets`: `.index("by_user_project", ["userId", "projectId"])`.

### tickets.ts — list queries

Shared `ticketView` validator: `_id`, `externalId`, `name`,
`description?`, `clientId`, `clientName`, `projectId`, `projectName`,
`totalTimeMs`, `createdAt` (`_creationTime`). Joins resolve via
`loadClientMap` plus a project id→display-name map (projects
`by_user_name` take 500, `displayName ?? name`); missing joins render
`"(unknown …)"` rather than throwing.

- `list({})` — all of the user's tickets: `by_user_external` prefix on
  `userId`, `take(500)`, sorted newest-first by `_creationTime` in JS.
- `listByClient({ clientId })` — verify ownership (ConvexError "Client not
  found"), `by_user_client`, `take(500)`, newest first.
- `listByProject({ projectId })` — verify ownership, new `by_user_project`,
  `take(500)`, newest first.

### clients.ts — get + hoursSummary

- `get({ id })` → `v.union(clientView, v.null())`. Returns `null` for
  missing/foreign/archived ids (detail page renders "not found" instead of
  crashing on a stale URL).
- `hoursSummary({ clientId })` → for the client's projects
  (`projects.by_user_client`):

  ```
  {
    periods: [
      { key: "billingPeriod" | "3m" | "6m" | "1y",
        sinceMs: number | null,   // cutoff; null = never invoiced (all time)
        trackedMs: number,
        ticketMs: number },
      ...
    ],
    truncated: boolean,
  }
  ```

  - Billing-period cutoff: max `createdAt` of this client's `open|paid|void`
    invoices (`invoices.by_user_client`, take 1000); `null` if none.
  - Trailing cutoffs: `now − 90/180/365` days.
  - One heartbeat scan per project via `by_user_project_synced` with
    `gte("syncedAt", minCutoff)` where `minCutoff = min(billingCutoff ?? 0,
    now − 365 d)`, capped at 10 000 rows/project with an extra row to set
    `truncated` (`syncedAt >= ts`, so the indexed superset is narrowed by
    `ts` in JS — same trick as `repoUnbilledBreakdown`). Scan `.order("desc")`
    so a truncated scan keeps the *most recent* rows — the windows are
    anchored at now (the `activityByWindow` precedent, not
    `repoUnbilledBreakdown`'s ascending scan).
  - Per period: filter the combined rows to `ts >= cutoff`, then one
    `billableMs(rows, idleThresholdMs)` across all of the client's projects
    and devices together, so concurrent multi-project time counts once.
  - Ticket ms per period: client's tickets (`by_user_client`, take 500),
    sum `totalTimeMs` where `_creationTime >= cutoff` (billing period with
    `null` cutoff counts all).
  - Throws ConvexError "Client not found" on bad ownership (the page gates
    this query on `get` having resolved).

### projects.ts — get

`get({ id })` → `v.union(projectView, v.null())` (same view as `list`,
including `clientName` and `effectiveRateCents`); `null` for
missing/foreign/archived.

### Tests (convex-test, existing conventions)

Extend `tickets.test.ts`: list/listByClient/listByProject — join fields,
newest-first order, cross-user isolation, ownership rejections. New
`clients.test.ts` (name matches module under test, like `billing.test.ts`):
`get` null-for-foreign/archived; `hoursSummary` with seeded settings
(idleThresholdMs), heartbeats placed inside/outside each window across two
devices/projects (overlap counted once), an invoice watermark splitting the
billing period, and tickets on both sides of a cutoff. Seed via `t.run`
inserts; identities via `t.withIdentity({ subject })`.

## Frontend (cloud/web)

TanStack Start file routes; data via `convex/react` `useQuery`/`useMutation`;
`api` from `@/convex-api`; tabs + double quotes (Biome); shadcn-style ui kit.

### New routes

| File (src/routes/) | Path | Note |
| --- | --- | --- |
| `_app/tickets.tsx` | `/tickets` | list + form |
| `_app/clients_.$clientId.tsx` | `/clients/$clientId` | trailing `_` on `clients_` un-nests from `clients.tsx`, which has no `<Outlet/>` |
| `_app/projects_.$projectId.tsx` | `/projects/$projectId` | same un-nesting |

Regenerate `routeTree.gen.ts` with `pnpm --filter web generate-routes`. Add
`{ to: "/tickets", label: "Tickets" }` to `NAV` in `app-shell.tsx`.

### Shared components

- `ui/textarea.tsx` — minimal shadcn-style textarea (kit lacks one; ticket
  descriptions want multiline).
- `ticket-form-dialog.tsx` — `TicketFormDialog({ defaultProjectId?,
  defaultClientId?, onClose })`. Fields: name*, external id*, description
  (textarea), project* (native `Select` from `api.projects.list`, label
  `displayName ?? name`), client* (native `Select` from `api.clients.list`,
  auto-set to the chosen project's `clientId` when it has one, user-pickable
  otherwise), time spent* (decimal hours input → `Math.round(h × 3 600 000)`,
  reject negative/NaN). Submits `api.tickets.create`; ConvexError surfaced
  via `errorMessage(err, …)` in the standard dialog error slot; parent state
  `useState<boolean>` open-flag like `clients.tsx`'s dialog pattern.
- `tickets-section.tsx` — `TicketsSection({ tickets, showClient?,
  showProject? })` with `tickets: TicketRow[] | undefined` (undefined =
  loading skeleton). Header row holds a **Table | Cards** segmented toggle
  (Button + `aria-pressed`, the `RangeSelector` precedent; `useState`,
  default table). Table view: ui `Table` on `md:`+ with the existing
  `MobileCardList` fallback below `md`; columns External ID, Name, Client
  (link), Project (link), Time (`formatDurationMs`), Created (date). Card
  view: responsive `Card` grid (1/2/3 cols) — title name, subtitle
  externalId, description clamped, client/project links, time + created
  footer. `showClient={false}` on the client page, `showProject={false}` on
  the project page. Exports `TicketRow` (explicit fields, `RepoRow`
  precedent). Empty state: "No tickets yet."

### Pages

- `/tickets`: `PageHeader("Tickets")` + "New ticket" button →
  `TicketFormDialog`; `TicketsSection` over `api.tickets.list`.
- `/clients/$clientId`: `useQuery(api.clients.get, { id })`; `null` → "Client
  not found" + back link. Header: name, email, rate, Stripe badge (reuse list
  page's presentation), "New ticket" (client prefilled). Hours: 4 stat tiles
  (dashboard `StatCard` pattern) — labels "Current period" (sub-label "since
  <date>" or "all time"), "Last 3 months", "Last 6 months", "Last year";
  headline `formatHours(trackedMs)`, secondary "+ n h ticketed"
  (`formatHours(ticketMs)`), truncation note when `truncated`. Tickets:
  `TicketsSection showClient={false}` over `listByClient`. Gate
  `hoursSummary`/`listByClient` with `"skip"` until `get` resolves non-null.
- `/projects/$projectId`: `api.projects.get`; `null` → "Project not found".
  Header: display name, client (link to client detail when assigned),
  effective rate, unbilled estimate (`formatDurationMs(unbilledMsCache)`).
  "New ticket" (project + its client prefilled). `TicketsSection
  showProject={false}` over `listByProject` (skip-gated).
- List pages: client name in `clients.tsx` and project name in `projects.tsx`
  (table cell + `MobileCard` title) become `Link`s to the detail routes.

## Error handling

Backend: `ConvexError` for every user-facing failure (plain `Error` is
redacted client-side). Frontend: `get` queries return `null` → friendly
not-found states; mutations catch and render `errorMessage()`; dependent
queries use `"skip"` so an unauthorized/missing parent never fires them.

## Verification

`pnpm --filter ledger-cloud test` (vitest, edge-runtime); `tsc --noEmit` in
`cloud/web` (and convex tsconfig); `pnpm --filter web generate-routes`;
`pnpm --filter web check` (Biome) and `build` (vite). Then an adversarial
multi-agent review of the full diff; confirmed findings fixed.
