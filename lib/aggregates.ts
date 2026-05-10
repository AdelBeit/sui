import type { ChargeRecord, CustomerRecord, InvoiceRecord } from './pocketbase';

interface AggByDay {
  date: string;
  total_cents: number;
  count: number;
}

interface AggByMerchant {
  merchant: string;
  total_cents: number;
  count: number;
}

interface AggByCategory {
  category: string;
  total_cents: number;
  count: number;
}

interface SuspectedDuplicate {
  charge_ids: [string, string];
  merchant: string;
  amount_cents: number;
  posted_at_1: string;
  posted_at_2: string;
}

export interface DataModel {
  customer: {
    email: string;
    full_name: string;
    region: string;
    status: string;
    plan_code: string;
  };
  charges: Array<{
    id: string;
    posted_at: string;
    amount_cents: number;
    merchant: string;
    descriptor: string;
    category: string;
    status: string;
  }>;
  invoices: Array<{
    id: string;
    invoice_number: string;
    issued_at: string;
    total_cents: number;
    status: string;
  }>;
  aggregates: {
    total_cents: number;
    charge_count: number;
    by_day: AggByDay[];
    by_merchant: AggByMerchant[];
    by_category: AggByCategory[];
  };
  suspected_duplicates: SuspectedDuplicate[];
}

function toDateStr(isoString: string): string {
  return isoString.slice(0, 10);
}

function computeSuspectedDuplicates(
  charges: ChargeRecord[],
  strategy: 'same_merchant_amount_day' | 'same_merchant_amount_2min_window'
): SuspectedDuplicate[] {
  const duplicates: SuspectedDuplicate[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < charges.length; i++) {
    for (let j = i + 1; j < charges.length; j++) {
      const a = charges[i];
      const b = charges[j];

      if (a.merchant !== b.merchant || a.amount_cents !== b.amount_cents) continue;

      const pairKey = [a.id, b.id].sort().join(':');
      if (seen.has(pairKey)) continue;

      let isDupe = false;
      if (strategy === 'same_merchant_amount_day') {
        isDupe = toDateStr(a.posted_at) === toDateStr(b.posted_at);
      } else {
        const diff = Math.abs(new Date(a.posted_at).getTime() - new Date(b.posted_at).getTime());
        isDupe = diff <= 2 * 60 * 1000;
      }

      if (isDupe) {
        seen.add(pairKey);
        const sorted = [a, b].sort(
          (x, y) => new Date(x.posted_at).getTime() - new Date(y.posted_at).getTime()
        );
        duplicates.push({
          charge_ids: [sorted[0].id, sorted[1].id],
          merchant: a.merchant,
          amount_cents: a.amount_cents,
          posted_at_1: sorted[0].posted_at,
          posted_at_2: sorted[1].posted_at,
        });
      }
    }
  }

  return duplicates;
}

export function computeDataModel(
  customer: CustomerRecord,
  charges: ChargeRecord[],
  invoices: InvoiceRecord[],
  dedupeStrategy: 'same_merchant_amount_day' | 'same_merchant_amount_2min_window',
  groupBys: Array<'day' | 'merchant' | 'category'>
): DataModel {
  const byDayMap = new Map<string, AggByDay>();
  const byMerchantMap = new Map<string, AggByMerchant>();
  const byCategoryMap = new Map<string, AggByCategory>();
  let totalCents = 0;

  for (const charge of charges) {
    totalCents += charge.amount_cents;

    if (groupBys.includes('day')) {
      const date = toDateStr(charge.posted_at);
      const existing = byDayMap.get(date) ?? { date, total_cents: 0, count: 0 };
      existing.total_cents += charge.amount_cents;
      existing.count += 1;
      byDayMap.set(date, existing);
    }

    if (groupBys.includes('merchant')) {
      const existing = byMerchantMap.get(charge.merchant) ?? {
        merchant: charge.merchant,
        total_cents: 0,
        count: 0,
      };
      existing.total_cents += charge.amount_cents;
      existing.count += 1;
      byMerchantMap.set(charge.merchant, existing);
    }

    if (groupBys.includes('category')) {
      const existing = byCategoryMap.get(charge.category) ?? {
        category: charge.category,
        total_cents: 0,
        count: 0,
      };
      existing.total_cents += charge.amount_cents;
      existing.count += 1;
      byCategoryMap.set(charge.category, existing);
    }
  }

  return {
    customer: {
      email: customer.email,
      full_name: customer.full_name,
      region: customer.region,
      status: customer.status,
      plan_code: customer.plan_code,
    },
    charges: charges.map((c) => ({
      id: c.id,
      posted_at: c.posted_at,
      amount_cents: c.amount_cents,
      merchant: c.merchant,
      descriptor: c.descriptor,
      category: c.category,
      status: c.status,
    })),
    invoices: invoices.map((inv) => ({
      id: inv.id,
      invoice_number: inv.invoice_number,
      issued_at: inv.issued_at,
      total_cents: inv.total_cents,
      status: inv.status,
    })),
    aggregates: {
      total_cents: totalCents,
      charge_count: charges.length,
      by_day: Array.from(byDayMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
      by_merchant: Array.from(byMerchantMap.values()).sort(
        (a, b) => b.total_cents - a.total_cents
      ),
      by_category: Array.from(byCategoryMap.values()).sort(
        (a, b) => b.total_cents - a.total_cents
      ),
    },
    suspected_duplicates: computeSuspectedDuplicates(charges, dedupeStrategy),
  };
}
