# Prompt-to-A2UI MVP Plan (Next.js + PocketBase in Daytona + Gemini + LangChain)

## Summary
Support reps enter a prompt (and customer email). The system generates a customer-specific investigative UI:

1. Gemini call 1 produces a strict `DataPlan` JSON.
2. Backend queries PocketBase and computes UI-ready aggregates into `data_model`.
3. Gemini call 2 produces an A2UI v0.8 surface constrained by a shared `catalog.json`.
4. Backend stores `{prompt, data_model, a2ui_messages}` in PocketBase and redirects to `/generated/:id` to render it.

Everything runs in Daytona. PocketBase runs as a downloaded binary. Frontend and backend are a single Next.js app (Route Handlers).

## End-to-End Flow (Text Diagram)
```
[Rep] -> [Next.js UI: /chat or /new-view]
  |
  | POST /api/generate { prompt, customerEmail }
  v
[Next.js Route Handler: /api/generate]
  |
  | Gemini Call 1: DataPlan (strict JSON)
  |  - decides use_case (limited to 2 billing demos)
  |  - date window, row limits, group-bys, dedupe heuristic
  |
  | PocketBase queries (read-only)
  |  - lookup customer by email
  |  - fetch charges + invoices (bounded)
  |  - compute aggregates (series, totals, merchant breakdown, suspected duplicates)
  |  => data_model
  |
  | Gemini Call 2: A2UI surface
  |  - inputs: original prompt, DataPlan summary, allowed catalog.json, data_model keys/schema
  |  - output: { title, a2ui_messages } (A2UI v0.8 JSON only)
  |  - validate against A2UI v0.8 + catalog; 1 repair retry; else fallback error surface
  |
  | Insert generated_views in PocketBase -> {id}
  v
[Next.js UI redirects] -> /generated/:id
  |
  | GET /api/generated/:id
  v
[Next.js Route Handler returns] { title, data_model, a2ui_messages }
  v
[React A2UI Renderer] -> renders with custom chart components
```

## PocketBase (Daytona-only)

### Runtime
- Download PocketBase Linux release binary inside Daytona (use latest stable at implementation time).
- Run:
  - `./pocketbase serve --http=0.0.0.0:8090 --dir ./pb_data`
- Port-forward `8090` for Admin UI access.
- One-time manual step: create PB admin user in Admin UI (`http://localhost:8090/_/` after port-forward).
- Persist data in repo-local `./pb_data` (add to `.gitignore`).

### Environment Variables (Daytona)
- `PB_URL` = `http://127.0.0.1:8090`
- `PB_ADMIN_EMAIL`
- `PB_ADMIN_PASSWORD`
- `PB_SEED_ANCHOR` default `2026-05-09T00:00:00Z`

## PocketBase Schema (created by script via Admin API)
The seed/setup script ensures these collections exist with these fields. If an incompatible field exists, fail fast.

### `customers`
- `email` (text, required)
- `full_name` (text, required)
- `region` (select: `US`, `EU`, `APAC`)
- `status` (select: `active`, `suspended`, `closed`)
- `plan_code` (text)
- `billing_portal_enabled` (bool)
- `billing_portal_hidden` (bool)

### `invoices`
- `customer` (relation -> `customers`, required)
- `invoice_number` (text, required)
- `issued_at` (date, required)
- `period_start` (date)
- `period_end` (date)
- `currency` (text, default `USD`)
- `total_cents` (number, required)
- `status` (select: `open`, `paid`, `void`)

### `charges`
- `customer` (relation -> `customers`, required)
- `invoice` (relation -> `invoices`, optional)
- `posted_at` (date, required)
- `amount_cents` (number, required)
- `currency` (text, default `USD`)
- `merchant` (text, required)
- `descriptor` (text, required)
- `category` (select: `subscription`, `usage`, `tax`, `refund`, `adjustment`, `other`)
- `status` (select: `captured`, `reversed`, `refunded`, `failed`)
- `processor` (text, required)
- `processor_txn_id` (text, required)

