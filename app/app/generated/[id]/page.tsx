import { notFound } from 'next/navigation';
import Link from 'next/link';
import A2UIRenderer from '@/components/A2UIRenderer';

interface GeneratedViewData {
  title: string;
  data_model: Record<string, unknown>;
  a2ui_messages: Record<string, unknown>[];
}

async function fetchView(id: string): Promise<GeneratedViewData | null> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
  try {
    const res = await fetch(`${baseUrl}/api/generated/${id}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function GeneratedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const view = await fetchView(id);

  if (!view) notFound();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50 transition-colors"
            >
              ← New investigation
            </Link>
            <h1 className="mt-1 text-lg font-semibold text-gray-900">{view.title}</h1>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <A2UIRenderer
          a2uiMessages={view.a2ui_messages}
          dataModel={view.data_model}
        />
      </main>
    </div>
  );
}
