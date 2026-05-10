const CATALOG_ID = 'https://billing-demo.internal/catalog/v1';

const KNOWN_COMPONENTS = new Set([
  'Text',
  'Row',
  'Column',
  'Card',
  'List',
  'Divider',
  'Button',
  'TremorBarChart',
  'TremorLineChart',
  'TremorDonutChart',
]);

export function validateA2UIMessages(messages: unknown[]): { valid: boolean; error?: string } {
  if (!Array.isArray(messages)) return { valid: false, error: 'messages is not an array' };

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as Record<string, unknown>;
    const keys = Object.keys(msg);
    const validKeys = ['beginRendering', 'surfaceUpdate', 'dataModelUpdate', 'deleteSurface'];
    const actionKeys = keys.filter((k) => validKeys.includes(k));

    if (actionKeys.length !== 1) {
      return {
        valid: false,
        error: `Message ${i} must have exactly one action key, got: ${keys.join(', ')}`,
      };
    }

    if (msg.beginRendering) {
      const br = msg.beginRendering as Record<string, unknown>;
      if (!br.surfaceId || !br.root) {
        return { valid: false, error: `Message ${i} beginRendering missing surfaceId or root` };
      }
      if (br.catalogId && br.catalogId !== CATALOG_ID) {
        return {
          valid: false,
          error: `Message ${i} uses unknown catalogId: ${br.catalogId}`,
        };
      }
    }

    if (msg.surfaceUpdate) {
      const su = msg.surfaceUpdate as Record<string, unknown>;
      if (!Array.isArray(su.components)) {
        return { valid: false, error: `Message ${i} surfaceUpdate missing components array` };
      }
      for (const comp of su.components as Record<string, unknown>[]) {
        if (!comp.id || !comp.component) {
          return { valid: false, error: `Component missing id or component field` };
        }
        const compKeys = Object.keys(comp.component as object);
        if (compKeys.length !== 1) {
          return {
            valid: false,
            error: `Component ${comp.id} must have exactly one type key`,
          };
        }
        const compType = compKeys[0];
        if (!KNOWN_COMPONENTS.has(compType)) {
          return { valid: false, error: `Unknown component type: ${compType}` };
        }
      }
    }
  }

  return { valid: true };
}
