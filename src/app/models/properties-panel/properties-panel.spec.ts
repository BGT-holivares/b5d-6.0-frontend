import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PropertiesPanel } from './properties-panel';

describe('PropertiesPanel', () => {
  let component: PropertiesPanel;
  let fixture: ComponentFixture<PropertiesPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PropertiesPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(PropertiesPanel);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
