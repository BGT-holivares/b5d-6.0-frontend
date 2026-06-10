import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { I18nService } from '../../utils/i18n/i18n.service';
import { FormsModule } from '@angular/forms';
import { ResizableTableDirective } from '../../directives/resizable-table/resizable-table.directive';
import type { ElementoIfcB5D, NodoCuantificacion } from '../../types/quantity-take-off';
import type {
  CatalogoB5DOrm,
  ConceptoB5DOrm,
  ConceptoB5DDraftOrm,
  SaveB5DProyectPayloadOrm,
  ProyectoTrabajoOrm,
  VinculoConceptoBimDraftOrm,
  VinculoConceptoBimOrm,
} from '../../types/b5d-orm';
import type {
  HomeToolbarState,
  HomeBottomPanelTab,
  LinkingWorkspacePanel,
  SelectFilterMode,
  UnlinkedObjectsMode,
} from '../../types/home-toolbar';
import { LINKING_PANEL_TRANSLATIONS } from './linking-panel.translations';

type ifcObject = {
  id: string;
  objectType: string;
  material: string;
  description: string;
  ifcName: string;
  ifcEntity: string;
  propertyKey: string;
  propertyLabel: string;
  properties: Record<string, unknown>[];
};

type VinculoPanel = {
  id: string;
  originalIdentifier: number | null;
  optimisticLockField?: number | null;
  gcRecord?: number | null;
  conceptoId: number | null;
  conceptCode: string;
  conceptDescription: string;
  objectType: string;
  material: string;
  propertyKey: string;
  propertyLabel: string;
  conversionFactor: number;
  description: string;
};

type ConceptoFila = {
  id: number;
  level: number;
  clave: string;
  descripcion: string;
  unidad: string;
  linked: boolean;
};

type ConceptDraft = {
  clave: string;
  descripcion: string;
  unidad: string;
  esAgrupador: boolean;
};

type RelatedLinksSection = {
  id: string;
  label: string;
  links: VinculoPanel[];
};

@Component({
  selector: 'app-linking-panel',
  imports: [FormsModule, ResizableTableDirective],
  templateUrl: './linking-panel.html',
  styleUrl: './linking-panel.scss',
})
export class LinkingPanel implements OnChanges {
  @ViewChild('layoutWorkspace') private readonly layoutWorkspace?: ElementRef<HTMLElement>;

  readonly i18n = inject(I18nService);
  readonly linkingPanelTranslations = LINKING_PANEL_TRANSLATIONS;

  @Input() ifcData: NodoCuantificacion | null = null;
  @Input() ifcElements: ElementoIfcB5D[] = [];
  @Input() activeProject: ProyectoTrabajoOrm | null = null;
  @Input() b5dConcepts: ConceptoB5DOrm[] = [];
  @Input() b5dLinks: VinculoConceptoBimOrm[] = [];
  @Input() b5dCatalogs: CatalogoB5DOrm[] = [];
  @Input() b5dLoading = false;
  @Input() activeBottomTab: HomeBottomPanelTab = 'links';
  @Output() toolbarStateChange = new EventEmitter<HomeToolbarState>();
  @Output() ifcObjectSelectionChange = new EventEmitter<number[]>();
  @Output() draftChanged = new EventEmitter<void>();

