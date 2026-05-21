import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ModelVisibilityPanel } from './model-visibility-panel';

describe('ModelVisibilityPanel', () => {
  let component: ModelVisibilityPanel;
  let fixture: ComponentFixture<ModelVisibilityPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ModelVisibilityPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(ModelVisibilityPanel);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();

  });
});
