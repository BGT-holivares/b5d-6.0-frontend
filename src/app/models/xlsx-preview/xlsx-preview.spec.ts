import { ComponentFixture, TestBed } from '@angular/core/testing';

import { XlsxPreview } from './xlsx-preview';

describe('XlsxPreview', () => {
  let component: XlsxPreview;
  let fixture: ComponentFixture<XlsxPreview>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [XlsxPreview],
    }).compileComponents();

    fixture = TestBed.createComponent(XlsxPreview);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
