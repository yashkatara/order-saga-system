import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { OrdersService, OrderSummary } from '../services/orders.service';

@Component({
  selector: 'app-order-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="card">
      <div class="header">
        <div>
          <label>Filter by status: </label>
          <select [(ngModel)]="statusFilter" (change)="onFilterChange()">
            <option value="">All</option>
            <option value="QUEUED">Queued</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="PLACED">Placed</option>
            <option value="SHIPPED">Shipped</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="NEEDS_ATTENTION">Needs attention</option>
          </select>
        </div>
        <div>{{ total }} order(s)</div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Order ID</th>
            <th>SKU</th>
            <th>Qty</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let o of orders">
            <td><a [routerLink]="['/orders', o.order_id]">{{ o.order_id }}</a></td>
            <td>{{ o.sku }}</td>
            <td>{{ o.qty }}</td>
            <td>{{ o.amount | number:'1.2-2' }}</td>
            <td><span class="badge" [ngClass]="'badge-' + o.status">{{ o.status }}</span></td>
            <td>{{ o.updated_at | date:'short' }}</td>
          </tr>
          <tr *ngIf="orders.length === 0">
            <td colspan="6">No orders found.</td>
          </tr>
        </tbody>
      </table>

      <div class="pager">
        <button (click)="prevPage()" [disabled]="page === 1">Prev</button>
        <span>Page {{ page }} / {{ totalPages }}</span>
        <button (click)="nextPage()" [disabled]="page >= totalPages">Next</button>
      </div>
    </div>
  `,
})
export class OrderListComponent implements OnInit {
  orders: OrderSummary[] = [];
  page = 1;
  pageSize = 20;
  total = 0;
  statusFilter = '';

  constructor(private ordersService: OrdersService) {}

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.ordersService.list(this.page, this.pageSize, this.statusFilter || undefined).subscribe((res) => {
      this.orders = res.items;
      this.total = res.total;
    });
  }

  onFilterChange(): void {
    this.page = 1;
    this.load();
  }

  nextPage(): void {
    if (this.page < this.totalPages) {
      this.page++;
      this.load();
    }
  }

  prevPage(): void {
    if (this.page > 1) {
      this.page--;
      this.load();
    }
  }
}
