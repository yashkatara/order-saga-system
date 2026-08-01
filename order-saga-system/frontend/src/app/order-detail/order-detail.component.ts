import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { OrderDetailResponse, OrdersService } from '../services/orders.service';

@Component({
  selector: 'app-order-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <a routerLink="/">&larr; Back to orders</a>

    <div class="card" style="margin-top: 12px" *ngIf="data as d">
      <div class="header">
        <h3>Order {{ d.order.order_id }}</h3>
        <span class="badge" [ngClass]="'badge-' + d.order.status">{{ d.order.status }}</span>
      </div>

      <p>
        SKU: <b>{{ d.order.sku }}</b> &nbsp; Qty: <b>{{ d.order.qty }}</b> &nbsp;
        Amount: <b>{{ d.order.amount | number:'1.2-2' }}</b>
      </p>

      <div style="margin: 16px 0">
        <button
          class="btn-warn"
          *ngIf="d.order.status === 'NEEDS_ATTENTION'"
          (click)="retryUndo()">
          Retry undo
        </button>
        <button
          class="btn-primary"
          *ngIf="d.order.status === 'PLACED'"
          (click)="markShipped()">
          Mark Shipped
        </button>
      </div>

      <h4>Steps (do)</h4>
      <table>
        <thead><tr><th>Step</th><th>Status</th><th>Attempts</th><th>Finished</th><th>Error</th></tr></thead>
        <tbody>
          <tr *ngFor="let s of doSteps(d)">
            <td>{{ s.step_name }}</td>
            <td><span class="badge" [ngClass]="'badge-' + statusColor(s.status)">{{ s.status }}</span></td>
            <td>{{ s.attempt_count }}</td>
            <td>{{ s.finished_at | date:'short' }}</td>
            <td>{{ s.last_error }}</td>
          </tr>
        </tbody>
      </table>

      <div *ngIf="undoSteps(d).length">
        <h4>Undo (compensation) steps</h4>
        <table>
          <thead><tr><th>Step</th><th>Status</th><th>Attempts</th><th>Finished</th><th>Error</th></tr></thead>
          <tbody>
            <tr *ngFor="let s of undoSteps(d)">
              <td>{{ s.step_name }}</td>
              <td><span class="badge" [ngClass]="'badge-' + statusColor(s.status)">{{ s.status }}</span></td>
              <td>{{ s.attempt_count }}</td>
              <td>{{ s.finished_at | date:'short' }}</td>
              <td>{{ s.last_error }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class OrderDetailComponent implements OnInit {
  data: OrderDetailResponse | null = null;
  orderId = '';

  constructor(private route: ActivatedRoute, private ordersService: OrdersService) {}

  ngOnInit(): void {
    this.orderId = this.route.snapshot.paramMap.get('id')!;
    this.load();
  }

  load(): void {
    this.ordersService.get(this.orderId).subscribe((res) => (this.data = res));
  }

  doSteps(d: OrderDetailResponse) {
    return d.steps.filter((s) => s.action === 'DO');
  }

  undoSteps(d: OrderDetailResponse) {
    return d.steps.filter((s) => s.action === 'UNDO');
  }

  statusColor(status: string): string {
    if (status === 'SUCCESS') return 'PLACED';
    if (status === 'FAILED') return 'CANCELLED';
    return 'IN_PROGRESS';
  }

  retryUndo(): void {
    this.ordersService.retryUndo(this.orderId).subscribe(() => this.load());
  }

  markShipped(): void {
    this.ordersService.markShipped(this.orderId).subscribe(() => this.load());
  }
}
