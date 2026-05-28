import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '../../utils/i18n/i18n.service';
import { ThemeService } from '../../utils/theme.service';
import { FloatFileTab } from '../float-file-tab/float-file-tab';
import type { FloatingPanelId } from '../../types/floating-panel';
import type { ProyectoTrabajoOrm, UsuarioSesionOrm } from '../../types/b5d-orm';
import type { HomeToolbarState } from '../../types/home-toolbar';
import { TOOLBAR_TRANSLATIONS } from './toolbar.translations';

type ToolbarTab = 'home' | 'objects' | 'measurement' | 'tools' | 'view' | 'about';
type ToolbarButtonVariant = 'small' | 'large' | 'small-dropdown' | 'large-dropdown';
type ToolbarCategoryLayout = 'vertical' | 'horizontal' | 'grid';

export type ToolbarActionId =
  | 'home-add-item'
  | 'home-remove-item'
  | 'home-select-all'
  | 'home-cut'
  | 'home-copy'
  | 'home-paste'
  | 'home-select-filter'
  | 'home-object-info'
  | 'home-links-view'
  | 'home-assign-property'
  | 'home-unlinked-objects'
  | 'import-b5d-project'
  | 'export-b5d-project'
  | 'refresh-b5d-project'
  | 'zoom-in'
  | 'zoom-out'
  | 'reset-view'
  | 'rotate-left'
  | 'rotate-right'
  | 'clear-selection'
  | 'expand-tree'
  | 'collapse-tree'
  | 'quantify-b5d'
  | 'toggle-theme'
  | 'show-all-objects'
  | 'show-selected-objects'
  | 'transparent-selected-objects'
  | 'hide-selected-objects'
  | 'show-not-selected-objects'
  | 'transparent-not-selected-objects'
  | 'hide-not-selected-objects'
  | 'view-3d'
  | 'view-2d'
  | 'focus-selection'
  | 'view-default'
  | 'view-front'
  | 'view-back'
  | 'view-up'
  | 'view-right'
  | 'view-left'
  | 'movement-axis-x'
  | 'movement-axis-y'
  | 'movement-axis-z'
  | 'restore-selected-movement'
  | 'restore-all-movement';

type ToolbarButton = {
  label?: string;
  labelKey?: string;
  iconText?: string;
  iconSrc?: string;
  action?: ToolbarActionId;
  panelId?: FloatingPanelId;
  variant: ToolbarButtonVariant;
  selected?: boolean;
  disabled?: boolean;
};

type ToolbarCategory = {
  label?: string;
  labelKey?: string;
  layout: ToolbarCategoryLayout;
  buttons: ToolbarButton[];
};

@Component({
  selector: 'app-toolbar',
  imports: [CommonModule, FloatFileTab],
  templateUrl: './toolbar.html',
  styleUrl: './toolbar.scss',
})
export class Toolbar {
  fileTabVisible = false;
  activeTab: ToolbarTab = 'home';

  readonly toolbarTabs: { id: ToolbarTab; labelKey: string }[] = [
    { id: 'home', labelKey: 'toolbar.home' },
    { id: 'objects', labelKey: 'toolbar.objects' },
    { id: 'measurement', labelKey: 'toolbar.measurement' },
    { id: 'tools', labelKey: 'toolbar.tools' },
    { id: 'view', labelKey: 'toolbar.view' },
    { id: 'about', labelKey: 'toolbar.about' },
  ];
  readonly floatingPanelOptions: { id: FloatingPanelId; icon: string; labelKey: string }[] = [
    { id: 'tree', icon: 'T', labelKey: 'toolbar.view.IFCStructure' },
    { id: 'models', icon: 'M', labelKey: 'toolbar.view.models' },
    { id: 'properties', icon: 'P', labelKey: 'toolbar.view.properties' },
    { id: 'bottom', icon: 'B', labelKey: 'toolbar.view.B5D' },
  ];

  readonly i18n = inject(I18nService);
  readonly visualTheme = inject(ThemeService);
  readonly toolbarTranslations = TOOLBAR_TRANSLATIONS;

