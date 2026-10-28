// Road routes for the rider's map, from an OSRM server (ROUTING_URL). The public demo server at
// router.project-osrm.org is fine for trying the app; for a real fleet host OSRM yourself or point
// ROUTING_URL at a paid one. Answers are cached, and any failure just means a straight line on the map.
import { config } from '../config.js';

const TIMEOUT_MS = 6000;
const KEEP_MS = 10 * 60000;
const cache = new Map();
let warnedAt = 0;

const key = (from, to) => [from.lat, from.lng, to.lat, to.lng].map(n => n.toFixed(4)).join(','); // about 10 m

function remember(k, value) {
  cache.set(k, { value, at: Date.now() });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}

// { distanceM, durationS, line: [[lat, lng], …] }, or null when no route could be found.
export async function roadRoute(from, to) {
  if (!config.routingUrl) return null;
  const k = key(from, to);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.value;

  const url = `${config.routingUrl}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&alternatives=false&steps=false`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'BiteVo-Delivery/1.0 (bitevo.in)' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const data = await res.json().catch(() => null);
    const r = data?.code === 'Ok' ? data.routes?.[0] : null;
    if (!r) throw new Error(`HTTP ${res.status} ${data?.code || ''} ${data?.message || ''}`.trim());
    return remember(k, {
      distanceM: Math.round(r.distance),
      durationS: Math.round(r.duration),
      line: r.geometry.coordinates.map(([lng, lat]) => [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]),
    });
  } catch (err) {
    if (Date.now() - warnedAt > 60000) {
      warnedAt = Date.now();
      console.warn(`Road route not available (${err.message}); the map shows a straight line.`);
    }
    return null;
  }
}
