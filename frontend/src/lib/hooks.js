import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { distanceM, hasPoint } from './geo.js';

// Loads `load()` now and every `everyMs` while the page is on screen (and again when it comes back).
// Returns { data, error, loading, reload }.
export function usePoll(load, everyMs, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const id = ++seq.current;
    try {
      const data = await loadRef.current();
      if (id === seq.current) setState({ data, error: null, loading: false });
      return data;
    } catch (error) {
      if (id === seq.current) setState(s => ({ ...s, error, loading: false }));
      return null;
    }
  }, []);

  useEffect(() => {
    setState(s => ({ ...s, loading: true }));
    reload();
    const timer = everyMs ? setInterval(() => document.visibilityState === 'visible' && reload(), everyMs) : null;
    const onVisible = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...state, reload };
}

// Re-renders every `ms`, for "4 min ago" labels.
export function useNow(ms = 15000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const OFF_ROUTE_M = 60;
const asPoint = ([lat, lng]) => ({ lat, lng });

// What's left of a road route from where the rider is now: from the nearest point of the line to the end.
// `off` is how far the rider is from the line.
function remainingRoute(route, from) {
  const line = route.line;
  let near = 0;
  let off = Infinity;
  line.forEach((p, i) => {
    const d = distanceM(from, asPoint(p));
    if (d < off) { off = d; near = i; }
  });
  const rest = line.slice(near);
  let m = off;
  for (let i = 1; i < rest.length; i++) m += distanceM(asPoint(rest[i - 1]), asPoint(rest[i]));
  const share = route.distanceM > 0 ? Math.min(1, m / route.distanceM) : 1;
  return { ...route, line: [[from.lat, from.lng], ...rest], distanceM: m, durationS: route.durationS * share, off };
}

// The road route from `from` to `to`. Between answers the line, distance and time follow the rider along
// it; a new route is asked for when the rider leaves it (at most every 15 s) or the destination changes.
// Until the first answer, or without a routing server, a straight line.
export function useRoute(from, to) {
  const [route, setRoute] = useState(null);
  const asked = useRef(null);
  const seq = useRef(0);
  const ok = hasPoint(from) && hasPoint(to);
  const current = ok && route && distanceM(route.to, to) < 15 ? remainingRoute(route, from) : null;

  useEffect(() => {
    if (!ok) return;
    const last = asked.current;
    const sameTo = last && distanceM(last.to, to) < 15;
    if (sameTo && (Date.now() - last.at < 15000 || (current && current.off < OFF_ROUTE_M))) return;
    asked.current = { to, at: Date.now() };
    const id = ++seq.current;
    api.route(from, to)
      .then(r => { if (id === seq.current) setRoute(r.route ? { ...r.route, to } : null); })
      .catch(() => {});
  }, [ok, from?.lat, from?.lng, to?.lat, to?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ok) return null;
  if (current) return current;
  // Roads are rarely straight: ~1.3× the straight line, at ~20 km/h through town.
  const m = distanceM(from, to) * 1.3;
  return { line: [[from.lat, from.lng], [to.lat, to.lng]], distanceM: m, durationS: m / 5.5, straight: true };
}
