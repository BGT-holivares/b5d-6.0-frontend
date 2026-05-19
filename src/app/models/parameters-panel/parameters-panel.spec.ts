import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ParametersPanel } from './parameters-panel';

describe('ParametersPanel', () => {
  let component: ParametersPanel;
  let fixture: ComponentFixture<ParametersPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ParametersPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(ParametersPanel);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
