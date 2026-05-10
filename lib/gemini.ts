import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { z } from 'zod';
import { HumanMessage } from '@langchain/core/messages';
import type { DataModel } from './aggregates';
import catalogJson from '../catalog.json';

const DataPlanSchema = z.object({
  use_case: z.enum(['double_charge_investigation', 'unauthorized_charge_investigation']),
  customerEmail: z.string().email(),
  date_window_days: z.number().int().min(1).max(90),
  include_invoices: z.boolean(),
  include_charges: z.boolean(),
  charge_row_limit: z.number().int().min(1).max(500),
  group_bys: z.array(z.enum(['day', 'merchant', 'category'])),
  dedupe_strategy: z.enum(['same_merchant_amount_day', 'same_merchant_amount_2min_window']),
  ui_focus: z.string().max(200),
});

export type DataPlan = z.infer<typeof DataPlanSchema>;

function getModel() {
  return new ChatGoogleGenerativeAI({
    model: 'gemini-2.5-flash',
    apiKey: process.env.GEMINI_API_KEY,
  });
}

export async function getDataPlan(prompt: string, customerEmail: string): Promise<DataPlan> {
  const model = getModel();
  const structured = model.withStructuredOutput(DataPlanSchema);

  const systemPrompt = `You are a billing support data planner. Given a support rep's prompt and customer email, output a DataPlan JSON.
Rules:
- use_case must be one of: double_charge_investigation, unauthorized_charge_investigation
- customerEmail: echo back the provided email
- date_window_days: how many days back to look (1-90)
- charge_row_limit: max charges to fetch (1-500, default 100)
- group_bys: which aggregations to compute (day, merchant, category)
- dedupe_strategy: use same_merchant_amount_2min_window for double charge, same_merchant_amount_day for general
- ui_focus: short description of what to highlight in the UI (max 200 chars)

Customer email: ${customerEmail}
Rep prompt: ${prompt}`;

  async function attempt(): Promise<DataPlan> {
    const result = await structured.invoke([new HumanMessage(systemPrompt)]);
    return result as DataPlan;
  }

  try {
    return await attempt();
  } catch {
    return await attempt();
  }
}

const FALLBACK_SURFACE = {
  title: 'Unable to generate view',
  a2ui_messages: [
    {
      beginRendering: {
        surfaceId: 's1',
        root: 'root',
        catalogId: 'https://billing-demo.internal/catalog/v1',
      },
    },
    {
      surfaceUpdate: {
        surfaceId: 's1',
        components: [
          {
            id: 'root',
            component: { Card: { children: { explicitList: ['msg'] } } },
          },
          {
            id: 'msg',
            component: {
              Text: {
                text: {
                  literalString:
                    'Could not generate a view for this prompt. Try being more specific about the billing issue.',
                },
                usageHint: 'body',
              },
            },
          },
        ],
      },
    },
  ],
};

