import type { ConceptoB5DOrm, VinculoConceptoBimOrm } from '../../types/b5d-orm';
import type { ElementoIfcB5D } from '../../types/quantity-take-off';

export type IfcConceptSelectionResolution = {
  localIds: number[];
  matchedConceptKeys: string[];
  reason: string | null;
};

export function resolveIfcSelectionFromConceptKey(
  conceptKey: string,
  concepts: ConceptoB5DOrm[],
  links: VinculoConceptoBimOrm[],
  ifcElements: ElementoIfcB5D[],
  activeIfcFileName: string | null | undefined,
): IfcConceptSelectionResolution {
  const normalizedKey = normalizeText(conceptKey);
  if (!normalizedKey) {
    return {
      localIds: [],
      matchedConceptKeys: [],
      reason: 'No se proporciono una clave de concepto valida.',
    };
  }

  const matchingConcepts = concepts.filter((conceptItem) => {
    const conceptKeys = [conceptItem.clave ?? '', conceptItem.clave_secundaria ?? ''];
    return conceptKeys.some((candidateKey) => normalizeText(candidateKey) === normalizedKey);
  });

  if (!matchingConcepts.length) {
    return {
      localIds: [],
      matchedConceptKeys: [],
      reason: `No se encontro un concepto con la clave ${conceptKey}.`,
    };
  }

  const conceptIds = new Set(matchingConcepts.map((conceptItem) => conceptItem.id));
  const linkedRows = links.filter((linkItem) => conceptIds.has(linkItem.concepto_id ?? -1));
  if (!linkedRows.length) {
    return {
      localIds: [],
      matchedConceptKeys: matchingConcepts.map((conceptItem) => conceptItem.clave ?? conceptKey),
      reason: `El concepto ${conceptKey} no tiene vinculos BIM registrados.`,
    };
  }

  const localIds = new Set<number>();
  for (const linkItem of linkedRows) {
    const objectType = normalizeText(linkItem.tipo_objeto_bim ?? '');
    const propertyLabel = normalizeText(linkItem.propiedad_cantidad_bim ?? '');
    if (!objectType || !propertyLabel) continue;

    for (const ifcElement of ifcElements) {
      if (normalizeText(ifcElement.objectType) !== objectType) continue;
      if (normalizeText(inferPropertyLabelFromIfcClass(ifcElement.ifcClass ?? '')) !== propertyLabel) continue;
      localIds.add(ifcElement.localId);
    }
  }

  if (localIds.size) {
    return {
      localIds: [...localIds].sort((first, second) => first - second),
      matchedConceptKeys: matchingConcepts.map((conceptItem) => conceptItem.clave ?? conceptKey),
      reason: null,
    };
  }

  const loadedFileName = normalizeFileName(activeIfcFileName ?? '');
  const visibleFileName = normalizeFileName(ifcElements[0]?.sourceFileName ?? '');
  const fileMismatch = !!loadedFileName && !!visibleFileName && loadedFileName !== visibleFileName;

  return {
    localIds: [],
    matchedConceptKeys: matchingConcepts.map((conceptItem) => conceptItem.clave ?? conceptKey),
    reason: fileMismatch
      ? `El IFC cargado no corresponde al concepto ${conceptKey}.`
      : `No se encontraron elementos IFC vinculados para la clave ${conceptKey} en el archivo cargado.`,
  };
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeFileName(value: string): string {
  const trimmed = normalizeText(value);
  if (!trimmed) return '';
  return trimmed.replace(/\.[^.]+$/, '');
}

function inferPropertyLabelFromIfcClass(ifcClass: string): string {
  const normalizedIfcClass = (ifcClass || '').toUpperCase();
  if (normalizedIfcClass.includes('WALL') || normalizedIfcClass.includes('SLAB') || normalizedIfcClass.includes('COVERING')) {
    return 'Area de la Superficie';
  }
  if (normalizedIfcClass.includes('BEAM') || normalizedIfcClass.includes('PIPE')) {
    return 'Longitud';
  }
  if (normalizedIfcClass.includes('COLUMN') || normalizedIfcClass.includes('FOOTING')) {
    return 'Volumen (Neto)';
  }
  return 'Cantidad';
}
