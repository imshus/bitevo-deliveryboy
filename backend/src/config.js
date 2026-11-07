// All backend settings come from environment variables, usually backend/.env (see .env.example).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, '..');
dotenv.config({ path: path.join(backendDir, '.env'), quiet: true });

// Accepts MONGODB_URI, or the MONGO_DB_URL / MONGO_DB_USER / MONGO_DB_PASSWORD trio (same as the admin panel).
function mongoUri() {
  const raw = (process.env.MONGODB_URI || process.env.MONGO_DB_URL || '').trim();
  if (!raw) return '';
  const user = process.env.MONGO_DB_USER;
  const pass = process.env.MONGO_DB_PASSWORD;
  const hasCredentials = /^mongodb(\+srv)?:\/\/[^/]*@/.test(raw);
  if (hasCredentials || !user || !pass) return raw;
  return raw.replace(/^(mongodb(\+srv)?:\/\/)/, `$1${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`);
}

const list = value => (value || '').split(',').map(s => s.trim()).filter(Boolean);
const num = (value, fallback) => (Number.isFinite(parseFloat(value)) ? parseFloat(value) : fallback);

// `--port 4002` on the command line wins over PORT (the dev script pins the API to 4002).
const argPort = Number(process.argv[process.argv.indexOf('--port') + 1] || 0) || 0;

// A latitude or longitude: decimal ("28.4475"), or degrees, minutes and seconds as Google Maps shows them
// (28°26'51.0"N, 77°04'12.0"E; S and W are negative). Null for anything else. (parseFloat alone read
// 28°26'51.0"N as 28, putting the kitchen some 50 km away.)
export function coordinate(value) {
  const m = String(value ?? '').trim()
    .match(/^(-?)(\d+(?:\.\d+)?)\s*°?\s*(?:(\d+(?:\.\d+)?)\s*['′’]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:"|″|”|'')\s*)?([NSEW])?$/i);
  if (!m) return null;
  const n = (Number(m[2]) + (Number(m[3]) || 0) / 60 + (Number(m[4]) || 0) / 3600) * (m[1] || /[SW]/i.test(m[5] || '') ? -1 : 1);
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null;
}

const kitchenLat = coordinate(process.env.KITCHEN_LAT);
const kitchenLng = coordinate(process.env.KITCHEN_LNG);

export const config = {
  port: (process.argv.includes('--port') && argPort) || Number(process.env.PORT) || 4002,
  // 127.0.0.1 = only this computer. Phones reach the API through the Vite dev server or the deployed site.
  host: process.env.HOST || '127.0.0.1',
  mongoUri: mongoUri(),
  mongoDbName: process.env.MONGO_DB_NAME || 'bitevo',
  // Without MongoDB the API stores data in this JSON file instead, with demo riders and orders.
  dataFile: process.env.DATA_FILE || path.join(backendDir, 'data', 'db.json'),
  // The built rider app (`npm run build` in frontend/). When it exists, the API serves it too.
  clientDir: path.resolve(backendDir, process.env.CLIENT_DIR || '../frontend/dist'),
  // Origins of the rider app allowed to call the API with cookies.
  clientOrigins: list(process.env.CLIENT_ORIGIN || 'http://localhost:2003'),

  // Sign-in codes: shown on screen and in the log while true; sent through MiniMoth when false.
  otpDevMode: process.env.OTP_DEV_MODE !== 'false',
  sms: { minimothKey: (process.env.MINIMOTH_API_KEY || '').trim() },

  // Where riders pick orders up. Without a position the map shows only the rider and the customers.
  kitchen: kitchenLat != null && kitchenLng != null ? {
    name: process.env.KITCHEN_NAME || 'BiteVo Kitchen',
    address: process.env.KITCHEN_ADDRESS || '',
    phone: process.env.KITCHEN_PHONE || '',
    lat: kitchenLat,
    lng: kitchenLng,
  } : null,
  supportPhone: process.env.SUPPORT_PHONE || '',

  // Riders may pick unassigned orders themselves (SELF_ASSIGN=false: only the panel assigns).
  selfAssign: process.env.SELF_ASSIGN !== 'false',
  maxActiveOrders: Math.max(1, Number(process.env.MAX_ACTIVE_ORDERS) || 2),
  // A rider who went online in the app and sent no position for this long is set offline.
  offlineAfterMins: Math.max(5, Number(process.env.OFFLINE_AFTER_MINS) || 20),
  // Driven routes of each order are kept this many days.
  trackKeepDays: Math.max(1, Number(process.env.TRACK_KEEP_DAYS) || 30),
  // Road routes for the map (an OSRM server). Empty = the map draws a straight line.
  routingUrl: (process.env.ROUTING_URL ?? 'https://router.project-osrm.org').trim().replace(/\/+$/, ''),
  // Google Maps (Maps JavaScript API) for the app's map, the same keys as the website's. The browser key should be
  // restricted to the app's address in Google Cloud; without it the server key is used (fine on localhost).
  // Neither = OpenStreetMap.
  mapsKey: (process.env.GOOGLE_MAPS_BROWSER_KEY || process.env.GOOGLE_MAPS_KEY || '').trim(),
  // Google's Geolocation API: where a rider's phone is from the Wi-Fi networks around it, when its GPS can't find
  // it (indoors with Wi-Fi positioning off). A server key with the Geolocation API enabled; without
  // GOOGLE_GEOLOCATION_KEY the server maps key is used. Neither = the app waits for the GPS.
  geolocationKey: (process.env.GOOGLE_GEOLOCATION_KEY || process.env.GOOGLE_MAPS_KEY || '').trim(),

  // Delivery photos go to Supabase Storage (the admin panel's project): its URL and secret key, and the bucket.
  // Without them they're kept on this server (lib/photos.js).
  supabase: {
    url: (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, ''),
    key: (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
    bucket: (process.env.SUPABASE_DELIVERY_BUCKET || 'bitevo-delivery-photos').trim(),
  },
  // "Today" for the rider's stats: minutes ahead of UTC (India = 330).
  utcOffsetMins: num(process.env.UTC_OFFSET_MINS, 330),

  cookie: {
    name: 'bitevo_rider_session',
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: process.env.COOKIE_SAMESITE || 'lax', // "none" (with COOKIE_SECURE=true) when the app is on another domain
  },
  sessionDays: Number(process.env.SESSION_DAYS) || 30,
  trustProxy: process.env.TRUST_PROXY === 'true',
};
