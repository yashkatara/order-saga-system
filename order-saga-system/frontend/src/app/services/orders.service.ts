import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface OrderSummary {
  order_id: string;
  sku: string;
  qty: number;
  amount: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface OrderStep {
  step_name: string;
  action: 'DO' | 'UNDO';
  status: string;
  attempt_count: number;
  last_error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface OrderListResponse {
  items: OrderSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OrderDetailResponse {
  order: OrderSummary;
  steps: OrderStep[];
}

// Base URL is read at build/runtime from window location convention:
// during local dev the coordinator runs on :4000; adjust via environment
// if deploying behind a different host.
const API_BASE = (window as any).__COORDINATOR_API__ || 'http://localhost:4000';

@Injectable({ providedIn: 'root' })
export class OrdersService {
  constructor(private http: HttpClient) {}

  list(page: number, pageSize: number, status?: string): Observable<OrderListResponse> {
    let url = `${API_BASE}/api/orders?page=${page}&pageSize=${pageSize}`;
    if (status) url += `&status=${status}`;
    return this.http.get<OrderListResponse>(url);
  }

  get(orderId: string): Observable<OrderDetailResponse> {
    return this.http.get<OrderDetailResponse>(`${API_BASE}/api/orders/${orderId}`);
  }

  retryUndo(orderId: string): Observable<{ orderId: string; status: string }> {
    return this.http.post<{ orderId: string; status: string }>(
      `${API_BASE}/api/orders/${orderId}/retry-undo`,
      {}
    );
  }

  markShipped(orderId: string): Observable<{ orderId: string; status: string }> {
    return this.http.post<{ orderId: string; status: string }>(
      `${API_BASE}/api/orders/${orderId}/mark-shipped`,
      {}
    );
  }
}