export async function getA2UISurface(
  prompt: string,
  dataPlan: DataPlan,
  dataModel: DataModel
): Promise<{ title: string; a2ui_messages: unknown[] }> {
  const model = getModel();

  const sectionOrder = dataPlan.use_case === 'double_charge_investigation'
    ? `1. Summary metrics row (total spend, charge count)
2. Suspected duplicates card — FIRST and most prominent if duplicates exist
3. Recent charges table card
4. Charts card (TremorBarChart by day, TremorDonutChart by merchant)`
    : `1. Summary metrics row (total spend, charge count)
2. Recent charges table card
3. Charts card (TremorDonutChart by category, TremorDonutChart by merchant)
4. Refunds/reversals section if any charges have status=refunded or reversed`;

  const systemPrompt = `You are a billing UI generator. Generate an A2UI v0.8 surface for a billing support rep.

Rep prompt: ${prompt}

DataPlan:
- use_case: ${dataPlan.use_case}
- ui_focus: ${dataPlan.ui_focus}
- date_window_days: ${dataPlan.date_window_days}

Available data model paths:
- /customer/full_name, /customer/email, /customer/status, /customer/plan_code
- /charges — array of { id, posted_at, amount_cents, merchant, category, status }
- /aggregates/total_cents, /aggregates/charge_count
- /aggregates/by_day — array of { date, total_cents, count }
- /aggregates/by_merchant — array of { merchant, total_cents, count }
- /aggregates/by_category — array of { category, total_cents, count }
- /suspected_duplicates — array of { merchant, amount_cents, posted_at_1, posted_at_2 }

Data sizes: charges=${dataModel.charges.length}, suspected_duplicates=${dataModel.suspected_duplicates.length}, by_day=${dataModel.aggregates.by_day.length}, by_merchant=${dataModel.aggregates.by_merchant.length}

=== SECTION ORDER (follow exactly) ===
${sectionOrder}

=== LAYOUT RULES ===
- Customer header: one Row with distribution=spaceBetween — left side Text h2 path=/customer/full_name, right side Text caption path=/customer/email. No literal "Customer:" labels.
- Summary metrics: one Row with 3 Text components showing total_cents, charge_count, and date window as a literalString.
- Money formatting: all *_cents fields are stored in cents. Do NOT add labels like "cents" or "amount cents" in UI copy; use friendly labels like "Amount" or "Total". (The renderer formats *_cents values as dollars.)
- Sensitive/low-signal fields: avoid showing internal IDs (e.g. id, processor_txn_id) unless the rep explicitly asks for them.
- Divider: use ONLY inside a Card to separate sub-sections. NEVER between Cards — Cards already have visual separation.
- List component: always include a "fields" array to show only relevant columns. For charges use fields=["merchant","amount_cents","posted_at","status"]. For suspected_duplicates use fields=["merchant","amount_cents","posted_at_1","posted_at_2"]. Never use itemTemplate.
- Charts: TremorBarChart for by_day (indexKey="date", valueKey="total_cents"), TremorDonutChart for by_merchant (categoryKey="merchant", valueKey="total_cents") and by_category (categoryKey="category", valueKey="total_cents").
- Wrap each major section in a Card with a clear title.
- Component IDs must be unique snake_case strings.

=== OUTPUT FORMAT (follow exactly) ===
Return ONLY this JSON structure — no markdown, no explanation:
{
  "title": "short descriptive title",
  "a2ui_messages": [
    { "beginRendering": { "surfaceId": "s1", "root": "root", "catalogId": "https://billing-demo.internal/catalog/v1" } },
    { "surfaceUpdate": { "surfaceId": "s1", "components": [ ...ALL components here, never in beginRendering... ] } }
  ]
}

=== EXAMPLE (double_charge_investigation) ===
{
  "title": "Alice Martin - Double Charge Investigation",
  "a2ui_messages": [
    { "beginRendering": { "surfaceId": "s1", "root": "root", "catalogId": "https://billing-demo.internal/catalog/v1" } },
    { "surfaceUpdate": { "surfaceId": "s1", "components": [
      { "id": "root", "component": { "Column": { "children": { "explicitList": ["header_row", "metrics_row", "duplicates_card", "charges_card", "charts_card"] } } } },
      { "id": "header_row", "component": { "Row": { "distribution": "spaceBetween", "alignment": "center", "children": { "explicitList": ["cust_name", "cust_email"] } } } },
      { "id": "cust_name", "component": { "Text": { "text": { "path": "/customer/full_name" }, "usageHint": "h2" } } },
      { "id": "cust_email", "component": { "Text": { "text": { "path": "/customer/email" }, "usageHint": "caption" } } },
      { "id": "metrics_row", "component": { "Row": { "distribution": "spaceBetween", "alignment": "center", "children": { "explicitList": ["m_total", "m_count", "m_window"] } } } },
      { "id": "m_total", "component": { "Text": { "text": { "path": "/aggregates/total_cents" }, "usageHint": "h3" } } },
      { "id": "m_count", "component": { "Text": { "text": { "path": "/aggregates/charge_count" }, "usageHint": "h3" } } },
      { "id": "m_window", "component": { "Text": { "text": { "literalString": "Last 7 days" }, "usageHint": "caption" } } },
      { "id": "duplicates_card", "component": { "Card": { "title": "Suspected Duplicates", "children": { "explicitList": ["dupes_list"] } } } },
      { "id": "dupes_list", "component": { "List": { "dataPath": "/suspected_duplicates", "fields": ["merchant", "amount_cents", "posted_at_1", "posted_at_2"], "emptyText": "No suspected duplicates found." } } },
      { "id": "charges_card", "component": { "Card": { "title": "Recent Charges", "children": { "explicitList": ["charges_list"] } } } },
      { "id": "charges_list", "component": { "List": { "dataPath": "/charges", "fields": ["merchant", "amount_cents", "posted_at", "status"], "emptyText": "No charges found." } } },
      { "id": "charts_card", "component": { "Card": { "title": "Spend Analysis", "children": { "explicitList": ["chart_by_day", "div1", "chart_by_merchant"] } } } },
      { "id": "chart_by_day", "component": { "TremorBarChart": { "dataPath": "/aggregates/by_day", "indexKey": "date", "valueKey": "total_cents", "title": "Daily Spend" } } },
      { "id": "div1", "component": { "Divider": {} } },
      { "id": "chart_by_merchant", "component": { "TremorDonutChart": { "dataPath": "/aggregates/by_merchant", "categoryKey": "merchant", "valueKey": "total_cents", "title": "By Merchant" } } }
    ] } }
  ]
}

Now generate the surface for the actual data below. Follow the example structure exactly.
Catalog for reference: ${JSON.stringify(catalogJson)}`;

  async function attempt(): Promise<{ title: string; a2ui_messages: unknown[] }> {
    const res = await model.invoke([new HumanMessage(systemPrompt)]);
    const raw = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');

    const parsed = JSON.parse(jsonMatch[0]);
    if (typeof parsed.title !== 'string') throw new Error('Missing title');
    if (!Array.isArray(parsed.a2ui_messages)) throw new Error('Missing a2ui_messages array');

    return { title: parsed.title, a2ui_messages: parsed.a2ui_messages };
  }

  try {
    return await attempt();
  } catch {
    try {
      return await attempt();
    } catch {
      return FALLBACK_SURFACE;
    }
  }
}
