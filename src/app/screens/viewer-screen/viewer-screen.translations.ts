import { type ComponentTranslations } from '../../utils/i18n/translations';

// Manual attention needed: remaining screen translations.
export const VIEWER_SCREEN_TRANSLATIONS: ComponentTranslations = {
  'es-MX': {
    'viewer.prompt.selectFilterMode':
      'Filtro de selección:\n1) Objetos con vínculos (todos)\n2) Objetos con vínculos (conceptos seleccionados)\n3) Objetos seleccionados en el modelo\n4) Todos los objetos del modelo\n5) Objetos del mismo tipo que el seleccionado',
    'viewer.prompt.unlinkedObjectsMode':
      'Objetos sin vínculo:\n1) Objetos sin vínculos a conceptos\n2) Objetos sin materiales relacionados\n3) Materiales sin vínculos a conceptos',
  },
  'en-US': {
    'viewer.prompt.selectFilterMode':
      'Selection filter:\n1) Linked objects (all)\n2) Linked objects (selected concepts)\n3) Selected objects in the model\n4) All objects in the model\n5) Objects of the same type as the selected one',
    'viewer.prompt.unlinkedObjectsMode':
      'Unlinked objects:\n1) Objects without concept links\n2) Objects without related materials\n3) Materials without object links',
  },
};