  @Input() cargando = false;
  @Input() toolbarContentVisible = true;
  @Input() usuarioSesion: UsuarioSesionOrm | null = null;
  @Input() activeProject: ProyectoTrabajoOrm | null = null;
  @Input() floatingPanelVisibility: Record<FloatingPanelId, boolean> = {
    tree: true,
    models: true,
    properties: true,
    bottom: true,
  };
  @Input() homeToolbarState: HomeToolbarState = {
    activePanel: 'concepts',
    linksViewVisible: true,
    conceptsTotal: 0,
    objectsTotal: 0,
    linksTotal: 0,
    selectedConceptIds: [],
    selectedNonGroupingConceptIds: [],
    selectedObjectIds: [],
    selectedLinkIds: [],
    canPasteConcept: false,
  };

  @Output() archivoSeleccionado = new EventEmitter<File>();
  @Output() abrirB5dSolicitado = new EventEmitter<void>();
  @Output() guardarB5dSolicitado = new EventEmitter<void>();
  @Output() loginSolicitado = new EventEmitter<void>();
  @Output() logoutSolicitado = new EventEmitter<void>();
  @Output() toolbarAction = new EventEmitter<ToolbarActionId>();
  @Output() toggleFloatingPanel = new EventEmitter<FloatingPanelId>();
  @Output() toolbarContentVisibleChange = new EventEmitter<boolean>();

  // Shows or hides the floating File panel.
  toggleFileTab(): void {
    this.fileTabVisible = !this.fileTabVisible;
  }

  // Changes the active ribbon tab.
  updateTab(tab: ToolbarTab): void {
    this.activeTab = tab;
    this.fileTabVisible = false;
  }

  // Emits the requested toolbar action or handles local toolbar actions.
  runToolbarAction(button: ToolbarButton): void {
    if (button.disabled) return;

    if (button.panelId) {
      this.toggleFloatingPanel.emit(button.panelId);
      return;
    }

    if (!button.action) return;

    if (button.action === 'toggle-theme') {
      this.visualTheme.alternarTema();
      return;
    }

    this.toolbarAction.emit(button.action);
  }

  // Shows or hides the ribbon command area while keeping tabs visible.
  toggleToolbarContent(): void {
    this.toolbarContentVisibleChange.emit(!this.toolbarContentVisible);
  }

  // Returns the CSS classes for toolbar button variants.
  getButtonClass(button: ToolbarButton): string {
    const sizeClass = button.variant.includes('small') ? 'b5d-toolbar-action-small' : 'b5d-toolbar-action-large';
    const dropdownClass = button.variant.includes('dropdown') ? `${sizeClass}--dropdown` : '';

    return `b5d-toolbar-action ${sizeClass} ${dropdownClass}`.trim();
  }

  // Returns the active tab categories declared by this component.
  getActiveCategories(): ToolbarCategory[] {
    if (this.activeTab === 'home') return this.homeCategories;
    if (this.activeTab === 'objects') return this.objectCategories;
    if (this.activeTab === 'measurement') return this.measurementCategories;
    if (this.activeTab === 'tools') return this.toolCategories;
    if (this.activeTab === 'view') return this.viewCategories;
    return [];
  }

  // Returns a translation or literal label for descriptor rendering.
  getLabel(item: { label?: string; labelKey?: string }): string {
    if (item.labelKey) return this.i18n.translateForComponent(this.toolbarTranslations, item.labelKey);
    return item.label ?? '';
  }

  // Returns the layout class for a toolbar category.
  getCategoryButtonsClass(category: ToolbarCategory): string {
    if (category.layout === 'vertical') return 'b5d-tab-category-buttons-vertical';
    if (category.layout === 'grid') return 'b5d-toolbar-action-grid';
    return 'b5d-tab-category-buttons-horizontal';
  }

  // Returns the active visibility state for a floating panel option.
  isFloatingPanelVisible(panelId: FloatingPanelId): boolean {
    return this.floatingPanelVisibility[panelId];
  }

