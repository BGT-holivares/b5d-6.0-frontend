import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ViewerScreen } from './viewer-screen';

describe('ViewerScreen', () => {
  let component: ViewerScreen;
  let fixture: ComponentFixture<ViewerScreen>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ViewerScreen],
    }).compileComponents();

    fixture = TestBed.createComponent(ViewerScreen);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
