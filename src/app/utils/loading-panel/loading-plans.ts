import type { LoadingPanelPlan } from '../../types/loading-panel';

export function createIfcLoadingPlan(title: string): LoadingPanelPlan {
  return {
    title,
    steps: [
      { id: 'reading', weight: 20 },
      { id: 'preparing', weight: 15 },
      { id: 'processing', weight: 35 },
      { id: 'drawing', weight: 30 },
    ],
  };
}

export function createB5dImportPlan(title: string): LoadingPanelPlan {
  return {
    title,
    steps: [
      { id: 'uploading', weight: 20 },
      { id: 'processing', weight: 55 },
      { id: 'refreshing', weight: 25 },
    ],
  };
}

export function createB5dExportPlan(title: string): LoadingPanelPlan {
  return {
    title,
    steps: [
      { id: 'preparing', weight: 35 },
      { id: 'downloading', weight: 40 },
      { id: 'refreshing', weight: 25 },
    ],
  };
}

export function createWorkbookUploadPlan(title: string): LoadingPanelPlan {
  return {
    title,
    steps: [
      { id: 'uploading', weight: 45 },
      { id: 'parsing', weight: 55 },
    ],
  };
}

export function createWorkbookSavePlan(title: string): LoadingPanelPlan {
  return {
    title,
    steps: [
      { id: 'saving', weight: 70 },
      { id: 'refreshing', weight: 30 },
    ],
  };
}

export function createParameterImportPlan(title: string): LoadingPanelPlan {
  return {
    title,
    steps: [
      { id: 'loading', weight: 25 },
      { id: 'analyzing', weight: 20 },
      { id: 'importing', weight: 55 },
    ],
  };
}

export function createCatalogImportPlan(title: string): LoadingPanelPlan {
  return {
    title,
    steps: [
      { id: 'preparing', weight: 20 },
      { id: 'processing', weight: 65 },
      { id: 'refreshing', weight: 15 },
    ],
  };
}
