import 'dotenv/config';

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8090';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL ?? '';
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? '';
const ANCHOR_ISO = process.env.PB_SEED_ANCHOR ?? '2026-05-09T00:00:00Z';

const ANCHOR = new Date(ANCHOR_ISO);

// Mulberry32 seeded RNG
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(12345);

function randInt(min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randItem<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

async function getAdminToken(): Promise<string> {
  const res = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: PB_ADMIN_EMAIL, password: PB_ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status} ${await res.text()}`);
  return (await res.json()).token as string;
}

async function pbGet(token: string, path: string): Promise<unknown> {
  const res = await fetch(`${PB_URL}${path}`, { headers: { Authorization: token } });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function pbPost(token: string, path: string, body: unknown): Promise<{ id: string }> {
  const res = await fetch(`${PB_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ id: string }>;
}

async function pbDelete(token: string, path: string): Promise<void> {
  const res = await fetch(`${PB_URL}${path}`, {
    method: 'DELETE',
    headers: { Authorization: token },
  });
  if (!res.ok && res.status !== 404) throw new Error(`DELETE ${path} failed: ${res.status}`);
}

async function wipeCollection(token: string, collection: string): Promise<void> {
  let page = 1;
  while (true) {
    const data = (await pbGet(token, `/api/collections/${collection}/records?perPage=200&page=${page}`)) as {
      items: Array<{ id: string }>;
      totalPages: number;
    };
    for (const item of data.items) {
      await pbDelete(token, `/api/collections/${collection}/records/${item.id}`);
    }
    if (page >= data.totalPages || data.items.length === 0) break;
    page++;
  }
}

async function findByEmail(token: string, email: string): Promise<{ id: string } | null> {
  const filter = encodeURIComponent(`email="${email}"`);
  const data = (await pbGet(token, `/api/collections/customers/records?filter=${filter}&perPage=1`)) as {
    items: Array<{ id: string }>;
  };
  return data.items[0] ?? null;
}

const MERCHANTS = [
  'CloudInfra Ltd',
  'DataSync Pro',
  'SecureVault Inc',
  'NetBoost Corp',
  'StorageMax',
  'ApiGateway Co',
];

const PROCESSORS = ['stripe', 'adyen', 'braintree'];

