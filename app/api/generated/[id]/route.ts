import { NextRequest, NextResponse } from 'next/server';
import { getGeneratedView } from '@/lib/pocketbase';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const record = await getGeneratedView(id);
    return NextResponse.json({
      title: record.title,
      data_model: record.data_model,
      a2ui_messages: record.a2ui_messages,
      customer: (record as unknown as Record<string, unknown>).expand
        ? (record as unknown as Record<string, unknown>).expand
        : { id: record.customer },
    });
  } catch (err) {
    console.error('GET /api/generated/[id] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Not found' },
      { status: 404 }
    );
  }
}
