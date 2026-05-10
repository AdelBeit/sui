# Sui Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        BROWSER (User)                                │
│                                                                     │
│  ┌──────────────────────────┐    ┌────────────────────────────────┐ │
│  │  / (Home Page)           │    │  /generated/[id]               │ │
│  │  app/page.tsx            │───>│  app/generated/[id]/page.tsx   │ │
│  │                          │    │                                │ │
│  │  • Textarea prompt input │    │  • A2UIRenderer component      │ │
│  │  • Demo suggestion pills │    │  • Renders A2UI surface JSON   │ │
│  └──────────┬───────────────┘    └────────────────────────────────┘ │
└─────────────┼───────────────────────────────────────────────────────┘
              │ POST /api/generate
              │ { prompt, customerEmail }
              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   NEXT.JS 16 (App Router)                           │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  app/api/generate/route.ts  (POST handler)                   │   │
│  │                                                              │   │
│  │  1. getDataPlan()       ───────────>  Google Gemini 2.5 Flash│   │
│  │     (structured output via LangChain)                         │   │
│  │     Returns: use_case, date_window, group_bys, etc.          │   │
│  │                                                              │   │
│  │  2. findCustomerByEmail() ─────────>  PocketBase             │   │
│  │     getCharges(), getInvoices()       (customers, charges,   │   │
│  │                                       invoices collections)  │   │
│  │                                                              │   │
│  │  3. computeDataModel()        [lib/aggregates.ts]            │   │
│  │     Aggregates charges by day/merchant/category              │   │
│  │     Detects suspected duplicate charges                      │   │
│  │                                                              │   │
│  │  4. getA2UISurface()     ───────────>  Google Gemini 2.5 Flash│   │
│  │     (prompt + data → A2UI JSON surface)                      │   │
│  │                                                              │   │
│  │  5. insertGeneratedView() ─────────>  PocketBase             │   │
│  │     Saves generated_views record       (generated_views)     │   │
│  │                                                              │   │
│  │  Returns: { id }  ──>  redirect to /generated/[id]           │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Frontend Components:                                               │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  A2UIRenderer  (components/A2UIRenderer.tsx)                 │   │
│  │  • Parses A2UI v0.8 surface messages (beginRendering +       │   │
│  │    surfaceUpdate)                                             │   │
│  │  • Resolves data paths from DataModel (e.g. /charges)        │   │
│  │  • Renders component tree: Column, Row, Card, Text, List,    │   │
│  │    Divider                                                    │   │
│  │  • Tremor charts: BarChart, LineChart, DonutChart            │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                       EXTERNAL SERVICES                             │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │  Google Gemini    │  │  PocketBase      │  │  Daytona         │  │
│  │  (AI/LLM)        │  │  (Database)      │  │  (Sandbox Host)  │  │
│  │                  │  │                  │  │                  │  │
│  │  @langchain/     │  │  customers       │  │  Hosts PocketBase│  │
│  │  google-genai    │  │  charges         │  │  in a sandbox    │  │
│  │                  │  │  invoices        │  │  SDK manages     │  │
│  │  • Data planning │  │  generated_views │  │  preview tokens  │  │
│  │  • UI generation │  │                  │  │  & proxy access  │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Stack

| Layer | Tool | Purpose |
|---|---|---|
| Framework | **Next.js 16** (App Router) | Full-stack React, API routes, SSR |
| UI | **React 18** + **Tailwind CSS 4** + **Tremor** | Components, styling, charts |
| AI/LLM | **Google Gemini 2.5 Flash** via **LangChain** | Data planning & A2UI surface generation |
| Database | **PocketBase** | Customers, charges, invoices, generated views |
| Sandbox | **Daytona SDK** | Hosts PocketBase remotely with auth proxy |
| Validation | **Zod** | Structured output schema for LLM responses |
| UI Protocol | **A2UI v0.8** | AI-generated UI spec rendered by custom renderer |

## Flow

User types a billing issue prompt → Next.js API route sends it to Gemini to plan what data to fetch → fetches customer/charges/invoices from PocketBase → aggregates the data → sends data + plan back to Gemini to generate an A2UI surface → saves result to PocketBase → redirects to a page that renders the AI-generated dashboard.
