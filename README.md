# Customer Rep Dashboard Generator

A prompt-to-UI system for billing support reps. Describe a customer issue in plain language and instantly get a fully-rendered, data-populated investigative dashboard — no manual querying, no static reports.

<video src="https://68fwap572n8u3jpb.public.blob.vercel-storage.com/sui-demo/gen-cs-rep-dashboard-demo" controls width="100%">
  <a href="https://68fwap572n8u3jpb.public.blob.vercel-storage.com/sui-demo/gen-cs-rep-dashboard-demo">▶ Watch the demo</a>
</video>

**[▶ Watch the demo](https://68fwap572n8u3jpb.public.blob.vercel-storage.com/sui-demo/gen-cs-rep-dashboard-demo)**

## What it does

A rep types something like _"Alice was double-charged this week — investigate"_ and the system:

1. Runs a Gemini call to produce a structured `DataPlan` — what data to fetch, what aggregations to compute, which deduplication strategy to apply
2. Queries PocketBase (running in Daytona) for the customer's charges, invoices, and aggregates
3. Runs a second Gemini call to produce a complete **A2UI v0.8** surface definition — a component tree describing a live dashboard
4. Renders the dashboard via a custom A2UI renderer with Tremor charts, persists it, and redirects the rep to a stable shareable URL

The LLM output is not text to be read — it is a UI to be rendered.

## Stack

| Layer | Tech |
|-------|------|
| Generative UI protocol | [A2UI v0.8](https://a2ui.org) |
| LLM | Gemini 2.5 Flash via LangChain |
| Database | PocketBase (in Daytona cloud sandbox) |
| Frontend + Backend | Next.js 16 App Router |
| Charts | Tremor React (`TremorBarChart`, `TremorLineChart`, `TremorDonutChart`) |
| Dev environment | Daytona (provisioned via TypeScript SDK) |

## Setup

### 1. Prerequisites

- Node.js 18+
- A [Daytona](https://app.daytona.io) account and API key
- A [Google AI Studio](https://aistudio.google.com) Gemini API key

### 2. Configure environment

```bash
cp .env.example .env
# Fill in: DAYTONA_API, GEMINI_API_KEY, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD
```

### 3. Provision PocketBase in Daytona

This downloads PocketBase into a Daytona sandbox, creates the schema, seeds demo data, and updates `app/.env.local` with the tunnel URL automatically.

```bash
npm install
npx tsx scripts/daytona-pb-setup.ts
```

### 4. Open the SSH tunnel

The Next.js app connects to PocketBase via an SSH tunnel (Daytona's proxy requires browser OAuth; the tunnel bypasses it for server-side requests).

```bash
ssh -o StrictHostKeyChecking=no -L 8091:localhost:8090 -N -f \
  <token>@ssh.app.daytona.io
```

The token is printed by the setup script. `app/.env.local` is pre-set to `PB_URL=http://127.0.0.1:8091`.

### 5. Run the app

```bash
cd app
npm install --legacy-peer-deps
npm run dev
```

Open `http://localhost:3000`.

## Demo prompts

**Double charge investigation**
> Customer alice.martin@example.com says they were double-charged this week. Build a view to investigate: recent charges, suspected duplicates, totals over time, and breakdown by merchant.

**Unauthorized charge investigation**
> Customer alice.martin@example.com reports an unauthorized charge. Build a view to verify: recent charges, merchant/category breakdown, anomalies, and any related refunds/reversals.

## Demo customers

| Email | Status | Notes |
|-------|--------|-------|
| alice.martin@example.com | active | 16 charges, deterministic double-charge pair (CloudInfra Ltd, $49.99, 90s apart) |
| bob.chen@example.com | suspended | 8 charges, consecutive failures near suspension |
| carla.reyes@example.com | active (trial) | 5 charges, no invoices |

## How the generative UI works

The A2UI catalog (`app/catalog.json`) is a shared JSON contract between the LLM prompt and the frontend renderer. The LLM is constrained to emit only components defined in the catalog. A few-shot example in the system prompt demonstrates correct message structure, data-path bindings, and field-scoped tables.

The custom React renderer (`app/components/A2UIRenderer.tsx`) processes `beginRendering` and `surfaceUpdate` messages, resolves data-model paths (e.g. `/aggregates/by_day`, `/suspected_duplicates`) into live values, and renders the component tree — including the three custom Tremor chart components registered into the catalog.

Every generated view is stored in PocketBase and accessible at `/generated/:id`, making investigation dashboards shareable by URL.
