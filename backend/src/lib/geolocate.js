// Where a rider's phone is from the Wi-Fi networks it can see, through Google's Geolocation API, for when the
// phone's GPS can't find it (indoors, with the phone's own Wi-Fi positioning off). The Android app sends this
// only while it has no GPS or network position; the answer is approximate (tens of metres).
// Each lookup is billed by Google, so the app asks at most once a minute and only when the networks change.
import { config } from '../config.js';
import { HttpError } from './http.js';

const API = 'https://www.googleapis.com/geolocation/v1/geolocate';
const TIMEOUT_MS = 10000;
const MAX_NETWORKS = 20;
let warnedAt = 0;

export const locatesByWifi = () => Boolean(config.geolocationKey);

const MAC = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;

// [{ mac, signal }] from the request: valid, distinct MAC addresses (BSSIDs) with a signal in dBm, strongest first.
export function cleanNetworks(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const n of list.slice(0, 50)) {
    const mac = String(n?.mac || '').trim().toLowerCase().replace(/-/g, ':');
    const signal = Math.round(Number(n?.signal));
    if (!MAC.test(mac) || mac === '00:00:00:00:00:00' || seen.has(mac)) continue;
    seen.add(mac);
    out.push({ mac, signal: Number.isFinite(signal) && signal < 0 && signal > -120 ? signal : null });
  }
  return out.sort((a, b) => (b.signal ?? -999) - (a.signal ?? -999)).slice(0, MAX_NETWORKS);
}

// { lat, lng, accuracy, at }, or null when Google can't place these networks.
export async function locateByWifi(networks) {
  if (!locatesByWifi()) {
    throw new HttpError(503, 'Finding your location from Wi-Fi isn’t set up.', { code: 'NOT_SET_UP' });
  }
  let res;
  let data;
  try {
    res = await fetch(`${API}?key=${encodeURIComponent(config.geolocationKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        considerIp: false, // the server's own address says nothing about where the rider is
        wifiAccessPoints: networks.map(n => ({ macAddress: n.mac, ...(n.signal != null && { signalStrength: n.signal }) })),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    data = await res.json().catch(() => null);
  } catch (err) {
    console.error(`[geolocate] Couldn’t reach Google: ${err.message}`);
    throw new HttpError(503, 'Couldn’t find your location from Wi-Fi right now.');
  }
  if (res.ok && Number.isFinite(data?.location?.lat) && Number.isFinite(data?.location?.lng)) {
    return {
      lat: Math.round(data.location.lat * 1e6) / 1e6,
      lng: Math.round(data.location.lng * 1e6) / 1e6,
      accuracy: Number.isFinite(data.accuracy) ? Math.round(data.accuracy * 10) / 10 : null,
      at: new Date().toISOString(),
    };
  }
  if (res.status === 404) return null; // Google doesn't know these networks
  // 400/403: the key is wrong, or the Geolocation API isn't enabled or billed for it. Said once an hour.
  if (Date.now() - warnedAt > 3600000) {
    warnedAt = Date.now();
    console.error(`[geolocate] Google answered HTTP ${res.status}: ${data?.error?.message || 'no message'}. Check that the Geolocation API is enabled for GOOGLE_GEOLOCATION_KEY.`);
  }
  throw new HttpError(503, 'Couldn’t find your location from Wi-Fi right now.', res.status === 403 ? { code: 'NOT_SET_UP' } : undefined);
}
