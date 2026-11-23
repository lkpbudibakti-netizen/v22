import type { ATPItem } from '../../types';
import type { DocumentGenerationContext } from './types';

interface MappingGroup {
  unitTitle: string;
  items: Array<ATPItem & { suppressLegacyAllocation?: boolean }>;
}

export function usesImportedProductionMapping(context: Partial<DocumentGenerationContext>): boolean {
  return context.workMode === 'production' && context.zipAnnualSource?.yearPlan.identityOnlyImport?.mode === 'IDENTITY_ONLY';
}

export function groupAtpMappingForExport(context: DocumentGenerationContext): MappingGroup[] {
  const items = [...(context.atp?.items || [])].sort((a, b) => (a.stepNumber || 0) - (b.stepNumber || 0));
  if (usesImportedProductionMapping(context)) {
    const units = context.atpUnitMapping?.units || [];
    return [...units].sort((a, b) => a.order - b.order).map(unit => ({
      unitTitle: unit.title,
      items: items.filter(item => unit.linkedAtpItemIds.includes(item.id)).map(item => {
        const linked = (item.linkedTpIds?.length ? item.linkedTpIds : item.tpId ? [item.tpId] : [])
          .filter(id => unit.linkedTpIds.includes(id));
        return {
          ...item,
          tpId: undefined,
          tpCode: linked.map(id => context.tp?.items.find(tp => tp.id === id)?.code).filter(Boolean).join(' → '),
          materialScope: unit.materials.filter(material => material.linkedAtpItemIds.includes(item.id))
            .map(material => material.title).join('; '),
          // A legacy ATP-level allocation cannot be assigned to multiple Bab.
          suppressLegacyAllocation: units.filter(other => other.linkedAtpItemIds.includes(item.id)).length > 1,
        };
      }),
    }));
  }
  const groups = new Map<string, MappingGroup>();
  for (const item of items) {
    const unitTitle = item.unitTitle?.trim() || 'Tanpa Unit / Bab';
    if (!groups.has(unitTitle)) groups.set(unitTitle, { unitTitle, items: [] });
    groups.get(unitTitle)!.items.push(item);
  }
  return [...groups.values()];
}
