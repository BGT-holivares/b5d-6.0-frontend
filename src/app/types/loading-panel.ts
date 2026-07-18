export interface LoadingPanelStepDefinition {
  id: string;
  weight: number;
}

export interface LoadingPanelPlan {
  title: string;
  steps: LoadingPanelStepDefinition[];
}

export interface LoadingPanelStepState extends LoadingPanelStepDefinition {
  progress: number;
}

export interface LoadingPanelState {
  visible: boolean;
  title: string;
  subtitle: string;
  sessionId: number;
  overallProgress: number;
  stepProgress: number;
}
