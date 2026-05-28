export type LinkingWorkspacePanel = 'concepts' | 'ifc-objects' | 'related-links';

export type SelectFilterMode =
  | 'linked-concepts-all'
  | 'linked-concepts-selected'
  | 'selected-in-model'
  | 'all-model'
  | 'same-type-as-selected';

export type UnlinkedObjectsMode =
  | 'objects-without-concept-links'
  | 'objects-without-material'
  | 'materials-without-object-links';

export interface HomeToolbarState {
  activePanel: LinkingWorkspacePanel;
  linksViewVisible: boolean;
  conceptsTotal: number;
  objectsTotal: number;
  linksTotal: number;
  selectedConceptIds: number[];
  selectedNonGroupingConceptIds: number[];
  selectedObjectIds: string[];
  selectedLinkIds: string[];
  canPasteConcept: boolean;
}
