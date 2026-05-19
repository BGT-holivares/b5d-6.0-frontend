import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LinkingPanel } from './linking-panel';

describe('LinkingPanel', () => {
  let component: LinkingPanel;
  let fixture: ComponentFixture<LinkingPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LinkingPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(LinkingPanel);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