async function main() {
  console.log(`Seeding PocketBase at ${PB_URL} anchored to ${ANCHOR_ISO}`);
  const token = await getAdminToken();

  // Wipe data for demo customers
  console.log('Wiping existing demo data...');
  await wipeCollection(token, 'generated_views');
  await wipeCollection(token, 'charges');
  await wipeCollection(token, 'invoices');
  await wipeCollection(token, 'customers');

  // --- Alice ---
  const alice = await pbPost(token, '/api/collections/customers/records', {
    email: 'alice.martin@example.com',
    full_name: 'Alice Martin',
    region: 'US',
    status: 'active',
    plan_code: 'pro',
    billing_portal_enabled: true,
    billing_portal_hidden: false,
  });
  console.log(`Created customer: alice (${alice.id})`);

  const aliceInv1 = await pbPost(token, '/api/collections/invoices/records', {
    customer: alice.id,
    invoice_number: 'INV-2026-001',
    issued_at: addDays(ANCHOR, -30).toISOString(),
    period_start: addDays(ANCHOR, -60).toISOString(),
    period_end: addDays(ANCHOR, -30).toISOString(),
    currency: 'USD',
    total_cents: 9999,
    status: 'paid',
  });

  const aliceInv2 = await pbPost(token, '/api/collections/invoices/records', {
    customer: alice.id,
    invoice_number: 'INV-2026-002',
    issued_at: addDays(ANCHOR, 0).toISOString(),
    period_start: addDays(ANCHOR, -30).toISOString(),
    period_end: addDays(ANCHOR, 0).toISOString(),
    currency: 'USD',
    total_cents: 9999,
    status: 'open',
  });
  console.log(`Created invoices for alice: ${aliceInv1.id}, ${aliceInv2.id}`);

  // Alice charges: 15+ spanning 30 days with double charge pair on anchor day
  const aliceChargeIds: string[] = [];
  let txnCounter = 1000;

  // Regular charges spread over 30 days
  const chargeData = [
    { daysAgo: 29, merchant: 'CloudInfra Ltd', amount: 4999, category: 'subscription', status: 'captured' },
    { daysAgo: 28, merchant: 'DataSync Pro', amount: 1500, category: 'usage', status: 'captured' },
    { daysAgo: 27, merchant: 'SecureVault Inc', amount: 2999, category: 'subscription', status: 'captured' },
    { daysAgo: 25, merchant: 'StorageMax', amount: 750, category: 'usage', status: 'captured' },
    { daysAgo: 22, merchant: 'NetBoost Corp', amount: 1999, category: 'subscription', status: 'captured' },
    { daysAgo: 20, merchant: 'ApiGateway Co', amount: 399, category: 'usage', status: 'captured' },
    { daysAgo: 18, merchant: 'CloudInfra Ltd', amount: 199, category: 'tax', status: 'captured' },
    { daysAgo: 15, merchant: 'DataSync Pro', amount: 800, category: 'usage', status: 'captured' },
    { daysAgo: 12, merchant: 'StorageMax', amount: 950, category: 'usage', status: 'captured' },
    { daysAgo: 10, merchant: 'SecureVault Inc', amount: 299, category: 'tax', status: 'captured' },
    { daysAgo: 8, merchant: 'NetBoost Corp', amount: 500, category: 'adjustment', status: 'captured' },
    { daysAgo: 6, merchant: 'ApiGateway Co', amount: 1200, category: 'usage', status: 'captured' },
    { daysAgo: 4, merchant: 'CloudInfra Ltd', amount: 3000, category: 'subscription', status: 'captured' },
    { daysAgo: 2, merchant: 'DataSync Pro', amount: 450, category: 'usage', status: 'captured' },
  ];

  for (const c of chargeData) {
    const rec = await pbPost(token, '/api/collections/charges/records', {
      customer: alice.id,
      invoice: c.daysAgo > 15 ? aliceInv1.id : aliceInv2.id,
      posted_at: addDays(ANCHOR, -c.daysAgo).toISOString(),
      amount_cents: c.amount,
      currency: 'USD',
      merchant: c.merchant,
      descriptor: `${c.merchant} - ${c.category}`,
      category: c.category,
      status: c.status,
      processor: randItem(PROCESSORS),
      processor_txn_id: `txn_${++txnCounter}`,
    });
    aliceChargeIds.push(rec.id);
  }

  // Deterministic double charge pair: CloudInfra Ltd, 4999 cents, 90 seconds apart on anchor day
  const doubleCharge1 = await pbPost(token, '/api/collections/charges/records', {
    customer: alice.id,
    invoice: aliceInv2.id,
    posted_at: ANCHOR.toISOString(),
    amount_cents: 4999,
    currency: 'USD',
    merchant: 'CloudInfra Ltd',
    descriptor: 'CloudInfra Ltd - subscription',
    category: 'subscription',
    status: 'captured',
    processor: 'stripe',
    processor_txn_id: 'txn_dupe_001',
  });

  const doubleCharge2 = await pbPost(token, '/api/collections/charges/records', {
    customer: alice.id,
    invoice: aliceInv2.id,
    posted_at: addSeconds(ANCHOR, 90).toISOString(),
    amount_cents: 4999,
    currency: 'USD',
    merchant: 'CloudInfra Ltd',
    descriptor: 'CloudInfra Ltd - subscription',
    category: 'subscription',
    status: 'captured',
    processor: 'stripe',
    processor_txn_id: 'txn_dupe_002',
  });

  console.log(`Alice charges: ${chargeData.length + 2} total`);
  console.log(`Double charge pair IDs: ${doubleCharge1.id}, ${doubleCharge2.id}`);

  // --- Bob ---
  const bob = await pbPost(token, '/api/collections/customers/records', {
    email: 'bob.chen@example.com',
    full_name: 'Bob Chen',
    region: 'US',
    status: 'suspended',
    plan_code: 'basic',
    billing_portal_enabled: false,
    billing_portal_hidden: true,
  });
  console.log(`Created customer: bob (${bob.id})`);

  const bobInv1 = await pbPost(token, '/api/collections/invoices/records', {
    customer: bob.id,
    invoice_number: 'INV-BOB-001',
    issued_at: addDays(ANCHOR, -45).toISOString(),
    period_start: addDays(ANCHOR, -75).toISOString(),
    period_end: addDays(ANCHOR, -45).toISOString(),
    currency: 'USD',
    total_cents: 4999,
    status: 'void',
  });

  const bobInv2 = await pbPost(token, '/api/collections/invoices/records', {
    customer: bob.id,
    invoice_number: 'INV-BOB-002',
    issued_at: addDays(ANCHOR, -15).toISOString(),
    period_start: addDays(ANCHOR, -45).toISOString(),
    period_end: addDays(ANCHOR, -15).toISOString(),
    currency: 'USD',
    total_cents: 4999,
    status: 'paid',
  });

  const bobChargesData = [
    { daysAgo: 40, merchant: 'NetBoost Corp', amount: 2999, category: 'subscription', status: 'captured' },
    { daysAgo: 35, merchant: 'CloudInfra Ltd', amount: 999, category: 'usage', status: 'captured' },
    { daysAgo: 30, merchant: 'StorageMax', amount: 1500, category: 'subscription', status: 'failed' },
    { daysAgo: 28, merchant: 'StorageMax', amount: 1500, category: 'subscription', status: 'failed' },
    { daysAgo: 25, merchant: 'DataSync Pro', amount: 499, category: 'usage', status: 'captured' },
    { daysAgo: 20, merchant: 'NetBoost Corp', amount: 2999, category: 'subscription', status: 'failed' },
    { daysAgo: 18, merchant: 'NetBoost Corp', amount: 2999, category: 'subscription', status: 'failed' },
    { daysAgo: 15, merchant: 'ApiGateway Co', amount: 199, category: 'adjustment', status: 'reversed' },
  ];

  for (const c of bobChargesData) {
    await pbPost(token, '/api/collections/charges/records', {
      customer: bob.id,
      invoice: c.daysAgo > 30 ? bobInv1.id : bobInv2.id,
      posted_at: addDays(ANCHOR, -c.daysAgo).toISOString(),
      amount_cents: c.amount,
      currency: 'USD',
      merchant: c.merchant,
      descriptor: `${c.merchant} - ${c.category}`,
      category: c.category,
      status: c.status,
      processor: randItem(PROCESSORS),
      processor_txn_id: `txn_${++txnCounter}`,
    });
  }
  console.log(`Bob charges: ${bobChargesData.length}`);

  // --- Carla ---
  const carla = await pbPost(token, '/api/collections/customers/records', {
    email: 'carla.reyes@example.com',
    full_name: 'Carla Reyes',
    region: 'APAC',
    status: 'active',
    plan_code: 'trial',
    billing_portal_enabled: false,
    billing_portal_hidden: false,
  });
  console.log(`Created customer: carla (${carla.id})`);

  const carlaChargesData = [
    { daysAgo: 14, merchant: 'CloudInfra Ltd', amount: 0, category: 'subscription', status: 'captured' },
    { daysAgo: 10, merchant: 'DataSync Pro', amount: 250, category: 'usage', status: 'captured' },
    { daysAgo: 7, merchant: 'StorageMax', amount: 150, category: 'usage', status: 'captured' },
    { daysAgo: 3, merchant: 'ApiGateway Co', amount: 50, category: 'usage', status: 'captured' },
    { daysAgo: 1, merchant: 'CloudInfra Ltd', amount: 0, category: 'subscription', status: 'captured' },
  ];

  for (const c of carlaChargesData) {
    await pbPost(token, '/api/collections/charges/records', {
      customer: carla.id,
      invoice: '',
      posted_at: addDays(ANCHOR, -c.daysAgo).toISOString(),
      amount_cents: c.amount,
      currency: 'USD',
      merchant: c.merchant,
      descriptor: `${c.merchant} - ${c.category}`,
      category: c.category,
      status: c.status,
      processor: randItem(PROCESSORS),
      processor_txn_id: `txn_${++txnCounter}`,
    });
  }
  console.log(`Carla charges: ${carlaChargesData.length}`);

  console.log('\nSeed complete!');
  console.log(`double charge pair IDs: ${doubleCharge1.id}, ${doubleCharge2.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
