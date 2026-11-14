// Business rules shared by several routes. The order flow belongs to the admin panel:
// placed (new) → preparing → out_for_delivery → delivered; or cancelled.
import { config } from '../config.js';
import { DAY, MIN } from './http.js';

export const LIVE_STATUSES = ['placed', 'preparing', 'out_for_delivery'];
export const BEFORE_PICKUP = ['placed', 'preparing'];

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const money = n => inr.format(Math.round(n || 0));

// What the rider collects at the door: the bill minus what the wallet paid, on cash orders only.
export const cashToCollect = o => (o.paymentMethod === 'Cash on delivery' ? Math.max(0, (o.total || 0) - (o.walletUsed || 0)) : 0);

// Indian mobile numbers: accepts "98765 43210", "+91 98765 43210", "09876543210" …
// Returns the stored form "+91 98765 43210", or null when it isn't a valid mobile number.
export function normalizePhone(input) {
  let digits = String(input || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

// The last 10 digits, for matching numbers typed in different ways in the admin panel.
export const phoneDigits = phone => String(phone || '').replace(/\D/g, '').slice(-10);

// Straight-line distance in km.
export function distanceKm(a, b) {
  const rad = d => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// The location saved with the customer's address: a map pin, or (what the website offers without Google Maps)
// where their phone or computer was when they tapped "I'm at this address now". The website doesn't check that
// spot against the address, so it can be far off: a computer locating itself by its internet connection put one
// customer in Gujarat. A spot further than MAX_DROP_KM from the kitchen can't be the address.
const savedPoint = o => {
  const lat = Number(o.address?.lat);
  const lng = Number(o.address?.lng);
  return o.address?.lat != null && o.address?.lng != null && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};
const tooFar = p => Boolean(p && config.kitchen && config.maxDropKm > 0 && distanceKm(config.kitchen, p) > config.maxDropKm);

// The order's drop point, or null when the address has no believable location (riders then navigate by the
// typed address).
export function dropPoint(o) {
  const p = savedPoint(o);
  return p && !tooFar(p) ? p : null;
}

// How far from the kitchen a saved location was when it's ignored as impossible (km), else null.
export function ignoredDropKm(o) {
  const p = savedPoint(o);
  return tooFar(p) ? Math.round(distanceKm(config.kitchen, p)) : null;
}

// Midnight of the rider's day (UTC_OFFSET_MINS, India by default), whatever time zone the server runs in.
export function startOfDay(now = Date.now(), daysAgo = 0) {
  const offset = config.utcOffsetMins * MIN;
  return Math.floor((now + offset) / DAY) * DAY - offset - daysAgo * DAY;
}
export const dayKey = (now = Date.now()) => new Date(startOfDay(now) + config.utcOffsetMins * MIN).toISOString().slice(0, 10);

// "Chrome on Windows", "Safari on iOS", …
export function deviceName(userAgent = '') {
  const ua = userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unknown OS';
  return `${browser} on ${os}`;
}

// Strips IPv6-mapped prefixes so 127.0.0.1 reads normally.
export const clientIp = req => (req.ip || '').replace(/^::ffff:/, '') || null;

// Runs tasks for the same key one after another (e.g. one rider's location updates), so quick
// requests from the same phone can't overwrite each other within this server process.
const queues = new Map();
export function serialize(key, task) {
  const run = (queues.get(key) || Promise.resolve()).then(task, task);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
}
