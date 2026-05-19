import { ComponentFixture, TestBed } from '@angular/core/testing';

import { QuantificationPanel } from './quantification-panel';

describe('QuantificationPanel', () => {
  let component: QuantificationPanel;
  let fixture: ComponentFixture<QuantificationPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QuantificationPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(QuantificationPanel);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
