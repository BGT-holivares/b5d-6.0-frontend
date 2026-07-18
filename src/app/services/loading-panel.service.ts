import { Injectable, signal } from '@angular/core';
import type { LoadingPanelPlan, LoadingPanelState, LoadingPanelStepState } from '../types/loading-panel';

const INITIAL_LOADING_PANEL_STATE: LoadingPanelState = {
  visible: false,
  title: '',
  subtitle: '',
  sessionId: 0,
  overallProgress: 0,
  stepProgress: 0,
};

@Injectable({ providedIn: 'root' })
export class LoadingPanelService {
  readonly state = signal<LoadingPanelState>({ ...INITIAL_LOADING_PANEL_STATE });

  private currentSessionId = 0;
  private steps: LoadingPanelStepState[] = [];

  start(plan: LoadingPanelPlan, subtitle = ''): number {
    const sessionId = ++this.currentSessionId;
    this.steps = this.normalizePlanSteps(plan.steps);

    this.state.set({
      visible: true,
      title: plan.title,
      subtitle,
      sessionId,
      overallProgress: 0,
      stepProgress: 0,
    });

    return sessionId;
  }

  setStepProgress(sessionId: number, stepId: string, progress: number, subtitle?: string): void {
    if (!this.isActiveSession(sessionId)) return;

    this.state.update((state) => {
      this.steps = this.steps.map((step) =>
        step.id === stepId ? { ...step, progress: this.clamp(progress, 0, 100) } : step,
      );
      return this.recalculateState(state, subtitle);
    });
  }

  completeStep(sessionId: number, stepId: string, subtitle?: string): void {
    this.setStepProgress(sessionId, stepId, 100, subtitle);
  }

  complete(sessionId: number, subtitle = ''): void {
    if (!this.isActiveSession(sessionId)) return;

    this.state.update((state) => ({
      ...state,
      visible: false,
      subtitle,
      overallProgress: 0,
      stepProgress: 0,
    }));
    this.steps = [];
  }

  abort(sessionId: number): void {
    if (!this.isActiveSession(sessionId)) return;

    this.state.update((state) => ({
      ...state,
      visible: false,
      subtitle: '',
      overallProgress: 0,
      stepProgress: 0,
    }));
    this.steps = [];
  }

  private isActiveSession(sessionId: number): boolean {
    return sessionId > 0 && sessionId === this.currentSessionId;
  }

  private normalizePlanSteps(steps: LoadingPanelPlan['steps']): LoadingPanelStepState[] {
    return steps.map((step) => ({
      id: step.id,
      weight: Math.max(step.weight, 0),
      progress: 0,
    }));
  }

  private recalculateState(state: LoadingPanelState, subtitle?: string): LoadingPanelState {
    const steps = this.steps;
    const totalWeight = steps.reduce((sum, step) => sum + step.weight, 0) || 1;
    let completedWeight = 0;
    const activeIndex = Math.max(0, steps.findIndex((step) => step.progress < 100));

    for (const step of steps) {
      const boundedProgress = this.clamp(step.progress, 0, 100);
      completedWeight += (step.weight * boundedProgress) / 100;
    }

    const activeStep = steps[activeIndex] ?? null;
    return {
      ...state,
      visible: true,
      subtitle: subtitle ?? state.subtitle,
      overallProgress: this.clamp((completedWeight / totalWeight) * 100, 0, 100),
      stepProgress: activeStep ? this.clamp(activeStep.progress, 0, 100) : 0,
    };
  }

  private clamp(value: number, minValue: number, maxValue: number): number {
    return Math.min(Math.max(value, minValue), maxValue);
  }
}
