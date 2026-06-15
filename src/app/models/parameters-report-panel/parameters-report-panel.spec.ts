import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ParametersReportPanel } from './parameters-report-panel';

describe('ParametersReportPanel', () => {
  let component: ParametersReportPanel;
  let fixture: ComponentFixture<ParametersReportPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ParametersReportPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(ParametersReportPanel);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
