import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LoginScreen } from './login-screen';

describe('LoginScreen', () => {
  let component: LoginScreen;
  let fixture: ComponentFixture<LoginScreen>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginScreen],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginScreen);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
