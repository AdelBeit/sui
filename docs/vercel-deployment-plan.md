# Plan: Deploy to Vercel with Daytona-hosted PocketBase

## Context

Next.js 16 App Router frontend, PocketBase running in a Daytona cloud sandbox. All PocketBase calls go through Next.js API routes (`/api/generate`, `/api/generated/[id]`) — the browser never touches PocketBase directly. This server-side proxy pattern is fundamentally compatible with Vercel; no CORS issues exist.

The suspected "networking issues" come from three concrete problems:

1. **Daytona sandbox auto-sleep** — Daytona sandboxes stop after inactivity. When stopped, `PB_URL` returns errors for all requests. This is the most likely cause of intermittent failures from Vercel. Fix: add a Vercel cron that pings PocketBase's health endpoint every 5 minutes to keep the sandbox alive.

2. **No retry on 401** — if the Daytona sandbox restarts mid-session (invalidating cached tokens early), all PocketBase calls fail with 401 until the 55-min TTL expires. There is no retry-and-refresh logic. Fix: add a one-time retry in `pbGet`/`pbPost` that clears both caches and retries on 401.

3. **`NEXT_PUBLIC_BASE_URL` hardcoded to `localhost:3000`** — the client-side code uses this for its fetch calls to `/api/generate` and `/api/generated/[id]`. On Vercel, these calls will hit localhost instead of the deployed URL, breaking the app entirely. Fix: set this env var to the Vercel deployment URL.

## Code Changes

### 1. `lib/pocketbase.ts` — retry-on-401

Add a `pbFetch` helper that catches 401, clears both token caches, and retries once. Both `pbGet` and `pbPost` delegate to it.

```ts
async function pbFetch(url: string, options: RequestInit, retry = true): Promise<Response> {
  const res = await fetch(url, options);
  if (res.status === 401 && retry) {
    cachedPbToken = null; pbTokenExpiry = 0;
    cachedDaytonaPreviewToken = null; daytonaPreviewTokenExpiry = 0;
    const [pbToken, previewToken] = await Promise.all([getAdminToken(), getDaytonaPreviewToken()]);
    // rebuild headers with fresh tokens and retry once
    return pbFetch(url, { ...options, headers: rebuildHeaders(options, pbToken, previewToken) }, false);
  }
  return res;
}
```

### 2. `next.config.ts` — two additions

```ts
const nextConfig: NextConfig = {
  // Prevents Next.js from bundling the Daytona Node.js SDK for edge/serverless
  serverExternalPackages: ['@daytonaio/sdk'],
  // Keep the generate route alive long enough for two Gemini calls + PB queries
  experimental: {}, // maxDuration set per-route via route segment config instead
};
```

Set timeout per-route in `app/api/generate/route.ts`:
```ts
export const maxDuration = 60; // seconds
```

### 3. `app/api/health/route.ts` — new cron-ping route

Vercel cron target that keeps the Daytona sandbox alive:

```ts
import { NextResponse } from 'next/server';
const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8090';
export async function GET() {
  const res = await fetch(`${PB_URL}/api/health`);
  return NextResponse.json({ ok: res.ok, status: res.status });
}
```

### 4. `vercel.json` — cron schedule

```json
{
  "crons": [{ "path": "/api/health", "schedule": "*/5 * * * *" }]
}
```

This pings PocketBase every 5 minutes, preventing Daytona's auto-sleep from kicking in.

## Critical Files

| File | Change |
|------|--------|
| `lib/pocketbase.ts` | Add `pbFetch` helper with retry-on-401 |
| `next.config.ts` | Add `serverExternalPackages: ['@daytonaio/sdk']` |
| `app/api/generate/route.ts` | Add `export const maxDuration = 60` |
| `app/api/health/route.ts` | New file — cron ping target |
| `vercel.json` | New file — cron schedule |

## Vercel Env Vars to Set

In Vercel dashboard → Project Settings → Environment Variables (Production + Preview):

| Variable | Value |
|---|---|
| `PB_URL` | `https://8090-{sandboxId}.daytonaproxy01.net` (from `.env.local`) |
| `PB_ADMIN_EMAIL` | from `.env.local` |
| `PB_ADMIN_PASSWORD` | from `.env.local` |
| `DAYTONA_API` | from `.env.local` |
| `DAYTONA_SANDBOX_ID` | from `.env.local` |
| `GEMINI_API_KEY` | from `.env.local` |
| `A2UI_SPEC_VERSION` | `v0.8` |
| `NEXT_PUBLIC_BASE_URL` | `https://{your-project}.vercel.app` |

Note: `A2UI_CATALOG_PATH` and `PB_SEED_ANCHOR` are not used at runtime — omit them.

## Verification

1. `npm run build` — must pass clean
2. Deploy to preview: `vercel`
3. Check `/api/health` returns `{ ok: true, status: 200 }` — confirms sandbox is reachable from Vercel
4. `POST /api/generate` with valid prompt + email → expect `{ id: "..." }`
5. `GET /api/generated/{id}` → expect the saved view JSON
6. Stop the Daytona sandbox, wait 30s, then hit `/api/generate` — should auto-recover via 401 retry (sandbox restart wakes it; retry fetches fresh token)
