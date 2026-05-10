'use client';

import { DonutChart } from '@tremor/react';

interface Props {
  data: Record<string, unknown>[];
  categoryKey: string;
  valueKey: string;
  title?: string;
}

export default function TremorDonutChart({ data, categoryKey, valueKey, title }: Props) {
  const valueFormatter =
    valueKey.endsWith('_cents') ? (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v / 100) : undefined;
  return (
    <div className="rounded-lg border border-gray-100 bg-white p-4">
      {title && <h4 className="mb-2 text-sm font-semibold text-gray-700">{title}</h4>}
      <DonutChart
        data={data as Record<string, string | number>[]}
        category={valueKey}
        index={categoryKey}
        colors={['violet', 'fuchsia', 'purple', 'indigo', 'pink', 'cyan']}
        className="h-52"
        valueFormatter={valueFormatter}
      />
    </div>
  );
}
