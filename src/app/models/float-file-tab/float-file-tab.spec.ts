import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FloatFileTab } from './float-file-tab';

describe('FloatFileTab', () => {
  let component: FloatFileTab;
  let fixture: ComponentFixture<FloatFileTab>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FloatFileTab],
    }).compileComponents();

    fixture = TestBed.createComponent(FloatFileTab);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
