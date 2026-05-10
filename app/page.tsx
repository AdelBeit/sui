'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const DEMO_PROMPT_A =
  'Customer alice.martin@example.com says they were double-charged this week. Build a view to investigate: recent charges, suspected duplicates, totals over time, and breakdown by merchant.';

const DEMO_PROMPT_B =
  'Customer alice.martin@example.com reports an unauthorized charge. Build a view to verify: recent charges, merchant/category breakdown, anomalies, and any related refunds/reversals.';

const SUGGESTIONS = [
  { label: 'Double charge investigation', prompt: DEMO_PROMPT_A },
  { label: 'Unauthorized charge investigation', prompt: DEMO_PROMPT_B },
];

export default function HomePage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [prompt]);

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!prompt.trim() || loading) return;
    setError(null);
    setLoading(true);

    const emailMatch = prompt.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
    const customerEmail = emailMatch?.[0] ?? '';

    if (!customerEmail) {
      setError('Include a customer email in your prompt (e.g. alice.martin@example.com).');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, customerEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Generation failed');
      router.push(`/generated/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-white flex flex-col items-center justify-center px-4 gap-6">
        <svg className="animate-spin w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        <div className="text-center">
          <p className="text-gray-700 font-medium">Generating your dashboard…</p>
          <p className="text-gray-400 text-sm mt-1">This takes about 30 seconds.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-2xl flex flex-col items-center gap-8">

        <div className="text-center">
          <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">
            Customer Rep Dashboard Generator
          </h1>
          <p className="mt-2 text-gray-500 text-sm">
            Describe the customer issue and get an instant investigative dashboard.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap justify-center">
          <span className="text-xs font-medium uppercase tracking-widest text-gray-400">Demo</span>
          {SUGGESTIONS.map((s) => (
            <button
              key={s.label}
              onClick={() => {
                setPrompt(s.prompt);
                textareaRef.current?.focus();
              }}
              className="rounded-full border border-gray-200 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              {s.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="w-full">
          <div className="relative w-full rounded-2xl border border-gray-200 bg-white shadow-sm focus-within:border-gray-400 transition-colors">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Describe the customer issue… (include their email)"
              className="w-full resize-none rounded-2xl bg-transparent px-4 pt-4 pb-12 text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
              style={{ minHeight: '56px', maxHeight: '200px', overflowY: 'auto' }}
            />

            <div className="absolute bottom-3 right-3 flex items-center gap-2">
              {prompt.trim() && !loading && (
                <span className="text-xs text-gray-400">↵ to send</span>
              )}
              <button
                type="submit"
                disabled={!prompt.trim() || loading}
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-gray-900 text-white disabled:bg-gray-200 disabled:text-gray-400 transition-colors hover:bg-gray-700"
              >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
              </button>
            </div>
          </div>

          {error && (
            <p className="mt-3 text-sm text-red-600 text-center">{error}</p>
          )}
        </form>

        <p className="text-xs text-gray-400">
          Try: <span className="font-medium text-gray-500">alice.martin@example.com</span> · <span className="font-medium text-gray-500">bob.chen@example.com</span> · <span className="font-medium text-gray-500">carla.reyes@example.com</span>
        </p>

      </div>
    </main>
  );
}
