'use client';

import React from 'react';
import TremorBarChart from './charts/TremorBarChart';
import TremorLineChart from './charts/TremorLineChart';
import TremorDonutChart from './charts/TremorDonutChart';

type A2UIMessage = Record<string, unknown>;

interface ComponentDef {
  id: string;
  weight?: number;
  component: Record<string, unknown>;
}

interface RenderedSurface {
  rootId: string;
  components: Map<string, ComponentDef>;
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function isCentsKey(key: string): boolean {
  return key.endsWith('_cents');
}

function isDateKey(key: string): boolean {
  return key === 'date' || key.endsWith('_at');
}

function formatMaybeISODate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Common shapes in this app: YYYY-MM-DD and YYYY-MM-DDTHH:mm:ss.sssZ
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
  return null;
}

function isCentsPath(path: string): boolean {
  const last = path.replace(/\/+$/, '').split('/').pop() ?? '';
  return isCentsKey(last);
}

function isDatePath(path: string): boolean {
  const last = path.replace(/\/+$/, '').split('/').pop() ?? '';
  return isDateKey(last);
}

function formatMaybeCents(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return usd.format(value / 100);
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return usd.format(n / 100);
  }
  return null;
}

function isIdentifierKey(key: string): boolean {
  return key === 'id' || key.endsWith('_id') || key === 'processor_txn_id' || key === 'invoice_number';
}

