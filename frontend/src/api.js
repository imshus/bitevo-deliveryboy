// Every call to the delivery API. In development Vite forwards /api to port 4002; a build served by the
// API itself uses the same address. Set VITE_API_URL when the API lives on another domain.
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

let onSignedOut = () => {};
// Called when a request finds the session gone (signed out on the panel, account suspended, expired).
export const setSignedOutHandler = fn => { onSignedOut = fn; };

async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'No internet connection. Check your network and try again.');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) onSignedOut();
    throw new ApiError(res.status, data?.error || 'Something went wrong. Please try again.', data);
  }
  return data;
}

const post = (path, body = {}) => request(path, { method: 'POST', body });

export const api = {
  config: () => request('/config'),
  me: () => request('/auth/me'),
  sendCode: phone => post('/auth/otp', { phone }),
  verify: (phone, code) => post('/auth/verify', { phone, code }),
  logout: () => post('/auth/logout'),

  setOnline: online => post('/rider/status', { online }),
  sendLocation: points => post('/rider/location', { points }),
  today: () => request('/rider/today'),

  orders: () => request('/orders'),
  history: days => request(`/orders/history?days=${days}`),
  order: id => request(`/orders/${id}`),
  track: id => request(`/orders/${id}/track`),
  accept: id => post(`/orders/${id}/accept`),
  release: id => post(`/orders/${id}/release`),
  pickup: id => post(`/orders/${id}/pickup`),
  deliver: (id, body) => post(`/orders/${id}/deliver`, body),

  route: (from, to) => request(`/route?from=${from.lat},${from.lng}&to=${to.lat},${to.lng}`),
  demoOrder: () => post('/demo/order'),
};
