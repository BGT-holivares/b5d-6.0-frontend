/**
 * Infrastructure classification result.
 */
export type InfrastructureClassification = {
  category: string; // General infrastructure category
  type: string; // Specific infrastructure element type
  defaultUnit: 'm' | 'm2' | 'm3' | 'pza'; // Suggested quantity unit
};

/**
 * Classifies IFC infrastructure elements using IFC class, name and object type.
 */
export function classifyInfrastructureElement(
  ifcClass: string,
  name = '',
  objectType = ''
): InfrastructureClassification {
  const text = `${ifcClass} ${name} ${objectType}`.toUpperCase();

  if (text.includes('IFCPROJECT')) {
    return {
      category: 'Proyecto',
      type: 'Proyecto IFC',
      defaultUnit: 'pza',
    };
  }

  if (text.includes('IFCSITE')) {
    return {
      category: 'Sitio',
      type: 'Sitio IFC',
      defaultUnit: 'pza',
    };
  }

  if (text.includes('IFCBRIDGE')) {
    return {
      category: 'Infraestructura estructural',
      type: 'Puente',
      defaultUnit: 'm3',
    };
  }

  if (text.includes('IFCBRIDGEPART')) {
    return {
      category: 'Partes de puente',
      type: 'Parte de puente',
      defaultUnit: 'pza',
    };
  }

  if (
    text.includes('IFCWALL') ||
    text.includes('MURO') ||
    text.includes('RETAININGWALL')
  ) {
    return {
      category: 'Estructura de puente',
      type: 'Muro / elemento de contención',
      defaultUnit: 'm3',
    };
  }

  if (
    text.includes('IFCSLAB') ||
    text.includes('LOSA') ||
    text.includes('TABLERO')
  ) {
    return {
      category: 'Estructura de puente',
      type: 'Losa / tablero',
      defaultUnit: 'm2',
    };
  }

  if (
    text.includes('IFCBEAM') ||
    text.includes('VIGA') ||
    text.includes('BEAM')
  ) {
    return {
      category: 'Estructura de puente',
      type: 'Viga',
      defaultUnit: 'm',
    };
  }

  if (
    text.includes('IFCCOLUMN') ||
    text.includes('PILA') ||
    text.includes('COLUMNA') ||
    text.includes('PIER')
  ) {
    return {
      category: 'Estructura de puente',
      type: 'Pila / columna',
      defaultUnit: 'm3',
    };
  }

  if (
    text.includes('IFCFOOTING') ||
    text.includes('CIMENTACION') ||
    text.includes('CIMENTACIÓN') ||
    text.includes('ZAPATA')
  ) {
    return {
      category: 'Cimentación',
      type: 'Cimentación de puente',
      defaultUnit: 'm3',
    };
  }

  if (
    text.includes('IFCALIGNMENT') ||
    text.includes('ALINEAMIENTO')
  ) {
    return {
      category: 'Infraestructura',
      type: 'Alineamiento',
      defaultUnit: 'm',
    };
  }

  if (
    text.includes('IFCROAD') ||
    text.includes('CARRETERA') ||
    text.includes('VIALIDAD') ||
    text.includes('CAMINO')
  ) {
    return {
      category: 'Infraestructura vial',
      type: 'Carretera / vialidad',
      defaultUnit: 'm',
    };
  }

  if (text.includes('IFCBUILDINGELEMENTPROXY')) {
    return {
      category: 'Elementos genéricos',
      type: 'Elemento genérico IFC',
      defaultUnit: 'pza',
    };
  }

  return {
    category: 'Otros',
    type: 'Elemento IFC',
    defaultUnit: 'pza',
  };
}