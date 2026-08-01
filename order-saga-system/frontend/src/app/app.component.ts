import { Component } from '@angular/core';
import { RouterOutlet, RouterLink } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink],
  template: `
    <div class="container">
      <div class="header">
        <h2><a routerLink="/">Order Processing System</a></h2>
      </div>
      <router-outlet></router-outlet>
    </div>
  `,
})
export class AppComponent {}
