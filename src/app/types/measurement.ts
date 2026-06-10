export type MeasurementMode = 'volume' | 'area' | 'length' | 'weight' | 'angle' | 'count';
export type MeasurementLengthMode = 'edge' | 'points';
export type MeasurementCountMode = 'selected' | 'manual';

export interface MeasurementVolumeSummary {
  totalVolume: number | null;
  selectedCount: number;
}

export interface MeasurementAreaSelection {
  key: string;
  modelId: string;
  localId: number;
  itemId: number;
  label: string;
  area: number;
}

export interface MeasurementAreaSummary {
  totalArea: number | null;
  selectedFaceCount: number;
  selectedObjectCount: number;
  selections: MeasurementAreaSelection[];
}

export interface MeasurementLengthAnchor {
  modelId: string;
  localId: number;
  itemId: number;
  label: string;
  x: number;
  y: number;
  z: number;
}

export interface MeasurementLengthEdge {
  modelId: string;
  localId: number;
  itemId: number;
  label: string;
  start: {
    x: number;
    y: number;
    z: number;
  };
  end: {
    x: number;
    y: number;
    z: number;
  };
}

export interface MeasurementLengthSummary {
  distance: number | null;
  anchorCount: number;
  anchors: MeasurementLengthAnchor[];
}

export interface MeasurementLengthEdgeSummary {
  distance: number | null;
  edge: MeasurementLengthEdge | null;
  isPinned: boolean;
}

export interface MeasurementAngleSummary {
  angle: number | null;
  anchorCount: number;
  anchors: MeasurementLengthAnchor[];
}

export interface MeasurementCountSelection {
  key: string;
  modelId: string;
  localId: number;
  itemId: number;
  label: string;
  count: number;
}

export interface MeasurementCountSummary {
  count: number;
  selections: MeasurementCountSelection[];
}