  private get homeCategories(): ToolbarCategory[] {
    return [
      {
        labelKey: 'toolbar.home.category.edit',
        layout: 'vertical',
        buttons: [
          {
            labelKey: 'toolbar.home.add',
            iconSrc: 'assets/images/Add_32x32.png',
            action: 'home-add-item',
            disabled: this.isHomeActionDisabled('home-add-item'),
            variant: 'small-dropdown',
          },
          {
            labelKey: 'toolbar.home.remove',
            iconSrc: 'assets/images/Remove_32x32.png',
            action: 'home-remove-item',
            disabled: this.isHomeActionDisabled('home-remove-item'),
            variant: 'small',
          },
          {
            labelKey: 'toolbar.home.selectAll',
            iconSrc: 'assets/images/SelectAll_32x32.png',
            action: 'home-select-all',
            disabled: this.isHomeActionDisabled('home-select-all'),
            variant: 'small',
          },
          {
            labelKey: 'toolbar.home.cut',
            iconSrc: 'assets/images/Cut_32x32.png',
            action: 'home-cut',
            disabled: this.isHomeActionDisabled('home-cut'),
            variant: 'small',
          },
          {
            labelKey: 'toolbar.home.copy',
            iconSrc: 'assets/images/Copy_32x32.png',
            action: 'home-copy',
            disabled: this.isHomeActionDisabled('home-copy'),
            variant: 'small',
          },
          {
            labelKey: 'toolbar.home.paste',
            iconSrc: 'assets/images/Paste_32x32.png',
            action: 'home-paste',
            disabled: this.isHomeActionDisabled('home-paste'),
            variant: 'small',
          },
        ],
      },
      {
        labelKey: 'toolbar.home.category.model',
        layout: 'horizontal',
        buttons: [
          {
            labelKey: 'toolbar.home.selectFilter',
            iconSrc: 'assets/images/SeleccFiltro_32x32.png',
            action: 'home-select-filter',
            disabled: this.isHomeActionDisabled('home-select-filter'),
            variant: 'large-dropdown',
          },
          {
            labelKey: 'toolbar.home.objInfo',
            iconSrc: 'assets/images/ObjPanelInfo_32x32.png',
            action: 'home-object-info',
            disabled: this.isHomeActionDisabled('home-object-info'),
            variant: 'large',
          },
          {
            labelKey: 'toolbar.home.linksView',
            iconSrc: 'assets/images/LinksView_32x32.png',
            action: 'home-links-view',
            disabled: this.isHomeActionDisabled('home-links-view'),
            selected: this.homeToolbarState.linksViewVisible,
            variant: 'large',
          },
          {
            labelKey: 'toolbar.home.asignPorpt',
            iconSrc: 'assets/images/Paste_32x32.png',
            action: 'home-assign-property',
            disabled: this.isHomeActionDisabled('home-assign-property'),
            variant: 'large',
          },
          {
            labelKey: 'toolbar.home.unlinkedObjs',
            iconSrc: 'assets/images/ObjWoLink_32x32.png',
            action: 'home-unlinked-objects',
            disabled: this.isHomeActionDisabled('home-unlinked-objects'),
            variant: 'large-dropdown',
          },
        ],
      },
    ];
  }

  private isHomeActionDisabled(actionId: ToolbarActionId): boolean {
    const state = this.homeToolbarState;
    const hasConceptSelection = state.selectedConceptIds.length > 0;
    const hasObjectSelection = state.selectedObjectIds.length > 0;
    const hasLinkSelection = state.selectedLinkIds.length > 0;
    const isConceptPanel = state.activePanel === 'concepts';
    const isIfcObjectsPanel = state.activePanel === 'ifc-objects';
    const isRelatedLinksPanel = state.activePanel === 'related-links';

    if (actionId === 'home-add-item') return !isConceptPanel;

    if (actionId === 'home-remove-item') {
      if (isConceptPanel) return !hasConceptSelection;
      if (isIfcObjectsPanel || isRelatedLinksPanel) return !(hasObjectSelection || hasLinkSelection);
      return true;
    }

    if (actionId === 'home-select-all') {
      if (isConceptPanel) return state.conceptsTotal === 0;
      if (isIfcObjectsPanel) return state.objectsTotal === 0;
      return state.linksTotal === 0;
    }

    if (actionId === 'home-cut' || actionId === 'home-copy') {
      return !isConceptPanel || !hasConceptSelection;
    }

    if (actionId === 'home-paste') {
      return !isConceptPanel || !state.canPasteConcept;
    }

    if (actionId === 'home-select-filter' || actionId === 'home-unlinked-objects') {
      return state.objectsTotal === 0;
    }

    if (actionId === 'home-object-info') return true;
    if (actionId === 'home-links-view') return false;

    if (actionId === 'home-assign-property') {
      return state.selectedNonGroupingConceptIds.length === 0 || !hasObjectSelection;
    }

    return false;
  }

