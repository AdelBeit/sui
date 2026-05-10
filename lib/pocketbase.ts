import { Daytona } from '@daytonaio/sdk';

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8090';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL ?? '';
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? '';
const DAYTONA_SANDBOX_ID = process.env.DAYTONA_SANDBOX_ID ?? '';
const DAYTONA_API = process.env.DAYTONA_API ?? '';

let cachedPbToken: string | null = null;
let pbTokenExpiry = 0;

let cachedDaytonaPreviewToken: string | null = null;
let daytonaPreviewTokenExpiry = 0;

async function getDaytonaPreviewToken(): Promise<string | null> {
  if (!DAYTONA_SANDBOX_ID || !DAYTONA_API) return null;
  if (cachedDaytonaPreviewToken && Date.now() < daytonaPreviewTokenExpiry) {
    return cachedDaytonaPreviewToken;
  }
  const daytona = new Daytona({ apiKey: DAYTONA_API, apiUrl: 'https://app.daytona.io/api' });
  const sandbox = await daytona.get(DAYTONA_SANDBOX_ID);
  const preview = (await sandbox.getPreviewLink(8090)) as unknown;
  const token =
    preview &&
    typeof preview === 'object' &&
    'token' in preview &&
    typeof (preview as { token?: unknown }).token === 'string'
      ? ((preview as { token: string }).token as string)
      : null;
  if (!token) return null;
  cachedDaytonaPreviewToken = token;
  daytonaPreviewTokenExpiry = Date.now() + 55 * 60 * 1000;
  return cachedDaytonaPreviewToken;
}

function daytonaHeaders(extra: Record<string, string> = {}, previewToken: string | null): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (previewToken) headers['x-daytona-preview-token'] = previewToken;
  return headers;
}

export async function getAdminToken(): Promise<string> {
  if (cachedPbToken && Date.now() < pbTokenExpiry) return cachedPbToken;

  const previewToken = await getDaytonaPreviewToken();
  const res = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: daytonaHeaders({ 'Content-Type': 'application/json' }, previewToken),
    body: JSON.stringify({ identity: PB_ADMIN_EMAIL, password: PB_ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`PB admin auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedPbToken = data.token as string;
  pbTokenExpiry = Date.now() + 50 * 60 * 1000;
  return cachedPbToken;
}

async function pbGet(path: string): Promise<unknown> {
  const [pbToken, previewToken] = await Promise.all([getAdminToken(), getDaytonaPreviewToken()]);
  const res = await fetch(`${PB_URL}${path}`, {
    headers: daytonaHeaders({ Authorization: pbToken }, previewToken),
  });
  if (!res.ok) throw new Error(`PB GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function pbPost(path: string, body: unknown): Promise<unknown> {
  const [pbToken, previewToken] = await Promise.all([getAdminToken(), getDaytonaPreviewToken()]);
  const res = await fetch(`${PB_URL}${path}`, {
    method: 'POST',
    headers: daytonaHeaders({ 'Content-Type': 'application/json', Authorization: pbToken }, previewToken),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PB POST ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export interface CustomerRecord {
  id: string;
  email: string;
  full_name: string;
  region: string;
  status: string;
  plan_code: string;
  billing_portal_enabled: boolean;
  billing_portal_hidden: boolean;
}

export async function findCustomerByEmail(email: string): Promise<CustomerRecord | null> {
  const filter = encodeURIComponent(`email="${email}"`);
  const data = (await pbGet(`/api/collections/customers/records?filter=${filter}&perPage=1`)) as {
    items: CustomerRecord[];
  };
  return data.items[0] ?? null;
}

export interface ChargeRecord {
  id: string;
  customer: string;
  invoice: string;
  posted_at: string;
  amount_cents: number;
  currency: string;
  merchant: string;
  descriptor: string;
  category: string;
  status: string;
  processor: string;
  processor_txn_id: string;
}

export async function getCharges(
  customerId: string,
  dateWindowDays: number,
  limit: number
): Promise<ChargeRecord[]> {
  const since = new Date(Date.now() - dateWindowDays * 24 * 60 * 60 * 1000).toISOString();
  const filter = encodeURIComponent(`customer="${customerId}" && posted_at>="${since}"`);
  const data = (await pbGet(
    `/api/collections/charges/records?filter=${filter}&sort=-posted_at&perPage=${limit}`
  )) as { items: ChargeRecord[] };
  return data.items;
}

export interface InvoiceRecord {
  id: string;
  customer: string;
  invoice_number: string;
  issued_at: string;
  period_start: string;
  period_end: string;
  currency: string;
  total_cents: number;
  status: string;
}

export async function getInvoices(customerId: string): Promise<InvoiceRecord[]> {
  const filter = encodeURIComponent(`customer="${customerId}"`);
  const data = (await pbGet(
    `/api/collections/invoices/records?filter=${filter}&sort=-issued_at&perPage=50`
  )) as { items: InvoiceRecord[] };
  return data.items;
}

export interface GeneratedViewInsert {
  customer: string;
  prompt: string;
  title: string;
  data_model: unknown;
  a2ui_messages: unknown;
}

export interface GeneratedViewRecord {
  id: string;
  customer: string;
  prompt: string;
  title: string;
  data_model: unknown;
  a2ui_messages: unknown;
}

export async function insertGeneratedView(data: GeneratedViewInsert): Promise<{ id: string }> {
  const record = (await pbPost('/api/collections/generated_views/records', data)) as { id: string };
  return { id: record.id };
}

export async function getGeneratedView(id: string): Promise<GeneratedViewRecord> {
  const record = (await pbGet(
    `/api/collections/generated_views/records/${id}?expand=customer`
  )) as GeneratedViewRecord;
  return record;
}