### `generated_views`
- `customer` (relation -> `customers`, required)
- `prompt` (text, required)
- `title` (text, required)
- `data_model` (json, required)
- `a2ui_messages` (json, required)

Seed constraints:
- Deterministic timestamps anchored to `PB_SEED_ANCHOR`.
- Wipe-and-recreate for the three demo customer emails.
- Enforce `processor_txn_id` uniqueness in the seed script.

## LLM Integration (LangChain + Gemini AI Studio)

### Environment Variables (Daytona)
- `GEMINI_API_KEY` (Google AI Studio)
- `A2UI_SPEC_VERSION=v0.8`
- `A2UI_CATALOG_PATH=./catalog.json`

### Gemini Call 1: Strict `DataPlan`
Gemini returns strict JSON only (validated server-side):
- `use_case`: enum `{ "double_charge_investigation", "unauthorized_charge_investigation" }`
- `customerEmail`: echo input
- `date_window_days`: int (cap server-side, e.g. max 90)
- `include_invoices`: bool
- `include_charges`: bool
- `charge_row_limit`: int (cap server-side, e.g. max 500)
- `group_bys`: array of enums `{ "day", "merchant", "category" }`
- `dedupe_strategy`: enum `{ "same_merchant_amount_day", "same_merchant_amount_2min_window" }`
- `ui_focus`: short string

If invalid: 1 repair retry, else return an error response.

### Data Fetch + Aggregates (no LLM)
Backend (Next.js route handler) reads from PocketBase and computes:
- Totals: sum/count by day, merchant, category
- Suspected duplicates list per `dedupe_strategy`
- Chart-ready series arrays

Persist `data_model` as raw rows + computed aggregates for MVP speed.

### Gemini Call 2: A2UI v0.8 surface
Inputs:
- Rep prompt
- DataPlan summary
- `catalog.json`
- `data_model` contract: available keys + example shapes

Output:
- JSON only: `{ title, a2ui_messages }`

Validation:
- A2UI v0.8 schema compliance
- Catalog compliance (component names/props only)
- Data bindings must reference `data_model` only

Fallback:
- Deterministic error surface (Card/Text) suggesting prompt changes.

## A2UI Renderer + Catalog
- Use the official A2UI React renderer (v0.8).
- Catalog lives as a static JSON file shared by backend and frontend.
- Implement 3 custom chart components backed by `@tremor/react`:
  - `TremorBarChart` (props: `dataPath`, `indexKey`, `valueKey`, `title`)
  - `TremorLineChart` (props: `dataPath`, `indexKey`, `valueKey`, `title`)
  - `TremorDonutChart` (props: `dataPath`, `categoryKey`, `valueKey`, `title`)

## Demo Prompts (billing-only, customer-scoped)
Prompt A (double charge):
- “Customer `alice.martin@example.com` says they were double-charged this week. Build a view to investigate: recent charges, suspected duplicates, totals over time, and breakdown by merchant.”

Prompt B (unauthorized charge):
- “Customer `alice.martin@example.com` reports an unauthorized charge. Build a view to verify: recent charges, merchant/category breakdown, anomalies, and any related refunds/reversals.”

## Seed Dataset (in-depth)
Customers (always seeded):
- `alice.martin@example.com`: active US, invoices + dense charges including one deterministic “double charge pair”
- `bob.chen@example.com`: suspended, portal hidden, invoices exist, charges include consecutive failures near suspension period
- `carla.reyes@example.com`: active trial, no invoices, some charges

Determinism:
- All timestamps from `PB_SEED_ANCHOR`
- Seeded RNG for amounts/merchant mix so repeated runs are identical

## Acceptance Checks
- PocketBase reachable in Daytona; Admin UI works via port-forward.
- Seed script exits 0; prints counts and the “double charge pair” identifiers.
- `POST /api/generate` returns `{id}` for each demo prompt.
- `/generated/:id` renders:
  - charges table populated
  - all 3 Tremor charts render from `data_model` paths
  - suspected duplicates section present for Prompt A

