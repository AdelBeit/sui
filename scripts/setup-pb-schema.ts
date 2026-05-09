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

async function listCollections(token: string): Promise<string[]> {
  const res = await fetch(`${PB_URL}/api/collections`, {
    headers: { Authorization: token },
  });
  if (!res.ok) throw new Error(`List collections failed: ${res.status}`);
  const data = await res.json();
  return (data.items as Array<{ name: string }>).map((c) => c.name);
}

async function createCollection(token: string, schema: object): Promise<void> {
  const res = await fetch(`${PB_URL}/api/collections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify(schema),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create collection failed: ${res.status} ${text}`);
  }
  console.log(`Created collection: ${(schema as { name: string }).name}`);
}

const COLLECTIONS = [
  {
    name: 'customers',
    type: 'base',
    schema: [
      { name: 'email', type: 'text', required: true },
      { name: 'full_name', type: 'text', required: true },
      { name: 'region', type: 'select', options: { values: ['US', 'EU', 'APAC'] } },
      { name: 'status', type: 'select', options: { values: ['active', 'suspended', 'closed'] } },
      { name: 'plan_code', type: 'text' },
      { name: 'billing_portal_enabled', type: 'bool' },
      { name: 'billing_portal_hidden', type: 'bool' },
    ],
  },
  {
    name: 'invoices',
    type: 'base',
    schema: [
      { name: 'customer', type: 'relation', required: true, options: { collectionId: null, cascadeDelete: false } },
      { name: 'invoice_number', type: 'text', required: true },
      { name: 'issued_at', type: 'date', required: true },
      { name: 'period_start', type: 'date' },
      { name: 'period_end', type: 'date' },
      { name: 'currency', type: 'text' },
      { name: 'total_cents', type: 'number', required: true },
      { name: 'status', type: 'select', options: { values: ['open', 'paid', 'void'] } },
    ],
  },
  {
    name: 'charges',
    type: 'base',
    schema: [
      { name: 'customer', type: 'relation', required: true, options: { collectionId: null, cascadeDelete: false } },
      { name: 'invoice', type: 'relation', required: false, options: { collectionId: null, cascadeDelete: false } },
      { name: 'posted_at', type: 'date', required: true },
      { name: 'amount_cents', type: 'number', required: true },
      { name: 'currency', type: 'text' },
      { name: 'merchant', type: 'text', required: true },
      { name: 'descriptor', type: 'text', required: true },
      { name: 'category', type: 'select', options: { values: ['subscription', 'usage', 'tax', 'refund', 'adjustment', 'other'] } },
      { name: 'status', type: 'select', options: { values: ['captured', 'reversed', 'refunded', 'failed'] } },
      { name: 'processor', type: 'text', required: true },
      { name: 'processor_txn_id', type: 'text', required: true },
    ],
  },
  {
    name: 'generated_views',
    type: 'base',
    schema: [
      { name: 'customer', type: 'relation', required: true, options: { collectionId: null, cascadeDelete: false } },
      { name: 'prompt', type: 'text', required: true },
      { name: 'title', type: 'text', required: true },
      { name: 'data_model', type: 'json', required: true },
      { name: 'a2ui_messages', type: 'json', required: true },
    ],
  },
];

async function main() {
  console.log(`Connecting to PocketBase at ${PB_URL}...`);
  const token = await getAdminToken();
  console.log('Authenticated as admin.');

  const existing = await listCollections(token);
  console.log('Existing collections:', existing.join(', ') || '(none)');

  // Get collection IDs for relations
  const collectionIdMap = new Map<string, string>();
  if (existing.length > 0) {
    const res = await fetch(`${PB_URL}/api/collections?perPage=200`, {
      headers: { Authorization: token },
    });
    const data = await res.json();
    for (const c of data.items as Array<{ name: string; id: string }>) {
      collectionIdMap.set(c.name, c.id);
    }
  }

  for (const colDef of COLLECTIONS) {
    if (existing.includes(colDef.name)) {
      console.log(`Collection "${colDef.name}" already exists, skipping.`);
      continue;
    }

    // Patch relation collectionIds
    const schema = colDef.schema.map((field) => {
      if (field.type === 'relation' && field.options?.collectionId === null) {
        let targetName: string | null = null;
        if (field.name === 'customer') targetName = 'customers';
        if (field.name === 'invoice') targetName = 'invoices';
        const targetId = targetName ? (collectionIdMap.get(targetName) ?? '') : '';
        return { ...field, options: { ...field.options, collectionId: targetId } };
      }
      return field;
    });

    await createCollection(token, { ...colDef, schema });

    // Update collectionIdMap after create
    const res2 = await fetch(`${PB_URL}/api/collections?perPage=200`, {
      headers: { Authorization: token },
    });
    const data2 = await res2.json();
    for (const c of data2.items as Array<{ name: string; id: string }>) {
      collectionIdMap.set(c.name, c.id);
    }
  }

  console.log('Schema setup complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