  private get objectCategories(): ToolbarCategory[] {
    return [
      {
        labelKey: 'toolbar.objects.category.objects',
        layout: 'horizontal',
        buttons: [
          { labelKey: 'toolbar.objects.showAll', action: 'show-all-objects', iconSrc: 'assets/images/Add_32x32.png', variant: 'large' },
          { labelKey: 'toolbar.objects.restoreZoom', action: 'reset-view', iconSrc: 'assets/images/Add_32x32.png', variant: 'large' },
          { labelKey: 'toolbar.objects.regenGeom', iconSrc: 'assets/images/Add_32x32.png', variant: 'large' },
        ],
      },
      {
        labelKey: 'toolbar.objects.category.selected',
        layout: 'horizontal',
        buttons: [
          { labelKey: 'toolbar.objects.sShow', action: 'show-selected-objects', iconSrc: 'assets/images/Add_32x32.png', variant: 'large' },
          { labelKey: 'toolbar.objects.sTransparent', action: 'transparent-selected-objects', iconSrc: 'assets/images/Add_32x32.png', variant: 'large' },
          { labelKey: 'toolbar.objects.sHide', action: 'hide-selected-objects', iconSrc: 'assets/images/Add_32x32.png', variant: 'large' },
        ],
      },
      {
        labelKey: 'toolbar.objects.category.notSelected',
        layout: 'horizontal',
        buttons: [
          { labelKey: 'toolbar.objects.nsShow', action: 'show-not-selected-objects', iconSrc: 'assets/images/Add_32x32.png', variant: 'large' },
          { labelKey: 'toolbar.objects.nsTransparent', action: 'transparent-not-selected-objects', iconSrc: 'assets/images/Add_32x32.png', variant: 'large' },
          { labelKey: 'toolbar.objects.nsHide', action: 'hide-not-selected-objects', iconSrc: 'assets/images/Add_32x32.png', variant: 'large' },
        ],
      },
    ];
  }

  private get measurementCategories(): ToolbarCategory[] {
    return [
      {
        labelKey: 'toolbar.measurement.category.mode',
        layout: 'horizontal',
        buttons: [
          { labelKey: 'toolbar.measurement.volume', iconSrc: 'assets/images/Add_32x32.png', variant: 'large-dropdown' },
          { labelKey: 'toolbar.measurement.area', iconSrc: 'assets/images/Add_32x32.png', variant: 'large-dropdown' },
          { labelKey: 'toolbar.measurement.lenght', iconSrc: 'assets/images/Add_32x32.png', variant: 'large-dropdown' },
          { labelKey: 'toolbar.measurement.weight', iconSrc: 'assets/images/Add_32x32.png', variant: 'large-dropdown' },
          { labelKey: 'toolbar.measurement.angle', iconSrc: 'assets/images/Add_32x32.png', variant: 'large-dropdown' },
          { labelKey: 'toolbar.measurement.count', iconSrc: 'assets/images/Add_32x32.png', variant: 'large-dropdown' },
        ],
      },
    ]
  }

  private get toolCategories(): ToolbarCategory[] {
    return [
      {
        labelKey: 'toolbar.tools.category.conceptEstructure',
        layout: 'horizontal',
        buttons: [
          { labelKey: 'toolbar.tools.importExcel', iconSrc: 'assets/images/ImportExcel_32x32.png', variant: 'large-dropdown' },
          { labelKey: 'toolbar.tools.importB5D', iconSrc: 'assets/images/Add_32x32.png', action: 'import-b5d-project', variant: 'large' },
          { labelKey: 'toolbar.tools.importAXA', iconSrc: 'assets/images/ImportAXA_32x32.png', variant: 'large' },
          { labelKey: 'toolbar.tools.cloneDB', iconSrc: 'assets/images/CloneDB_32x32.png', variant: 'large' },
          { labelKey: 'toolbar.tools.objLinks', iconSrc: 'assets/images/CopyLinks_32x32.png', action: 'refresh-b5d-project', variant: 'large-dropdown' },
        ],
      },
      {
        labelKey: 'toolbar.tools.category.qto',
        layout: 'horizontal',
        buttons: [
          { labelKey: 'toolbar.tools.exportExcel', iconSrc: 'assets/images/ExportExcel_32x32.png', variant: 'large' },
          { labelKey: 'toolbar.tools.exportDB', iconSrc: 'assets/images/ExportDB_32x32.png', action: 'export-b5d-project', variant: 'large' },
          { labelKey: 'toolbar.tools.copyAXA', iconSrc: 'assets/images/CopyAXA_32x32.png', variant: 'large' },
          { labelKey: 'toolbar.tools.getImages', iconSrc: 'assets/images/SnapShoots_32x32.png', variant: 'large-dropdown' },
          { labelKey: 'toolbar.tools.QTOScheme', iconSrc: 'assets/images/ExcelTemplate_32x32.png', variant: 'large-dropdown' },
        ],
      },
      {
        labelKey: 'toolbar.tools.category.parameters',
        layout: 'horizontal',
        buttons: [
          { labelKey: 'toolbar.placeholder', iconSrc: 'assets/images/Add_32x32.png', variant: 'large' },
        ],
      },
      {
        labelKey: 'toolbar.tools.category.options',
        layout: 'horizontal',
        buttons: [
          { labelKey: 'toolbar.tools.options', iconSrc: 'assets/images/Options_32x32.png', variant: 'large' },
        ],
      },
      {
        labelKey: 'toolbar.tools',
        layout: 'horizontal',
        buttons: [{ labelKey: 'toolbar.tools.quantify', iconText: '5D', action: 'quantify-b5d', variant: 'large' }],
      },
    ];
  }

