import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BoqPanel } from './boq-panel';

describe('BoqPanel', () => {
  let component: BoqPanel;
  let fixture: ComponentFixture<BoqPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BoqPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(BoqPanel);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