  idSelectedConcept: number | null = null;
  idSelectedObject = '';
  selectedPropertyKey = '';
  localLinks: VinculoPanel[] = [];
  leftPanelWidth = 420;
  topPanelHeight = 260;
  relatedLinksVisible = true;
  activeWorkspacePanel: LinkingWorkspacePanel = 'concepts';
  selectedConceptIds = new Set<number>();
  selectedObjectIds = new Set<string>();
  selectedLinkIds = new Set<string>();
  workConcepts: ConceptoB5DOrm[] = [];
  conceptClipboard: ConceptoB5DOrm | null = null;
  conceptClipboardFromCut = false;
  conceptClipboardSourceId: number | null = null;
  selectedCatalogId: number | null = null;
  hiddenBackendLinkIds = new Set<number>();
  creatingConceptInline = false;
  creatingConceptAnchorId: number | null = null;
  creatingConceptDraft: ConceptDraft = this.getEmptyConceptDraft();
  private temporalConceptId = -1;
  private lastSelectedConceptId: number | null = null;
  private lastSelectedObjectId = '';
  private lastSelectedLinkId = '';
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['b5dConcepts']) {
      this.workConcepts = this.b5dConcepts.map((concepto) => ({ ...concepto }));
      this.selectedConceptIds.clear();
      this.idSelectedConcept = null;
      this.lastSelectedConceptId = null;
    }
    if (changes['b5dCatalogs'] || changes['b5dConcepts']) {
      const availableCatalogIds = new Set(this.b5dCatalogs.map((catalogItem) => catalogItem.id));
      if (this.selectedCatalogId != null && availableCatalogIds.has(this.selectedCatalogId)) {
        // Keep current selected catalog when still available.
      } else {
        const firstConceptWithCatalog = this.workConcepts.find((conceptItem) => conceptItem.catalogo_id != null);
        this.selectedCatalogId = firstConceptWithCatalog?.catalogo_id ?? this.b5dCatalogs[0]?.id ?? null;
      }
    }
    if (changes['b5dLinks']) {
      this.selectedLinkIds.clear();
      this.lastSelectedLinkId = '';
      this.hiddenBackendLinkIds.clear();
    }
    if (changes['ifcElements']) {
      this.selectedObjectIds = new Set(
        [...this.selectedObjectIds].filter((objectId) => this.objetosIfc.some((objectItem) => objectItem.id === objectId)),
      );
      if (this.idSelectedObject && !this.objetosIfc.some((objectItem) => objectItem.id === this.idSelectedObject)) {
        this.idSelectedObject = '';
        this.lastSelectedObjectId = '';
      }
      this.emitIfcObjectSelection();
    }
    this.emitToolbarState();
  }

  get conceptosActivos(): ConceptoB5DOrm[] {
    if (this.selectedCatalogId == null) return this.workConcepts;
    return this.workConcepts.filter((conceptItem) => conceptItem.catalogo_id === this.selectedCatalogId);
  }

  get catalogosDisponibles(): CatalogoB5DOrm[] {
    return this.b5dCatalogs;
  }

  get objetosIfc(): ifcObject[] {
    const rowsByObjectTypeAndProperty = new Map<string, ifcObject>();
    const linkedPropertiesByObjectType = this.getLinkedPropertiesByObjectType();

    for (const ifcElement of this.ifcElements) {
      const objectType = (ifcElement.objectType || '').trim() || this.i18n.translateForComponent(this.linkingPanelTranslations, 'linking.ts.objectType');
      const objectDescription = this.obtenerDescripcionIfcElemento(ifcElement);
      const propertyLabel = this.inferPropertyLabelFromIfcClass(ifcElement.ifcClass ?? '');
      const rowId = this.buildObjectRowId(objectType, propertyLabel);
      const existingRow = rowsByObjectTypeAndProperty.get(rowId);

      if (existingRow) {
        existingRow.description = this.mergeDescriptions(existingRow.description, objectDescription);
        if (!existingRow.ifcName && ifcElement.name) existingRow.ifcName = ifcElement.name;
      } else {
        rowsByObjectTypeAndProperty.set(rowId, {
          id: rowId,
          objectType,
          material: '',
          description: objectDescription,
          ifcName: ifcElement.name || objectType,
          ifcEntity: ifcElement.ifcClass || '',
          propertyKey: this.normalizeText(propertyLabel),
          propertyLabel,
          properties: [],
        });
      }

      const linkedProperties = linkedPropertiesByObjectType.get(this.normalizeText(objectType));
      if (!linkedProperties?.size) continue;

      for (const linkedProperty of linkedProperties.values()) {
        const linkedRowId = this.buildObjectRowId(objectType, linkedProperty);
        if (rowsByObjectTypeAndProperty.has(linkedRowId)) continue;
        rowsByObjectTypeAndProperty.set(linkedRowId, {
          id: linkedRowId,
          objectType,
          material: '',
          description: objectDescription,
          ifcName: ifcElement.name || objectType,
          ifcEntity: ifcElement.ifcClass || '',
          propertyKey: this.normalizeText(linkedProperty),
          propertyLabel: linkedProperty,
          properties: [],
        });
      }
    }

    if (this.ifcData?.children?.length) {
      for (const categoria of this.ifcData.children) {
        for (const tipoNodo of categoria.children) {
          const nodoConPropiedades = tipoNodo as NodoCuantificacion & {
            properties?: Record<string, unknown>[];
          };
          const propertyLabel = this.inferPropertyLabel(tipoNodo.unit ?? '');
          const propertyKey = this.normalizeText(propertyLabel);
          const objectType = tipoNodo.name || this.i18n.translateForComponent(this.linkingPanelTranslations, 'linking.ts.objectType');
          const objectTypeKey = this.normalizeText(objectType);
          const rowId = this.buildObjectRowId(objectType, propertyLabel);
          const existing = rowsByObjectTypeAndProperty.get(rowId);
          const material = this.getMaterialFromProperties(nodoConPropiedades.properties ?? []);

          if (existing) {
            existing.properties.push(...(nodoConPropiedades.properties ?? []));
            existing.description = this.mergeDescriptions(existing.description, categoria.name);
            if (!existing.material && material) existing.material = material;
          } else {
            rowsByObjectTypeAndProperty.set(rowId, {
              id: rowId,
              objectType,
              material,
              description: categoria.name,
              ifcName: objectType,
              ifcEntity: '',
              propertyKey,
              propertyLabel,
              properties: [...(nodoConPropiedades.properties ?? [])],
            });
          }

          const linkedProperties = linkedPropertiesByObjectType.get(objectTypeKey);
          if (!linkedProperties?.size) continue;

          for (const linkedProperty of linkedProperties.values()) {
            const linkedRowId = this.buildObjectRowId(objectType, linkedProperty);
            if (rowsByObjectTypeAndProperty.has(linkedRowId)) continue;
            rowsByObjectTypeAndProperty.set(linkedRowId, {
              id: linkedRowId,
              objectType,
              material,
              description: categoria.name,
              ifcName: objectType,
              ifcEntity: '',
              propertyKey: this.normalizeText(linkedProperty),
              propertyLabel: linkedProperty,
              properties: [...(nodoConPropiedades.properties ?? [])],
            });
          }
        }
      }
    }

    for (const linkObject of this.objetosDesdeVinculosBackend()) {
      if (rowsByObjectTypeAndProperty.has(linkObject.id)) continue;
      rowsByObjectTypeAndProperty.set(linkObject.id, linkObject);
    }

    return [...rowsByObjectTypeAndProperty.values()].sort((first, second) => {
      const objectTypeComparison = first.objectType.localeCompare(second.objectType, 'es');
      if (objectTypeComparison !== 0) return objectTypeComparison;
      return first.propertyLabel.localeCompare(second.propertyLabel, 'es');
    });
  }

  get conceptosEstructurados(): ConceptoFila[] {
    const conceptos = [...this.conceptosActivos];
    const hijosPorPadre = new Map<number | null, ConceptoB5DOrm[]>();
    const ids = new Set<number>(conceptos.map((concepto) => concepto.id));

    for (const concepto of conceptos) {
      const parentId =
        concepto.agrupador_padre_id && ids.has(concepto.agrupador_padre_id)
          ? concepto.agrupador_padre_id
          : null;
      const hijos = hijosPorPadre.get(parentId) ?? [];
      hijos.push(concepto);
      hijosPorPadre.set(parentId, hijos);
    }

    const linkedIds = this.idsConceptoConVinculo();
    const filas: ConceptoFila[] = [];
    const visitados = new Set<number>();

    const recorrer = (parentId: number | null, level: number): void => {
      const hijos = hijosPorPadre.get(parentId) ?? [];
      for (const concepto of hijos) {
        if (visitados.has(concepto.id)) continue;
        visitados.add(concepto.id);
        filas.push({
          id: concepto.id,
          level,
          clave: concepto.clave ?? '',
          descripcion: concepto.descripcion ?? '',
          unidad: concepto.unidad ?? '',
          linked: linkedIds.has(concepto.id),
        });
        recorrer(concepto.id, level + 1);
      }
    };

    recorrer(null, 0);
    for (const concepto of conceptos) {
      if (visitados.has(concepto.id)) continue;
      filas.push({
        id: concepto.id,
        level: 0,
        clave: concepto.clave ?? '',
        descripcion: concepto.descripcion ?? '',
        unidad: concepto.unidad ?? '',
        linked: linkedIds.has(concepto.id),
      });
    }

    return filas;
  }

  get relatedLinks(): VinculoPanel[] {
    const conceptosPorId = new Map<number, ConceptoB5DOrm>();
    for (const concepto of this.workConcepts) {
      conceptosPorId.set(concepto.id, concepto);
    }

    const desdeBackend = this.b5dLinks
      .filter((vinculo) => !this.hiddenBackendLinkIds.has(vinculo.id))
      .map((vinculo) => {
      const concepto = vinculo.concepto_id != null ? conceptosPorId.get(vinculo.concepto_id) : null;
      return {
        id: `db-${vinculo.id}`,
        originalIdentifier: vinculo.identificador_original,
        optimisticLockField: vinculo.optimistic_lock_field ?? null,
        gcRecord: vinculo.gc_record ?? null,
        conceptoId: vinculo.concepto_id,
        conceptCode: concepto?.clave ?? '',
        conceptDescription: concepto?.descripcion ?? '',
        objectType: vinculo.tipo_objeto_bim ?? '',
        material: vinculo.material_bim ?? '',
        propertyKey: vinculo.propiedad_cantidad_bim ?? '',
        propertyLabel: vinculo.propiedad_cantidad_bim ?? '',
        conversionFactor: vinculo.factor_conversion ?? 1,
        description: vinculo.descripcion ?? '',
      } satisfies VinculoPanel;
      });

    return [...desdeBackend, ...this.localLinks];
  }

  get relatedLinkSections(): RelatedLinksSection[] {
    const conceptLinks = this.relatedLinksFromSelectedConcepts;
    const objectLinks = this.relatedLinksFromSelectedObjects;

    if (!conceptLinks.length && !objectLinks.length) {
      if (!this.relatedLinks.length) return [];
      return [
        {
          id: 'all',
          label: this.i18n.translateForComponent(this.linkingPanelTranslations, 'linking.links.forAll'),
          links: this.relatedLinks,
        },
      ];
    }

    const sections: RelatedLinksSection[] = [];
    if (conceptLinks.length) {
      sections.push({
        id: 'concept',
        label: `${this.i18n.translateForComponent(this.linkingPanelTranslations, 'linking.links.forConcept')}: ${this.selectedConceptSummaryLabel}`,
        links: conceptLinks,
      });
    }

    if (objectLinks.length) {
      const conceptLinkIds = new Set(conceptLinks.map((linkItem) => linkItem.id));
      const objectOnlyLinks = objectLinks.filter((linkItem) => !conceptLinkIds.has(linkItem.id));
      if (objectOnlyLinks.length) {
        sections.push({
          id: 'object',
          label: `${this.i18n.translateForComponent(this.linkingPanelTranslations, 'linking.links.forObject')}: ${this.selectedObjectSummaryLabel}`,
          links: objectOnlyLinks,
        });
      }
    }

    return sections;
  }

  get relatedLinksFiltrados(): VinculoPanel[] {
    const selectedConceptIds = this.selectedConceptIds;
    const hasConceptFilter = selectedConceptIds.size > 0;
    const selectedObjectKeys = new Set(
      this.objetosIfc
        .filter((objectItem) => this.selectedObjectIds.has(objectItem.id))
        .map((objectItem) => this.buildLinkKey(objectItem.objectType, objectItem.propertyLabel)),
    );
    const hasObjectFilter = selectedObjectKeys.size > 0;

    if (!hasConceptFilter && !hasObjectFilter) return this.relatedLinks;

    return this.relatedLinks.filter((linkItem) => {
      const conceptMatch = hasConceptFilter && selectedConceptIds.has(linkItem.conceptoId ?? -1);
      const objectMatch = hasObjectFilter && selectedObjectKeys.has(this.buildLinkKey(linkItem.objectType, linkItem.propertyLabel));
      return conceptMatch || objectMatch;
    });
  }

  get opcionesPropiedad(): string[] {
    const objeto = this.objetosIfc.find((item) => item.id === this.idSelectedObject);
    if (!objeto) return [];

    const keys = new Set<string>([
      'quantity',
      'area',
      'grossArea',
      'netArea',
      'volume',
      'grossVolume',
      'netVolume',
      'length',
      'perimeter',
    ]);

    for (const propiedad of objeto.properties) {
      for (const key of Object.keys(propiedad)) {
        if (!['localId', 'name', 'ifcClass', 'storey', 'objectType'].includes(key)) {
          keys.add(key);
        }
      }

      const cantidades = propiedad['quantities'];
      if (cantidades && typeof cantidades === 'object') {
        for (const key of Object.keys(cantidades)) keys.add(key);
      }
    }

    return Array.from(keys).sort((a, b) => a.localeCompare(b, 'es'));
  }

  selectObject(id: string, event?: MouseEvent): void {
    this.selectActivePanel('ifc-objects');
    this.idSelectedObject = id;
    const selectedObject = this.objetosIfc.find((objectItem) => objectItem.id === id);
    this.selectedPropertyKey = selectedObject?.propertyLabel ?? '';
    const additiveSelection = !!event?.ctrlKey || !!event?.metaKey;
    const rangeSelection = !!event?.shiftKey;

    if (rangeSelection && this.lastSelectedObjectId) {
      const objectRangeIds = this.resolveRangeIds(
        this.objetosIfc.map((objectItem) => objectItem.id),
        this.lastSelectedObjectId,
        id,
      );
      this.selectedObjectIds = additiveSelection
        ? new Set([...this.selectedObjectIds, ...objectRangeIds])
        : new Set(objectRangeIds);
    } else {
      this.toggleSelectionInSet(this.selectedObjectIds, id, additiveSelection);
    }

    this.lastSelectedObjectId = id;
    this.selectedLinkIds.clear();
    this.emitToolbarState();
    this.emitIfcObjectSelection();
  }

  selectConcept(id: number, event?: MouseEvent): void {
    this.selectActivePanel('concepts');
    this.idSelectedConcept = id;
    const additiveSelection = !!event?.ctrlKey || !!event?.metaKey;
    const rangeSelection = !!event?.shiftKey;

    if (rangeSelection && this.lastSelectedConceptId != null) {
      const conceptRangeIds = this.resolveRangeIds(
        this.conceptosEstructurados.map((conceptItem) => conceptItem.id),
        this.lastSelectedConceptId,
        id,
      );
      this.selectedConceptIds = additiveSelection
        ? new Set([...this.selectedConceptIds, ...conceptRangeIds])
        : new Set(conceptRangeIds);
    } else {
      this.toggleSelectionInSet(this.selectedConceptIds, id, additiveSelection);
    }

    this.lastSelectedConceptId = id;
    this.selectedLinkIds.clear();
    this.emitToolbarState();
  }

  selectLink(id: string, event?: MouseEvent): void {
    this.selectActivePanel('related-links');
    const additiveSelection = !!event?.ctrlKey || !!event?.metaKey;
    const rangeSelection = !!event?.shiftKey;

    if (rangeSelection && this.lastSelectedLinkId) {
      const linkRangeIds = this.resolveRangeIds(
        this.relatedLinksFiltrados.map((linkItem) => linkItem.id),
        this.lastSelectedLinkId,
        id,
      );
      this.selectedLinkIds = additiveSelection
        ? new Set([...this.selectedLinkIds, ...linkRangeIds])
        : new Set(linkRangeIds);
    } else {
      this.toggleSelectionInSet(this.selectedLinkIds, id, additiveSelection);
    }

    this.lastSelectedLinkId = id;
    this.emitToolbarState();
  }

  selectCatalog(catalogId: number | null): void {
    this.selectedCatalogId = catalogId;
    this.selectedConceptIds.clear();
    this.idSelectedConcept = null;
    this.emitToolbarState();
    this.emitDraftChanged();
  }

  // Updates the visible catalog without marking the draft as modified.
  setCatalogSelectionFromHost(catalogId: number | null): void {
    this.selectedCatalogId = catalogId;
    this.selectedConceptIds.clear();
    this.idSelectedConcept = null;
    this.emitToolbarState();
  }

  isSelectedConcept(id: number): boolean {
    return this.selectedConceptIds.has(id);
  }

  isSelectedObject(id: string): boolean {
    return this.selectedObjectIds.has(id);
  }

  isSelectedLink(id: string): boolean {
    return this.selectedLinkIds.has(id);
  }

  isLinkedObject(ifcObject: ifcObject): boolean {
    const objectType = this.normalizeText(ifcObject.objectType);
    const quantityProperty = this.normalizeText(ifcObject.propertyLabel);

    return this.relatedLinks.some((vinculo) => {
      return (
        this.normalizeText(vinculo.objectType) === objectType &&
        this.normalizeText(vinculo.propertyLabel) === quantityProperty
      );
    });
  }

  indentation(level: number): string {
    return `${10 + level * 18}px`;
  }

  addLink(): void {
    const concepto = this.conceptosActivos.find((item) => item.id === this.idSelectedConcept);
    const objeto = this.objetosIfc.find((item) => item.id === this.idSelectedObject);

    if (!concepto || !objeto || !this.selectedPropertyKey) return;

    this.localLinks = [
      ...this.localLinks,
      this.crearVinculoLocal(
        concepto.id,
        concepto.clave ?? '',
        concepto.descripcion ?? '',
        objeto.objectType,
        objeto.material,
        this.selectedPropertyKey,
        objeto.description,
      ),
    ];
    this.emitToolbarState();
    this.emitDraftChanged();
  }

  triggerHomeAction(accion: string): void {
    if (accion === 'home-add-item') {
      this.addConceptFromToolbar();
      return;
    }
    if (accion === 'home-remove-item') {
      this.deleteCurrentSelection();
      return;
    }
    if (accion === 'home-select-all') {
      this.selectAllVisible();
      return;
    }
    if (accion === 'home-cut') {
      this.cutSelectedConcept();
      return;
    }
    if (accion === 'home-copy') {
      this.copySelectedConcept();
      return;
    }
    if (accion === 'home-paste') {
      this.pasteSelectedConcept();
      return;
    }
    if (accion === 'home-links-view') {
      this.relatedLinksVisible = !this.relatedLinksVisible;
      this.emitToolbarState();
      return;
    }
    if (accion === 'home-assign-property') {
      this.assignPropertiesFromSelection();
      return;
    }
  }

  // Returns the current concepts and links draft to persist in the backend project.
  getProjectDraft(): SaveB5DProyectPayloadOrm {
    const conceptDraftRows: ConceptoB5DDraftOrm[] = this.workConcepts.map((conceptItem) => ({
      id: conceptItem.id,
      catalogo_id: conceptItem.catalogo_id ?? this.selectedCatalogId ?? null,
      clave: conceptItem.clave ?? null,
      clave_secundaria: conceptItem.clave_secundaria ?? null,
      descripcion: conceptItem.descripcion ?? null,
      es_agrupador: !!conceptItem.es_agrupador,
      agrupador_padre_id: conceptItem.agrupador_padre_id ?? null,
      unidad: conceptItem.unidad ?? null,
      orden: conceptItem.orden ?? null,
      optimistic_lock_field: conceptItem.optimistic_lock_field ?? null,
      gc_record: conceptItem.gc_record ?? null,
    }));

    const linkDraftRows: VinculoConceptoBimDraftOrm[] = this.relatedLinks.map((linkItem) => ({
      id: linkItem.id,
      identificador_original: linkItem.originalIdentifier ?? null,
      concepto_id: linkItem.conceptoId ?? null,
      tipo_objeto_bim: linkItem.objectType || null,
      material_bim: linkItem.material || null,
      propiedad_cantidad_bim: linkItem.propertyLabel || null,
      factor_conversion: linkItem.conversionFactor ?? 1,
      descripcion: linkItem.description || null,
      optimistic_lock_field:
        'optimisticLockField' in linkItem ? ((linkItem as { optimisticLockField?: number | null }).optimisticLockField ?? null) : null,
      gc_record: 'gcRecord' in linkItem ? ((linkItem as { gcRecord?: number | null }).gcRecord ?? null) : null,
    }));

    return {
      catalogo_activo_id: this.selectedCatalogId ?? null,
      conceptos: conceptDraftRows,
      vinculos: linkDraftRows,
    };
  }

  aplicarFiltroSeleccion(modo: SelectFilterMode): void {
    const objects = this.objetosIfc;
    if (!objects.length) return;

    const selectedObjectIds = new Set<string>();

    if (modo === 'all-model') {
      for (const objectItem of objects) selectedObjectIds.add(objectItem.id);
    } else if (modo === 'same-type-as-selected') {
      const selectedTypes = new Set(
        objects
          .filter((objectItem) => this.selectedObjectIds.has(objectItem.id))
          .map((objectItem) => this.normalizeText(objectItem.objectType)),
      );
      for (const objectItem of objects) {
        if (selectedTypes.has(this.normalizeText(objectItem.objectType))) {
          selectedObjectIds.add(objectItem.id);
        }
      }
    } else if (modo === 'linked-concepts-all') {
      for (const objectItem of objects) {
        if (this.isLinkedObject(objectItem)) selectedObjectIds.add(objectItem.id);
      }
    } else if (modo === 'linked-concepts-selected') {
      const selectedConceptIds = this.selectedConceptIds;
      for (const objectItem of objects) {
        const hasLinkWithSelectedConcept = this.relatedLinks.some((linkItem) => {
          return (
            selectedConceptIds.has(linkItem.conceptoId ?? -1) &&
            this.normalizeText(linkItem.objectType) === this.normalizeText(objectItem.objectType) &&
            this.normalizeText(linkItem.propertyLabel) === this.normalizeText(objectItem.propertyLabel)
          );
        });
        if (hasLinkWithSelectedConcept) selectedObjectIds.add(objectItem.id);
      }
    } else if (modo === 'selected-in-model') {
      for (const objectId of this.selectedObjectIds) selectedObjectIds.add(objectId);
    }

    this.selectedObjectIds = selectedObjectIds;
    this.selectActivePanel('ifc-objects');
    this.emitToolbarState();
    this.emitIfcObjectSelection();
  }

  aplicarFiltroObjetosSinVinculo(modo: UnlinkedObjectsMode): void {
    const objects = this.objetosIfc;
    const selectedObjectIds = new Set<string>();

    if (modo === 'objects-without-concept-links') {
      for (const objectItem of objects) {
        if (!this.isLinkedObject(objectItem)) selectedObjectIds.add(objectItem.id);
      }
    } else if (modo === 'objects-without-material') {
      for (const objectItem of objects) {
        if (!objectItem.material.trim()) selectedObjectIds.add(objectItem.id);
      }
    } else if (modo === 'materials-without-object-links') {
      const linkedMaterials = new Set(
        this.relatedLinks
          .map((linkItem) => this.normalizeText(linkItem.material))
          .filter((material) => !!material),
      );
      for (const objectItem of objects) {
        const normalizedMaterial = this.normalizeText(objectItem.material);
        if (normalizedMaterial && !linkedMaterials.has(normalizedMaterial)) {
          selectedObjectIds.add(objectItem.id);
        }
      }
    }

    this.selectedObjectIds = selectedObjectIds;
    this.selectActivePanel('ifc-objects');
    this.emitToolbarState();
    this.emitIfcObjectSelection();
  }

  // Marks the active working panel to drive toolbar action availability.
  selectActivePanel(panel: LinkingWorkspacePanel): void {
    this.activeWorkspacePanel = panel;
    this.emitToolbarState();
  }

  // Emits the current linking workspace state to the Home toolbar.
  private emitToolbarState(): void {
    const selectedNonGroupingConceptIds = this.conceptosActivos
      .filter((conceptItem) => this.selectedConceptIds.has(conceptItem.id) && !conceptItem.es_agrupador)
      .map((conceptItem) => conceptItem.id);

    this.toolbarStateChange.emit({
      activeBottomTab: this.activeBottomTab,
      activePanel: this.activeWorkspacePanel,
      linksViewVisible: this.relatedLinksVisible,
      conceptsTotal: this.conceptosEstructurados.length,
      objectsTotal: this.objetosIfc.length,
      linksTotal: this.relatedLinksFiltrados.length,
      selectedConceptIds: [...this.selectedConceptIds],
      selectedNonGroupingConceptIds,
      selectedObjectIds: [...this.selectedObjectIds],
      selectedLinkIds: [...this.selectedLinkIds],
      canPasteConcept: !!this.conceptClipboard,
      selectedCatalogId: this.selectedCatalogId,
    });
  }

  // Toggles row selection while keeping single-select mode when Ctrl/Cmd is not pressed.
  private toggleSelectionInSet<T>(selectionSet: Set<T>, itemId: T, additiveSelection: boolean): void {
    if (!additiveSelection) {
      selectionSet.clear();
      selectionSet.add(itemId);
      return;
    }

    if (selectionSet.has(itemId)) {
      selectionSet.delete(itemId);
      return;
    }

    selectionSet.add(itemId);
  }

  // Resolves contiguous IDs between anchor and target respecting current visible ordering.
  private resolveRangeIds<T>(orderedIds: T[], anchorId: T, targetId: T): T[] {
    const anchorIndex = orderedIds.findIndex((itemId) => itemId === anchorId);
    const targetIndex = orderedIds.findIndex((itemId) => itemId === targetId);
    if (anchorIndex < 0 || targetIndex < 0) return [targetId];

    const startIndex = Math.min(anchorIndex, targetIndex);
    const endIndex = Math.max(anchorIndex, targetIndex);
    return orderedIds.slice(startIndex, endIndex + 1);
  }

  // Emits local IFC IDs for selected object rows so the 3D viewer can mirror selection.
  private emitIfcObjectSelection(): void {
    if (!this.selectedObjectIds.size) {
      this.ifcObjectSelectionChange.emit([]);
      return;
    }

    const selectedLocalIds = new Set<number>();
    const objectsById = new Map(this.objetosIfc.map((objectItem) => [objectItem.id, objectItem]));
    for (const objectRowId of this.selectedObjectIds) {
      const objectRow = objectsById.get(objectRowId);
      if (!objectRow) continue;
      const localIds = this.resolveLocalIdsForObjectRow(objectRow);
      for (const localId of localIds) selectedLocalIds.add(localId);
    }

    this.ifcObjectSelectionChange.emit([...selectedLocalIds]);
  }

  // Resolves IFC local IDs represented by a row grouped by object type and quantity property.
  private resolveLocalIdsForObjectRow(objectRow: ifcObject): number[] {
    const normalizedObjectType = this.normalizeText(objectRow.objectType);
    const normalizedProperty = this.normalizeText(objectRow.propertyLabel);
    const localIds: number[] = [];

    for (const ifcElement of this.ifcElements) {
      const elementObjectType = this.normalizeText(ifcElement.objectType || this.i18n.translateForComponent(this.linkingPanelTranslations, 'linking.ts.objectType'));
      if (elementObjectType !== normalizedObjectType) continue;

      const elementProperty = this.normalizeText(this.inferPropertyLabelFromIfcClass(ifcElement.ifcClass ?? ''));
      if (elementProperty !== normalizedProperty) continue;
      localIds.push(ifcElement.localId);
    }

    return localIds;
  }

  // Builds a link row with normalized data from concept and IFC object selections.
  private crearVinculoLocal(
    conceptId: number,
    conceptCode: string,
    conceptDescription: string,
    objectType: string,
    material: string,
    propertyLabel: string,
    description: string,
  ): VinculoPanel {
    const localIdentifier = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    return {
      id: `local-${localIdentifier}`,
      originalIdentifier: null,
      optimisticLockField: 1,
      gcRecord: null,
      conceptoId: conceptId,
      conceptCode,
      conceptDescription,
      objectType,
      material,
      propertyKey: this.normalizeText(propertyLabel),
      propertyLabel,
      conversionFactor: 1,
      description,
    };
  }

  // Creates a new concept or grouping concept in the current concept structure panel.
  private addConceptFromToolbar(): void {
    if (this.activeWorkspacePanel !== 'concepts') return;
    this.startInlineConceptCreate();
  }

  startInlineConceptCreate(): void {
    const selectedConcept = this.getPrimarySelectedConcept();
    this.creatingConceptAnchorId = selectedConcept?.id ?? this.conceptosEstructurados[0]?.id ?? null;
    this.creatingConceptDraft = this.getPrefilledConceptDraft(selectedConcept);
    this.creatingConceptInline = true;
    this.emitToolbarState();
  }

  isConceptEditorAnchoredAfter(conceptId: number): boolean {
    return this.creatingConceptInline && this.creatingConceptAnchorId === conceptId;
  }

  cancelInlineConceptCreate(): void {
    this.creatingConceptInline = false;
    this.creatingConceptAnchorId = null;
    this.creatingConceptDraft = this.getEmptyConceptDraft();
    this.emitToolbarState();
  }

  saveInlineConceptCreate(): void {
    if (!this.creatingConceptInline) return;
    const selectedConcept = this.conceptosActivos.find((conceptItem) => conceptItem.id === this.creatingConceptAnchorId) ?? null;
    const parentConceptId = selectedConcept ? selectedConcept.id : null;
    const isGroupingConcept = this.creatingConceptDraft.esAgrupador;
    const defaultDescription = isGroupingConcept ? 'Nuevo agrupador' : 'Nuevo concepto';

    const newConceptId = this.temporalConceptId--;
    const suggestedOrder = this.obtenerOrdenSugeridoNuevoConcepto(parentConceptId, selectedConcept?.id ?? null);
    const newConcept: ConceptoB5DOrm = {
      id: newConceptId,
      identificador_original: null,
      catalogo_id: this.selectedCatalogId,
      clave: this.creatingConceptDraft.clave.trim() || `NEW-${Math.abs(newConceptId)}`,
      clave_secundaria: null,
      descripcion: this.creatingConceptDraft.descripcion.trim() || defaultDescription,
      es_agrupador: isGroupingConcept,
      agrupador_padre_id: parentConceptId,
      unidad: isGroupingConcept ? null : this.creatingConceptDraft.unidad.trim() || null,
      orden: suggestedOrder,
      optimistic_lock_field: 1,
      gc_record: null,
    };

    this.workConcepts = [...this.workConcepts, newConcept];
    this.selectedConceptIds = new Set([newConcept.id]);
    this.idSelectedConcept = newConcept.id;
    this.creatingConceptInline = false;
    this.creatingConceptAnchorId = null;
    this.creatingConceptDraft = this.getEmptyConceptDraft();
    this.emitToolbarState();
    this.emitDraftChanged();
  }

  // Deletes selected concepts, or removes concept-object links from selected rows.
  private deleteCurrentSelection(): void {
    if (this.activeWorkspacePanel === 'concepts') {
      if (!this.selectedConceptIds.size) return;

      const conceptIdsToDelete = this.collectConceptBranchIds(this.selectedConceptIds);
      this.workConcepts = this.workConcepts.filter((conceptItem) => !conceptIdsToDelete.has(conceptItem.id));
      this.localLinks = this.localLinks.filter((linkItem) => !conceptIdsToDelete.has(linkItem.conceptoId ?? -1));

      for (const backendLink of this.b5dLinks) {
        if (conceptIdsToDelete.has(backendLink.concepto_id ?? -1)) {
          this.hiddenBackendLinkIds.add(backendLink.id);
        }
      }

      this.selectedConceptIds.clear();
      this.idSelectedConcept = null;
      this.selectedLinkIds.clear();
      this.emitToolbarState();
      this.emitDraftChanged();
      return;
    }

    this.removeLinksFromSelections();
  }

  // Selects all visible rows in the active panel.
  private selectAllVisible(): void {
    if (this.activeWorkspacePanel === 'concepts') {
      this.selectedConceptIds = new Set(this.conceptosEstructurados.map((conceptItem) => conceptItem.id));
      this.idSelectedConcept = this.conceptosEstructurados[0]?.id ?? null;
      this.lastSelectedConceptId = this.idSelectedConcept;
      this.emitToolbarState();
      return;
    }

    if (this.activeWorkspacePanel === 'ifc-objects') {
      this.selectedObjectIds = new Set(this.objetosIfc.map((objectItem) => objectItem.id));
      this.idSelectedObject = this.objetosIfc[0]?.id ?? '';
      this.lastSelectedObjectId = this.idSelectedObject;
      this.emitToolbarState();
      this.emitIfcObjectSelection();
      return;
    }

    this.selectedLinkIds = new Set(this.relatedLinksFiltrados.map((linkItem) => linkItem.id));
    this.lastSelectedLinkId = this.relatedLinksFiltrados[0]?.id ?? '';
    this.emitToolbarState();
  }

  // Stores the selected concept in clipboard and marks it for move operation.
  private cutSelectedConcept(): void {
    const selectedConcept = this.getPrimarySelectedConcept();
    if (!selectedConcept) return;

    this.conceptClipboard = { ...selectedConcept };
    this.conceptClipboardSourceId = selectedConcept.id;
    this.conceptClipboardFromCut = true;
    this.emitToolbarState();
  }

  // Stores the selected concept in clipboard and marks it for copy operation.
  private copySelectedConcept(): void {
    const selectedConcept = this.getPrimarySelectedConcept();
    if (!selectedConcept) return;

    this.conceptClipboard = { ...selectedConcept };
    this.conceptClipboardSourceId = selectedConcept.id;
    this.conceptClipboardFromCut = false;
    this.emitToolbarState();
  }

  // Pastes the clipboard concept inside the active concept context.
  private pasteSelectedConcept(): void {
    if (this.activeWorkspacePanel !== 'concepts' || !this.conceptClipboard) return;

    const selectedConcept = this.getPrimarySelectedConcept();
    const targetParentId = selectedConcept ? selectedConcept.id : null;

    if (this.conceptClipboardFromCut && this.conceptClipboardSourceId != null) {
      this.workConcepts = this.workConcepts.map((conceptItem) => {
        if (conceptItem.id !== this.conceptClipboardSourceId) return conceptItem;
        return {
          ...conceptItem,
          agrupador_padre_id: targetParentId,
        };
      });
      this.selectedConceptIds = new Set([this.conceptClipboardSourceId]);
      this.idSelectedConcept = this.conceptClipboardSourceId;
      this.conceptClipboardFromCut = false;
      this.conceptClipboard = null;
      this.conceptClipboardSourceId = null;
      this.emitToolbarState();
      this.emitDraftChanged();
      return;
    }

    const newConceptId = this.temporalConceptId--;
    const sourceConcept = this.conceptClipboard;
    const suggestedOrder = this.obtenerOrdenSugeridoNuevoConcepto(targetParentId, this.idSelectedConcept);
    const copyConcept: ConceptoB5DOrm = {
      ...sourceConcept,
      id: newConceptId,
      identificador_original: null,
      clave: `${sourceConcept.clave ?? 'NEW'}-COPY`,
      agrupador_padre_id: targetParentId,
      catalogo_id: sourceConcept.catalogo_id ?? this.selectedCatalogId ?? null,
      orden: suggestedOrder,
      optimistic_lock_field: 1,
      gc_record: null,
    };

    this.workConcepts = [...this.workConcepts, copyConcept];
    this.selectedConceptIds = new Set([copyConcept.id]);
    this.idSelectedConcept = copyConcept.id;
    this.emitToolbarState();
    this.emitDraftChanged();
  }

  // Creates links between selected non-grouping concepts and selected IFC object rows.
  private assignPropertiesFromSelection(): void {
    const selectedConcepts = this.conceptosActivos.filter((conceptItem) => {
      return this.selectedConceptIds.has(conceptItem.id) && !conceptItem.es_agrupador;
    });
    const selectedObjects = this.objetosIfc.filter((objectItem) => this.selectedObjectIds.has(objectItem.id));

    if (!selectedConcepts.length || !selectedObjects.length) return;

    const newLinks: VinculoPanel[] = [];

    for (const conceptItem of selectedConcepts) {
      for (const objectItem of selectedObjects) {
        const linkAlreadyExists = this.relatedLinks.some((linkItem) => {
          return (
            linkItem.conceptoId === conceptItem.id &&
            this.normalizeText(linkItem.objectType) === this.normalizeText(objectItem.objectType) &&
            this.normalizeText(linkItem.propertyLabel) === this.normalizeText(objectItem.propertyLabel)
          );
        });

        if (linkAlreadyExists) continue;

        newLinks.push(
          this.crearVinculoLocal(
            conceptItem.id,
            conceptItem.clave ?? '',
            conceptItem.descripcion ?? '',
            objectItem.objectType,
            objectItem.material,
            objectItem.propertyLabel,
            objectItem.description,
          ),
        );
      }
    }

    if (!newLinks.length) return;

    this.localLinks = [...this.localLinks, ...newLinks];
    this.selectActivePanel('related-links');
    this.emitToolbarState();
    this.emitDraftChanged();
  }

  // Removes links from selected rows in IFC objects or related links panels.
  private removeLinksFromSelections(): void {
    const linksToRemove = new Set<string>();

    if (this.selectedLinkIds.size) {
      for (const linkId of this.selectedLinkIds) linksToRemove.add(linkId);
    } else if (this.activeWorkspacePanel === 'ifc-objects' && this.selectedObjectIds.size) {
      const selectedObjectKeys = new Set(
        this.objetosIfc
          .filter((objectItem) => this.selectedObjectIds.has(objectItem.id))
          .map((objectItem) => this.buildLinkKey(objectItem.objectType, objectItem.propertyLabel)),
      );

      for (const linkItem of this.relatedLinks) {
        if (selectedObjectKeys.has(this.buildLinkKey(linkItem.objectType, linkItem.propertyLabel))) {
          linksToRemove.add(linkItem.id);
        }
      }
    } else if (this.activeWorkspacePanel === 'related-links') {
      for (const linkItem of this.relatedLinksFiltrados) linksToRemove.add(linkItem.id);
    }

    if (!linksToRemove.size) return;

    this.localLinks = this.localLinks.filter((linkItem) => !linksToRemove.has(linkItem.id));

    for (const linkId of linksToRemove) {
      if (!linkId.startsWith('db-')) continue;
      const backendId = Number(linkId.replace('db-', ''));
      if (!Number.isNaN(backendId)) this.hiddenBackendLinkIds.add(backendId);
    }

    this.selectedLinkIds.clear();
    this.emitToolbarState();
    this.emitDraftChanged();
  }

  // Returns the selected concept that should receive cut, copy, and paste operations.
  private getPrimarySelectedConcept(): ConceptoB5DOrm | null {
    if (this.idSelectedConcept != null) {
      const selectedConcept = this.conceptosActivos.find((conceptItem) => conceptItem.id === this.idSelectedConcept);
      if (selectedConcept) return selectedConcept;
    }

    const firstSelectedConceptId = [...this.selectedConceptIds][0];
    if (firstSelectedConceptId == null) return null;
    return this.conceptosActivos.find((conceptItem) => conceptItem.id === firstSelectedConceptId) ?? null;
  }

  // Collects selected concepts and descendants for structural delete operations.
  private collectConceptBranchIds(initialConceptIds: Set<number>): Set<number> {
    const conceptIdsToDelete = new Set(initialConceptIds);
    let hasChanges = true;

    while (hasChanges) {
      hasChanges = false;
      for (const conceptItem of this.workConcepts) {
        if (conceptItem.agrupador_padre_id == null) continue;
        if (!conceptIdsToDelete.has(conceptItem.agrupador_padre_id)) continue;
        if (conceptIdsToDelete.has(conceptItem.id)) continue;

        conceptIdsToDelete.add(conceptItem.id);
        hasChanges = true;
      }
    }

    return conceptIdsToDelete;
  }

  // Computes a stable order value (hundreds scale) and uses midpoint insertion when possible.
  private obtenerOrdenSugeridoNuevoConcepto(parentConceptId: number | null, anchorConceptId: number | null): number {
    const siblings = this.workConcepts
      .filter((conceptItem) => (conceptItem.agrupador_padre_id ?? null) === parentConceptId)
      .sort((first, second) => (first.orden ?? Number.MAX_SAFE_INTEGER) - (second.orden ?? Number.MAX_SAFE_INTEGER));
    if (!siblings.length) return 100;

    const anchorIndex = anchorConceptId == null ? -1 : siblings.findIndex((conceptItem) => conceptItem.id === anchorConceptId);
    if (anchorIndex < 0) {
      const maxOrder = siblings.reduce((currentMax, conceptItem) => Math.max(currentMax, conceptItem.orden ?? 0), 0);
      return maxOrder + 100;
    }

    const anchorOrder = siblings[anchorIndex].orden ?? (anchorIndex + 1) * 100;
    const nextSibling = siblings[anchorIndex + 1];
    if (!nextSibling) return anchorOrder + 100;

    const nextOrder = nextSibling.orden ?? anchorOrder + 200;
    const midpointOrder = Math.floor((anchorOrder + nextOrder) / 2);
    if (midpointOrder > anchorOrder && midpointOrder < nextOrder) return midpointOrder;

    return anchorOrder + 1;
  }

  // Normalizes object type and property values to compare link rows.
  private buildLinkKey(objectType: string, propertyLabel: string): string {
    return `${this.normalizeText(objectType)}|${this.normalizeText(propertyLabel)}`;
  }

  // Starts resizing between top panels or between top and bottom sections.
  startInternalResize(event: PointerEvent, axis: 'horizontal' | 'vertical'): void {
    if (event.button !== 0) return;
    const workspaceElement = this.layoutWorkspace?.nativeElement;
    if (!workspaceElement) return;

    event.preventDefault();

    const startX = event.clientX;
    const startY = event.clientY;
    const startLeftPanelWidth = this.leftPanelWidth;
    const startTopPanelHeight = this.topPanelHeight;
    const workspaceWidth = workspaceElement.clientWidth;
    const workspaceHeight = workspaceElement.clientHeight;

    const onPointerMove = (moveEvent: PointerEvent): void => {
      if (axis === 'vertical') {
        const minLeftPanelWidth = 280;
        const minRightPanelWidth = 300;
        const splitterSize = 8;
        const maxLeftPanelWidth = workspaceWidth - minRightPanelWidth - splitterSize;
        this.leftPanelWidth = this.clamp(
          startLeftPanelWidth + (moveEvent.clientX - startX),
          minLeftPanelWidth,
          Math.max(minLeftPanelWidth, maxLeftPanelWidth),
        );
        this.changeDetectorRef.detectChanges();
        return;
      }

      const minTopPanelHeight = 150;
      const minBottomPanelHeight = 130;
      const splitterSize = 8;
      const maxTopPanelHeight = workspaceHeight - minBottomPanelHeight - splitterSize;
      this.topPanelHeight = this.clamp(
        startTopPanelHeight + (moveEvent.clientY - startY),
        minTopPanelHeight,
        Math.max(minTopPanelHeight, maxTopPanelHeight),
      );
      this.changeDetectorRef.detectChanges();
    };

    const stopResizing = (): void => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopResizing);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopResizing, { once: true });
  }

  get topRowTemplateColumns(): string {
    return `${this.leftPanelWidth}px 8px minmax(0, 1fr)`;
  }

  get workspaceTemplateRows(): string {
    if (!this.relatedLinksVisible) return 'minmax(0, 1fr)';
    return `${this.topPanelHeight}px 8px minmax(0, 1fr)`;
  }

  // Returns unit shorthand inferred from the selected quantity property.
  getObjectUnit(objectItem: ifcObject): string {
    const propertyLabel = this.normalizeText(objectItem.propertyLabel);
    if (propertyLabel.includes('volumen')) return 'm3';
    if (propertyLabel.includes('area')) return 'm2';
    if (propertyLabel.includes('longitud') || propertyLabel.includes('perimetro')) return 'm';
    return 'pza';
  }

  // Returns IFC entity class from the first available object property payload.
  getObjectEntity(objectItem: ifcObject): string {
    const firstProperty = objectItem.properties[0];
    const ifcEntity = firstProperty?.['ifcClass'];
    if (typeof ifcEntity === 'string' && ifcEntity.trim()) return ifcEntity.trim();
    if (objectItem.ifcEntity.trim()) return objectItem.ifcEntity.trim();
    return '-';
  }

  // Returns IFC object name from the first available property payload.
  getObjectName(objectItem: ifcObject): string {
    const firstProperty = objectItem.properties[0];
    const ifcName = firstProperty?.['name'];
    if (typeof ifcName === 'string' && ifcName.trim()) return ifcName.trim();
    return objectItem.ifcName || '-';
  }

  // Returns IFC description fallback text for object table display.
  getObjectIfcDescription(objectItem: ifcObject): string {
    const description = objectItem.description?.trim() ?? '';
    return description || '-';
  }

  private idsConceptoConVinculo(): Set<number> {
    const ids = new Set<number>();
    for (const vinculo of this.b5dLinks) {
      if (vinculo.concepto_id != null) {
        ids.add(vinculo.concepto_id);
      }
    }
    for (const vinculo of this.localLinks) {
      if (vinculo.conceptoId != null) {
        ids.add(vinculo.conceptoId);
      }
    }
    return ids;
  }

  private normalizeText(valor: string | null): string {
    return (valor ?? '').trim().toLowerCase();
  }

  private buildObjectRowId(objectType: string, propertyLabel: string): string {
    return `obj-${this.normalizeText(objectType)}-${this.normalizeText(propertyLabel)}`;
  }

  private inferPropertyLabel(unit: string): string {
    const normalizedUnit = this.normalizeText(unit);
    if (normalizedUnit === 'm3') return 'Volumen (Neto)';
    if (normalizedUnit === 'm2') return 'Area de la Superficie';
    if (normalizedUnit === 'm') return 'Longitud';
    return 'Cantidad';
  }

  private inferPropertyLabelFromIfcClass(ifcClass: string): string {
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

  private getMaterialFromProperties(properties: Record<string, unknown>[]): string {
    for (const propertyItem of properties) {
      const material = propertyItem['material'] ?? propertyItem['Material'];
      if (typeof material === 'string' && material.trim()) {
        return material.trim();
      }
    }
    return '';
  }

  private obtenerDescripcionIfcElemento(ifcElement: ElementoIfcB5D): string {
    const preferredDescription =
      ifcElement.elementType?.trim() ||
      ifcElement.name?.trim() ||
      ifcElement.category?.trim() ||
      ifcElement.objectType?.trim();
    return preferredDescription || '';
  }

  private mergeDescriptions(existingDescription: string, incomingDescription: string): string {
    if (!existingDescription) return incomingDescription;
    if (!incomingDescription || existingDescription.includes(incomingDescription)) return existingDescription;
    return `${existingDescription}, ${incomingDescription}`;
  }

  private getLinkedPropertiesByObjectType(): Map<string, Set<string>> {
    const linkedPropertiesByObjectType = new Map<string, Set<string>>();
    const allLinks = [...this.b5dLinks, ...this.localLinks];

    for (const linkItem of allLinks) {
      const objectType =
        'tipo_objeto_bim' in linkItem
          ? this.normalizeText(linkItem.tipo_objeto_bim ?? '')
          : this.normalizeText(linkItem.objectType);
      const property =
        'propiedad_cantidad_bim' in linkItem
          ? (linkItem.propiedad_cantidad_bim ?? '').trim()
          : linkItem.propertyLabel.trim();
      if (!objectType || !property) continue;

      const objectTypeProperties = linkedPropertiesByObjectType.get(objectType) ?? new Set<string>();
      objectTypeProperties.add(property);
      linkedPropertiesByObjectType.set(objectType, objectTypeProperties);
    }

    return linkedPropertiesByObjectType;
  }

  private objetosDesdeVinculosBackend(): ifcObject[] {
    const rowsByObjectTypeAndProperty = new Map<string, ifcObject>();

    for (const linkItem of this.b5dLinks) {
      const objectType = (linkItem.tipo_objeto_bim ?? '').trim();
      const propertyLabel = (linkItem.propiedad_cantidad_bim ?? '').trim();
      if (!objectType || !propertyLabel) continue;

      const rowId = this.buildObjectRowId(objectType, propertyLabel);
      if (rowsByObjectTypeAndProperty.has(rowId)) continue;

      rowsByObjectTypeAndProperty.set(rowId, {
        id: rowId,
        objectType,
        material: (linkItem.material_bim ?? '').trim(),
        description: '',
        ifcName: objectType,
        ifcEntity: '',
        propertyKey: this.normalizeText(propertyLabel),
        propertyLabel,
        properties: [],
      });
    }

    return [...rowsByObjectTypeAndProperty.values()].sort((first, second) => {
      const objectTypeComparison = first.objectType.localeCompare(second.objectType, 'es');
      if (objectTypeComparison !== 0) return objectTypeComparison;
      return first.propertyLabel.localeCompare(second.propertyLabel, 'es');
    });
  }

  private clamp(value: number, minValue: number, maxValue: number): number {
    return Math.min(Math.max(value, minValue), maxValue);
  }

  private get relatedLinksFromSelectedConcepts(): VinculoPanel[] {
    if (!this.selectedConceptIds.size) return [];
    return this.relatedLinks.filter((linkItem) => this.selectedConceptIds.has(linkItem.conceptoId ?? -1));
  }

  private get relatedLinksFromSelectedObjects(): VinculoPanel[] {
    const selectedObjectLinkKeys = this.selectedObjectLinkKeys;
    if (!selectedObjectLinkKeys.size) return [];
    return this.relatedLinks.filter((linkItem) =>
      selectedObjectLinkKeys.has(this.buildLinkKey(linkItem.objectType, linkItem.propertyLabel)),
    );
  }

  private get selectedObjectLinkKeys(): Set<string> {
    return new Set(
      this.objetosIfc
        .filter((objectItem) => this.selectedObjectIds.has(objectItem.id))
        .map((objectItem) => this.buildLinkKey(objectItem.objectType, objectItem.propertyLabel)),
    );
  }

  private get selectedConceptSummaryLabel(): string {
    const selectedConcepts = this.workConcepts.filter((conceptItem) => this.selectedConceptIds.has(conceptItem.id));
    if (!selectedConcepts.length) return '-';
    const labels = selectedConcepts.map((conceptItem) => conceptItem.clave || conceptItem.descripcion || String(conceptItem.id));
    if (labels.length <= 3) return labels.join(', ');
    return `${labels.slice(0, 3).join(', ')} (+${labels.length - 3})`;
  }

  private get selectedObjectSummaryLabel(): string {
    const selectedObjects = this.objetosIfc.filter((objectItem) => this.selectedObjectIds.has(objectItem.id));
    if (!selectedObjects.length) return '-';
    const labels = selectedObjects.map((objectItem) => `${objectItem.objectType}/${objectItem.propertyLabel}`);
    if (labels.length <= 3) return labels.join(', ');
    return `${labels.slice(0, 3).join(', ')} (+${labels.length - 3})`;
  }

  private getEmptyConceptDraft(): ConceptDraft {
    return {
      clave: '',
      descripcion: '',
      unidad: '',
      esAgrupador: false,
    };
  }

  private getPrefilledConceptDraft(selectedConcept: ConceptoB5DOrm | null): ConceptDraft {
    if (!selectedConcept) return this.getEmptyConceptDraft();
    return {
      clave: selectedConcept.clave ?? '',
      descripcion: selectedConcept.descripcion ?? '',
      unidad: selectedConcept.unidad ?? '',
      esAgrupador: !!selectedConcept.es_agrupador,
    };
  }

  // Notifies container components that concepts or links were modified.
  private emitDraftChanged(): void {
    this.draftChanged.emit();
  }
}
