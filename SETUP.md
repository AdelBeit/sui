# Setup

## Prerequisites

- Node.js 18+
- PocketBase binary (Linux)

## Steps

### 1. Download PocketBase

```bash
# From repo root
wget https://github.com/pocketbase/pocketbase/releases/latest/download/pocketbase_linux_amd64.zip
unzip pocketbase_linux_amd64.zip
```

### 2. Run PocketBase

```bash
./pocketbase serve --http=0.0.0.0:8090 --dir ./pb_data
```

Open `http://localhost:8090/_/` to create the admin account.

### 3. Configure environment

```bash
# Repo root (for scripts)
cp .env.example .env
# Fill in PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD, GEMINI_API_KEY

# App
cp app/.env.local.example app/.env.local
# Fill in same values
```

### 4. Create PocketBase schema

```bash
npx tsx scripts/setup-pb-schema.ts
```

### 5. Seed demo data

```bash
npx tsx scripts/seed-pb.ts
# Prints: double charge pair IDs: <id1>, <id2>
```

### 6. Run the app

```bash
cd app
npm install --legacy-peer-deps
npm run dev
```

Open `http://localhost:3000`.

## Demo prompts

**Prompt A (Double Charge):**
> Customer alice.martin@example.com says they were double-charged this week. Build a view to investigate: recent charges, suspected duplicates, totals over time, and breakdown by merchant.

**Prompt B (Unauthorized Charge):**
> Customer alice.martin@example.com reports an unauthorized charge. Build a view to verify: recent charges, merchant/category breakdown, anomalies, and any related refunds/reversals.
