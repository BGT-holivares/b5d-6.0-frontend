import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TreePanel } from './tree-panel';

describe('TreePanel', () => {
  let component: TreePanel;
  let fixture: ComponentFixture<TreePanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TreePanel],
    }).compileComponents();

    fixture = TestBed.createComponent(TreePanel);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
