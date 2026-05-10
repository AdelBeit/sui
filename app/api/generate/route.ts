import { NextRequest, NextResponse } from 'next/server';
import { getDataPlan } from '@/lib/gemini';
import { getA2UISurface } from '@/lib/gemini';
import { findCustomerByEmail, getCharges, getInvoices, insertGeneratedView } from '@/lib/pocketbase';
import { computeDataModel } from '@/lib/aggregates';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, customerEmail } = body as { prompt?: string; customerEmail?: string };

    if (!prompt || !customerEmail) {
      return NextResponse.json({ error: 'prompt and customerEmail are required' }, { status: 400 });
    }

    const dataPlan = await getDataPlan(prompt, customerEmail);

    const customer = await findCustomerByEmail(dataPlan.customerEmail);
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const [charges, invoices] = await Promise.all([
      dataPlan.include_charges
        ? getCharges(customer.id, dataPlan.date_window_days, dataPlan.charge_row_limit)
        : Promise.resolve([]),
      dataPlan.include_invoices ? getInvoices(customer.id) : Promise.resolve([]),
    ]);

    const dataModel = computeDataModel(
      customer,
      charges,
      invoices,
      dataPlan.dedupe_strategy,
      dataPlan.group_bys
    );

    const { title, a2ui_messages } = await getA2UISurface(prompt, dataPlan, dataModel);

    const { id } = await insertGeneratedView({
      customer: customer.id,
      prompt,
      title,
      data_model: dataModel,
      a2ui_messages,
    });

    return NextResponse.json({ id });
  } catch (err) {
    console.error('POST /api/generate error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
