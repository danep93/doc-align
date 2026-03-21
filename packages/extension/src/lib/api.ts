import { getIdToken } from './auth';

const API_BASE = 'http://localhost:8080/api';

export function buildUrl(base: string, path: string): string {
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${cleanBase}${path}`;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getIdToken();
  if (!token) throw new Error('Not authenticated');

  const url = buildUrl(API_BASE, path);
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

export const api = {
  getUser: () => request('/users/me'),
  getSignatures: () => request('/signatures'),
  createSignature: (data: object) =>
    request('/signatures', { method: 'POST', body: JSON.stringify(data) }),
  retireSignature: (id: string) =>
    request(`/signatures/${id}/retire`, { method: 'POST' }),
  getSignOffs: () => request('/signoffs'),
  getDocuments: () => request('/signoffs/documents'),
  createSignOff: (data: object) =>
    request('/signoffs', { method: 'POST', body: JSON.stringify(data) }),
  getCoSigners: (docId: string, revId: string) =>
    request(`/signoffs/co-signers/${docId}/${revId}`),
  createCheckout: (plan: string) =>
    request('/subscriptions/checkout', { method: 'POST', body: JSON.stringify({ plan }) }),
};