function truncateIdentifier(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function titleCaseToken(value: string): string {
  const spaced = value.replace(/_/g, ' ');
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeEnum(key: string, value: string): string {
  const v = value.toLowerCase();
  if (key === 'status') {
    if (v === 'void') return 'Voided';
    return titleCaseToken(v);
  }
  if (key === 'category') return titleCaseToken(v);
  if (key === 'region') return value.toUpperCase();
  return titleCaseToken(value);
}

function resolvePath(dataModel: Record<string, unknown>, path: string): unknown {
  if (!path || path === '/') return dataModel;
  const parts = path.replace(/^\//, '').split('/');
  let current: unknown = dataModel;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resolveText(
  textDef: { literalString?: string; path?: string },
  dataModel: Record<string, unknown>
): string {
  if (textDef.literalString !== undefined) return textDef.literalString;
  if (textDef.path) {
    const val = resolvePath(dataModel, textDef.path);
    if (isCentsPath(textDef.path)) {
      const formatted = formatMaybeCents(val);
      if (formatted != null) return formatted;
    }
    if (isDatePath(textDef.path)) {
      const formatted = formatMaybeISODate(val);
      if (formatted != null) return formatted;
    }
    return val != null ? String(val) : '';
  }
  return '';
}

const usageHintClass: Record<string, string> = {
  h1: 'text-3xl font-bold',
  h2: 'text-2xl font-semibold',
  h3: 'text-xl font-semibold',
  h4: 'text-lg font-semibold',
  h5: 'text-base font-semibold',
  caption: 'text-xs text-gray-500',
  body: 'text-sm text-gray-700',
};

const distributionClass: Record<string, string> = {
  center: 'justify-center',
  end: 'justify-end',
  spaceAround: 'justify-around',
  spaceBetween: 'justify-between',
  spaceEvenly: 'justify-evenly',
  start: 'justify-start',
};

const alignmentClass: Record<string, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
};

interface RenderProps {
  id: string;
  surface: RenderedSurface;
  dataModel: Record<string, unknown>;
}

function RenderComponent({ id, surface, dataModel }: RenderProps): React.ReactElement | null {
  const compDef = surface.components.get(id);
  if (!compDef) return null;

  // Handle two formats Gemini may produce:
  // Nested:  { component: { Column: { children: ... } } }
  // Flat:    { component: "Column", children: ..., ... }
  let compType: string;
  let props: Record<string, unknown>;

  if (typeof compDef.component === 'string') {
    compType = compDef.component;
    const rest = { ...(compDef as unknown as Record<string, unknown>) };
    delete rest.id;
    delete rest.component;
    delete rest.weight;
    props = rest;
  } else {
    compType = Object.keys(compDef.component)[0];
    props = (compDef.component as Record<string, unknown>)[compType] as Record<string, unknown>;
  }

  function renderChildren(children: { explicitList?: string[] } | undefined) {
    if (!children?.explicitList) return null;
    return children.explicitList.map((childId) => (
      <RenderComponent key={childId} id={childId} surface={surface} dataModel={dataModel} />
    ));
  }

  switch (compType) {
    case 'Text': {
      const textProps = props as { text: { literalString?: string; path?: string }; usageHint?: string };
      const text = resolveText(textProps.text, dataModel);
      const hint = textProps.usageHint ?? 'body';
      const cls = usageHintClass[hint] ?? 'text-sm';
      return <p className={cls}>{text}</p>;
    }

    case 'Row': {
      const rowProps = props as {
        children?: { explicitList?: string[] };
        distribution?: string;
        alignment?: string;
      };
      const dist = distributionClass[rowProps.distribution ?? 'start'] ?? 'justify-start';
      const align = alignmentClass[rowProps.alignment ?? 'stretch'] ?? 'items-stretch';
      return (
        <div className={`flex flex-row gap-4 ${dist} ${align}`}>
          {renderChildren(rowProps.children)}
        </div>
      );
    }

    case 'Column': {
      const colProps = props as {
        children?: { explicitList?: string[] };
        distribution?: string;
        alignment?: string;
      };
      const dist = distributionClass[colProps.distribution ?? 'start'] ?? 'justify-start';
      const align = alignmentClass[colProps.alignment ?? 'stretch'] ?? 'items-stretch';
      return (
        <div className={`flex flex-col gap-4 ${dist} ${align}`}>
          {renderChildren(colProps.children)}
        </div>
      );
    }

    case 'Card': {
      const cardProps = props as { children?: { explicitList?: string[] }; title?: string };
      return (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          {cardProps.title && (
            <h3 className="mb-3 text-base font-semibold text-gray-800">{cardProps.title}</h3>
          )}
          <div className="flex flex-col gap-3">{renderChildren(cardProps.children)}</div>
        </div>
      );
    }

    case 'List': {
      const listProps = props as { dataPath: string; emptyText?: string; fields?: string[] };
      const items = resolvePath(dataModel, listProps.dataPath);
      if (!Array.isArray(items) || items.length === 0) {
        return (
          <p className="text-sm text-gray-500 italic">{listProps.emptyText ?? 'No items.'}</p>
        );
      }
      const allKeys = Object.keys(items[0] as object);
      const keys = listProps.fields ?? allKeys;

      function headerLabel(key: string): string {
        if (isCentsKey(key)) return `${key.replace(/_cents$/, '')} ($)`.replace(/_/g, ' ');
        return key.replace(/_/g, ' ');
      }

      function cellValue(key: string, value: unknown): { text: string; title?: string; className?: string } {
        if (isCentsKey(key)) {
          const formatted = formatMaybeCents(value);
          return { text: formatted ?? String(value ?? '') };
        }
        if (isDateKey(key)) {
          const formatted = formatMaybeISODate(value);
          if (formatted != null) return { text: formatted };
        }
        if (isIdentifierKey(key) && typeof value === 'string') {
          return { text: truncateIdentifier(value), title: value, className: 'font-mono' };
        }
        if ((key === 'status' || key === 'category' || key === 'region') && typeof value === 'string') {
          return { text: humanizeEnum(key, value) };
        }
        return { text: String(value ?? '') };
      }

      return (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {keys.map((key) => (
                  <th
                    key={key}
                    className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    {headerLabel(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {items.map((item, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  {keys.map((key) => (
                    <td key={key} className="px-3 py-2 text-gray-700">
                      {(() => {
                        const v = cellValue(key, (item as Record<string, unknown>)[key]);
                        return (
                          <span className={v.className} title={v.title}>
                            {v.text}
                          </span>
                        );
                      })()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case 'Divider': {
      return <hr className="border-gray-200" />;
    }

    case 'Button': {
      const btnProps = props as {
        child: string;
        primary?: boolean;
        action: { name: string };
      };
      const cls = btnProps.primary
        ? 'rounded bg-blue-600 px-4 py-2 text-white text-sm font-medium hover:bg-blue-700'
        : 'rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50';
      return (
        <button
          className={cls}
          onClick={() => console.log('A2UI action:', btnProps.action.name)}
        >
          <RenderComponent id={btnProps.child} surface={surface} dataModel={dataModel} />
        </button>
      );
    }

    case 'TremorBarChart': {
      const chartProps = props as { dataPath: string; indexKey: string; valueKey: string; title?: string };
      const data = resolvePath(dataModel, chartProps.dataPath);
      return (
        <TremorBarChart
          data={Array.isArray(data) ? (data as Record<string, unknown>[]) : []}
          indexKey={chartProps.indexKey}
          valueKey={chartProps.valueKey}
          title={chartProps.title}
        />
      );
    }

    case 'TremorLineChart': {
      const chartProps = props as { dataPath: string; indexKey: string; valueKey: string; title?: string };
      const data = resolvePath(dataModel, chartProps.dataPath);
      return (
        <TremorLineChart
          data={Array.isArray(data) ? (data as Record<string, unknown>[]) : []}
          indexKey={chartProps.indexKey}
          valueKey={chartProps.valueKey}
          title={chartProps.title}
        />
      );
    }

    case 'TremorDonutChart': {
      const chartProps = props as { dataPath: string; categoryKey: string; valueKey: string; title?: string };
      const data = resolvePath(dataModel, chartProps.dataPath);
      return (
        <TremorDonutChart
          data={Array.isArray(data) ? (data as Record<string, unknown>[]) : []}
          categoryKey={chartProps.categoryKey}
          valueKey={chartProps.valueKey}
          title={chartProps.title}
        />
      );
    }

    default:
      return <div className="text-xs text-red-500">Unknown component: {compType}</div>;
  }
}

interface Props {
  a2uiMessages: A2UIMessage[];
  dataModel: Record<string, unknown>;
}

export default function A2UIRenderer({ a2uiMessages, dataModel }: Props) {
  const surfaces = new Map<string, RenderedSurface>();

  for (const msg of a2uiMessages) {
    if (msg.beginRendering) {
      const br = msg.beginRendering as {
        surfaceId?: string;
        root?: string;
        rootComponentId?: string;
        components?: ComponentDef[];
      };
      const surfaceId = br.surfaceId ?? 'default';
      const rootId = br.root ?? br.rootComponentId ?? '';
      const surface: RenderedSurface = { rootId, components: new Map() };
      surfaces.set(surfaceId, surface);
      // Gemini sometimes embeds components directly in beginRendering
      if (br.components) {
        for (const comp of br.components) {
          surface.components.set(comp.id, comp);
        }
      }
    } else if (msg.surfaceUpdate) {
      const su = msg.surfaceUpdate as { surfaceId: string; components: ComponentDef[] };
      const surface = surfaces.get(su.surfaceId) ?? surfaces.get('default');
      if (!surface) continue;
      for (const comp of su.components) {
        surface.components.set(comp.id, comp);
      }
    }
  }

  const surfaceEntries = Array.from(surfaces.entries());

  if (surfaceEntries.length === 0) {
    return <div className="text-gray-500">No surface to render.</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      {surfaceEntries.map(([surfaceId, surface]) => (
        <div key={surfaceId}>
          <RenderComponent id={surface.rootId} surface={surface} dataModel={dataModel} />
        </div>
      ))}
    </div>
  );
}
