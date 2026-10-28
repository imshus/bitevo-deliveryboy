// The live map (Leaflet + OpenStreetMap tiles; no API key needed). Shows the rider's live position with
// its accuracy and heading, the kitchen, the customers' drop points, the road route to the next stop
// and the route already driven. It follows the rider when asked; dragging the map stops following.
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hasPoint } from '../lib/geo.js';
import { Locate, Route } from './Icons.jsx';

// Another tile server (with its own usage terms) can be set at build time.
const TILES = import.meta.env.VITE_MAP_TILES || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = import.meta.env.VITE_MAP_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const GURUGRAM = [28.4595, 77.0266];
const RED = '#B71C1C';
const BLUE = '#1A73E8';

const STORE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h16l-1.5-5h-13z"/><path d="M5 9v11h14V9"/><path d="M9 20v-5h6v5"/></svg>';
const HOME_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/></svg>';

const pinIcon = (kind, inner) => L.divIcon({
  className: 'map-icon',
  html: `<div class="pin pin--${kind}"><span>${inner}</span></div>`,
  iconSize: [36, 44],
  iconAnchor: [18, 42],
  tooltipAnchor: [0, -38],
});
const meIcon = L.divIcon({ className: 'map-icon', html: '<div class="me"><div class="me__cone"></div><div class="me__dot"></div></div>', iconSize: [56, 56], iconAnchor: [28, 28] });
const ll = p => [p.lat, p.lng];

/**
 * me       the rider's live position { lat, lng, accuracy, heading } or null
 * kitchen  { lat, lng, name } or null
 * stops    [{ id, lat, lng, label, active }]: customers' drop points
 * route    { line: [[lat, lng], …], straight } to the next stop, or null
 * trail    [[lat, lng], …] driven so far, or null
 * fitKey   the map fits all points again whenever this changes
 */
export default function LiveMap({ me, kitchen, stops = [], route, trail, fitKey = 'all', followMe = false, className = '', children }) {
  const box = useRef(null);
  const map = useRef(null);
  const layers = useRef({});
  const fitted = useRef({ key: null, n: 0 });
  const touched = useRef(false);
  const [follow, setFollow] = useState(followMe);

  useEffect(() => {
    const m = L.map(box.current, { zoomControl: false, center: GURUGRAM, zoom: 13 });
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(m);
    m.attributionControl.setPrefix(false);
    m.on('dragstart', () => {
      touched.current = true;
      setFollow(false);
    });
    box.current.addEventListener('wheel', () => { touched.current = true; }, { passive: true });
    map.current = m;
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(box.current);
    return () => {
      resize.disconnect();
      m.remove();
      map.current = null;
      layers.current = {};
    };
  }, []);

  // Adds, moves or removes one layer.
  const place = (key, wanted, create, update) => {
    const l = layers.current;
    if (!wanted) {
      l[key]?.remove();
      delete l[key];
    } else if (!l[key]) {
      l[key] = create().addTo(map.current);
    } else {
      update(l[key]);
    }
  };

  useEffect(() => {
    place('kitchen', hasPoint(kitchen),
      () => L.marker(ll(kitchen), { icon: pinIcon('kitchen', STORE_SVG), zIndexOffset: 200, keyboard: false }).bindTooltip(kitchen.name || 'Kitchen'),
      m => m.setLatLng(ll(kitchen)));
  }, [kitchen?.lat, kitchen?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopsKey = stops.filter(hasPoint).map(s => `${s.id}:${s.lat}:${s.lng}:${s.label}:${s.active ? 1 : 0}`).join('|');
  useEffect(() => {
    layers.current.stops?.remove();
    const group = L.layerGroup(stops.filter(hasPoint).map(s => L.marker(ll(s), {
      icon: pinIcon(s.active ? 'drop' : 'drop-dim', s.number ? `<b>${s.number}</b>` : HOME_SVG),
      zIndexOffset: s.active ? 300 : 100,
      keyboard: false,
    }).bindTooltip(s.label || 'Customer')));
    layers.current.stops = group.addTo(map.current);
  }, [stopsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const line = route?.line?.length > 1 ? route.line : null;
    const style = { color: RED, weight: 5, opacity: 0.85, dashArray: route?.straight ? '2 10' : null, lineCap: 'round' };
    place('route', line, () => L.polyline(line, style), p => { p.setLatLngs(line); p.setStyle(style); });
  }, [route]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const line = trail?.length > 1 ? trail : null;
    place('trail', line, () => L.polyline(line, { color: BLUE, weight: 4, opacity: 0.55, lineCap: 'round' }), p => p.setLatLngs(line));
  }, [trail]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ok = hasPoint(me);
    place('accuracy', ok && me.accuracy > 15,
      () => L.circle(ll(me), { radius: me.accuracy, color: BLUE, weight: 1, opacity: 0.4, fillColor: BLUE, fillOpacity: 0.1, interactive: false }),
      c => { c.setLatLng(ll(me)); c.setRadius(me.accuracy); });
    place('me', ok, () => L.marker(ll(me), { icon: meIcon, zIndexOffset: 1000, keyboard: false, interactive: false }), m => m.setLatLng(ll(me)));
    const el = layers.current.me?.getElement()?.querySelector('.me');
    if (el) {
      el.classList.toggle('has-heading', me.heading != null);
      el.style.setProperty('--heading', `${me.heading || 0}deg`);
    }
    if (ok && follow) map.current.panTo(ll(me), { animate: true });
  }, [me?.lat, me?.lng, me?.accuracy, me?.heading, follow]); // eslint-disable-line react-hooks/exhaustive-deps

  const allPoints = () => [me, kitchen, ...stops].filter(hasPoint).map(ll);
  const fitAll = () => {
    const pts = allPoints();
    if (pts.length === 1) map.current.setView(pts[0], 16);
    else if (pts.length) map.current.fitBounds(pts, { padding: [56, 56], maxZoom: 16 });
  };

  // Fits everything in view when the key changes, or when a point arrives (until the rider moves the map).
  const n = allPoints().length;
  useEffect(() => {
    if (!n || follow) return;
    const f = fitted.current;
    if (f.key === fitKey && (n <= f.n || touched.current)) return;
    fitted.current = { key: fitKey, n };
    fitAll();
  }, [fitKey, n, follow]); // eslint-disable-line react-hooks/exhaustive-deps

  const followRider = () => {
    if (!hasPoint(me)) return fitAll();
    setFollow(true);
    map.current.setView(ll(me), Math.max(map.current.getZoom(), 16));
  };
  const showAll = () => {
    setFollow(false);
    touched.current = false;
    fitAll();
  };

  return (
    <div className={`map ${className}`}>
      <div ref={box} className="map__canvas" />
      {children}
      <div className="map__buttons">
        <button type="button" className="map__btn" onClick={showAll} aria-label="Show the whole trip"><Route size={20} /></button>
        <button type="button" className={`map__btn${follow ? ' is-on' : ''}`} onClick={followRider} aria-label="Follow my location"><Locate size={20} /></button>
      </div>
    </div>
  );
}
