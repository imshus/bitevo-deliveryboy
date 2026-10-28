const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const money = n => inr.format(Math.round(n || 0));

const time = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' });
const day = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
export const clock = iso => (iso ? time.format(new Date(iso)) : '');

// "Today, 7:40 pm" / "24 Oct, 7:40 pm"
export function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return `${today ? 'Today' : day.format(d)}, ${time.format(d)}`;
}

// "just now", "4 min ago", "2 h ago"
export function ago(iso, now = Date.now()) {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export const distance = m => (m == null ? '' : m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 9500 ? 1 : 0)} km`);
export const duration = s => (s == null ? '' : s < 90 ? '1 min' : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);

export const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
export const telLink = phone => `tel:${String(phone || '').replace(/[^\d+]/g, '')}`;
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