  private get viewCategories(): ToolbarCategory[] {
    return [
      {
        labelKey: 'toolbar.view.category.type',
        layout: 'horizontal',
        buttons: [
          { labelKey: 'toolbar.view.3D', action: 'view-3d', iconSrc: 'assets/images/3D_32x32.png', variant: 'large' },
          { labelKey: 'toolbar.view.2D', action: 'view-2d', iconSrc: 'assets/images/Add_32x32.png', variant: 'large' },
        ],
      },
      {
        labelKey: 'toolbar.view.category.camera',
        layout: 'horizontal',
        buttons: [
          { labelKey: 'toolbar.view.restoreZoom', action: 'reset-view', iconSrc: 'assets/images/Add_32x32.png', variant: 'large' },
          { labelKey: 'toolbar.view.focus', action: 'focus-selection', iconSrc: 'assets/images/Add_32x32.png', variant: 'large' },
        ],
      },
      {
        labelKey: 'toolbar.view.category.view',
        layout: 'vertical',
        buttons: [
          { labelKey: 'toolbar.view.default', action: 'view-default', iconSrc: 'assets/images/Add_32x32.png', variant: 'small' },
          { labelKey: 'toolbar.view.front', action: 'view-front', iconSrc: 'assets/images/Add_32x32.png', variant: 'small' },
          { labelKey: 'toolbar.view.back', action: 'view-back', iconSrc: 'assets/images/Add_32x32.png', variant: 'small' },
          { labelKey: 'toolbar.view.up', action: 'view-up', iconSrc: 'assets/images/Add_32x32.png', variant: 'small' },
          { labelKey: 'toolbar.view.right', action: 'view-right', iconSrc: 'assets/images/Add_32x32.png', variant: 'small' },
          { labelKey: 'toolbar.view.left', action: 'view-left', iconSrc: 'assets/images/Add_32x32.png', variant: 'small' },
          { labelKey: 'toolbar.view.rotateLeft', action: 'rotate-left', iconSrc: 'assets/images/Add_32x32.png', variant: 'small' },
          { labelKey: 'toolbar.view.rotateRight', action: 'rotate-right', iconSrc: 'assets/images/Add_32x32.png', variant: 'small' },
        ],
      },
      {
        labelKey: 'toolbar.view.category.movements',
        layout: 'vertical',
        buttons: [
          { labelKey: 'toolbar.view.xAxis', action: 'movement-axis-x', iconSrc: 'assets/images/Add_32x32.png', variant: 'small' },
          { labelKey: 'toolbar.view.yAxis', action: 'movement-axis-y', iconSrc: 'assets/images/Add_32x32.png', variant: 'small' },
          { labelKey: 'toolbar.view.zAxis', action: 'movement-axis-z', iconSrc: 'assets/images/Add_32x32.png', variant: 'small' },
          { labelKey: 'toolbar.view.cleanSelected', action: 'restore-selected-movement', iconSrc: 'assets/images/Add_32x32.png', variant: 'small' },
          { labelKey: 'toolbar.view.cleanAll', action: 'restore-all-movement', iconSrc: 'assets/images/Add_32x32.png', variant: 'small' },
        ],
      },
      {
        labelKey: 'toolbar.view.category.window',
        layout: 'vertical',
        buttons: this.floatingPanelOptions.map((panel) => ({
          labelKey: panel.labelKey,
          iconText: panel.icon,
          panelId: panel.id,
          selected: this.isFloatingPanelVisible(panel.id),
          variant: 'small',
        })),
      },
    ];
  }
}
