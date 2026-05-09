import 'dotenv/config';

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8090';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL ?? '';
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? '';

async function getAdminToken(): Promise<string> {
  const res = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: PB_ADMIN_EMAIL, password: PB_ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.token as string;
}

async function getCollections(token: string): Promise<Array<{ name: string; id: string }>> {
  const res = await fetch(`${PB_URL}/api/collections?perPage=200`, {
    headers: { Authorization: token },
  });
  if (!res.ok) throw new Error(`List collections failed: ${res.status}`);
  const data = await res.json();
  return data.items as Array<{ name: string; id: string }>;
}

async function deleteCollection(token: string, id: string): Promise<void> {
  const res = await fetch(`${PB_URL}/api/collections/${id}`, {
    method: 'DELETE',
    headers: { Authorization: token },
  });
  if (!res.ok && res.status !== 404) throw new Error(`Delete failed: ${res.status}`);
}

async function createCollection(token: string, schema: object): Promise<{ id: string; name: string }> {
  const res = await fetch(`${PB_URL}/api/collections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify(schema),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create collection failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<{ id: string; name: string }>;
}

function textField(name: string, required = false) {
  return { type: 'text', name, required, presentable: false, hidden: false };
}
function selectField(name: string, values: string[], required = false) {
  return { type: 'select', name, required, presentable: false, hidden: false, values, maxSelect: 1 };
}
function boolField(name: string) {
  return { type: 'bool', name, required: false, presentable: false, hidden: false };
}
function numberField(name: string, required = false) {
  return { type: 'number', name, required, presentable: false, hidden: false };
}
function dateField(name: string, required = false) {
  return { type: 'date', name, required, presentable: false, hidden: false };
}
function jsonField(name: string, required = false) {
  return { type: 'json', name, required, presentable: false, hidden: false };
}
function relationField(name: string, collectionId: string, required = false) {
  return { type: 'relation', name, required, presentable: false, hidden: false, collectionId, cascadeDelete: false, minSelect: null, maxSelect: 1 };
}

async function main() {
  console.log(`Connecting to PocketBase at ${PB_URL}...`);
  const token = await getAdminToken();
  console.log('Authenticated as admin.');

  const existing = await getCollections(token);
  const existingMap = new Map(existing.map(c => [c.name, c.id]));

  // Delete existing demo collections in reverse dependency order
  for (const name of ['generated_views', 'charges', 'invoices', 'customers']) {
    const id = existingMap.get(name);
    if (id) {
      await deleteCollection(token, id);
      console.log(`Deleted existing: ${name}`);
    }
  }

  // Create customers
  const customers = await createCollection(token, {
    name: 'customers',
    type: 'base',
    fields: [
      textField('email', true),
      textField('full_name', true),
      selectField('region', ['US', 'EU', 'APAC']),
      selectField('status', ['active', 'suspended', 'closed']),
      textField('plan_code'),
      boolField('billing_portal_enabled'),
      boolField('billing_portal_hidden'),
    ],
  });
  console.log(`Created: customers (${customers.id})`);

  // Create invoices
  const invoices = await createCollection(token, {
    name: 'invoices',
    type: 'base',
    fields: [
      relationField('customer', customers.id, true),
      textField('invoice_number', true),
      dateField('issued_at', true),
      dateField('period_start'),
      dateField('period_end'),
      textField('currency'),
      numberField('total_cents', true),
      selectField('status', ['open', 'paid', 'void']),
    ],
  });
  console.log(`Created: invoices (${invoices.id})`);

  // Create charges
  const charges = await createCollection(token, {
    name: 'charges',
    type: 'base',
    fields: [
      relationField('customer', customers.id, true),
      relationField('invoice', invoices.id, false),
      dateField('posted_at', true),
      numberField('amount_cents', true),
      textField('currency'),
      textField('merchant', true),
      textField('descriptor', true),
      selectField('category', ['subscription', 'usage', 'tax', 'refund', 'adjustment', 'other']),
      selectField('status', ['captured', 'reversed', 'refunded', 'failed']),
      textField('processor', true),
      textField('processor_txn_id', true),
    ],
  });
  console.log(`Created: charges (${charges.id})`);

  // Create generated_views
  const views = await createCollection(token, {
    name: 'generated_views',
    type: 'base',
    fields: [
      relationField('customer', customers.id, true),
      textField('prompt', true),
      textField('title', true),
      jsonField('data_model', true),
      jsonField('a2ui_messages', true),
    ],
  });
  console.log(`Created: generated_views (${views.id})`);

  // Open all rules (demo only)
  const openRules = { listRule: '', viewRule: '', createRule: '', updateRule: '', deleteRule: '' };
  for (const { id, name } of [customers, invoices, charges, views]) {
    await fetch(`${PB_URL}/api/collections/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify(openRules),
    });
    console.log(`Opened rules: ${name}`);
  }

  console.log('Schema setup complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
