// The live map. Shows the rider's live position with its accuracy and heading, the kitchen, the customers'
// drop points, the road route to the next stop and the route already driven. It follows the rider when asked;
// dragging the map stops following.
// Drawn with Google Maps when the API has a Google Maps key (GoogleMap.jsx), else with Leaflet and
// OpenStreetMap tiles (below, no key needed), also when Google refuses the key.
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useSession } from '../session.jsx';
import { hasPoint } from '../lib/geo.js';
import GoogleMap from './GoogleMap.jsx';
import { BLUE, CLOSE_ZOOM, GURUGRAM, ME, ME_HTML, PIN, RED, kitchenPin, showHeading, stopPin, stopsKey, tripPoints } from './mapParts.js';
import { MapButtons, useTripView } from './tripView.jsx';

/**
 * me       the rider's live position { lat, lng, accuracy, heading } or null
 * kitchen  { lat, lng, name } or null
 * stops    [{ id, lat, lng, label, number, active }]: customers' drop points
 * route    { line: [[lat, lng], …], straight } to the next stop, or null
 * trail    [[lat, lng], …] driven so far, or null
 * fitKey   the map fits all points again whenever this changes
 */
export default function LiveMap(props) {
  const { config } = useSession();
  const [googleFailed, setGoogleFailed] = useState(false);
  return config.mapsKey && !googleFailed
    ? <GoogleMap {...props} apiKey={config.mapsKey} onFail={() => setGoogleFailed(true)} />
    : <OsmMap {...props} />;
}

// Another tile server (with its own usage terms) can be set at build time.
const TILES = import.meta.env.VITE_MAP_TILES || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = import.meta.env.VITE_MAP_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const icon = (html, size) => L.divIcon({
  className: 'map-icon',
  html,
  iconSize: [size.width, size.height],
  iconAnchor: [size.x, size.y],
  tooltipAnchor: [0, -size.y + 4],
});
const meIcon = icon(ME_HTML, ME);
const ll = p => [p.lat, p.lng];

function OsmMap({ me, kitchen, stops = [], route, trail, fitKey = 'all', followMe = false, className = '', children }) {
  const box = useRef(null);
  const map = useRef(null);
  const layers = useRef({});
  const [ready, setReady] = useState(false);

  const view = useTripView({
    ready, me, points: tripPoints({ me, kitchen, stops }), fitKey, followMe,
    show: {
      all(points) {
        if (points.length === 1) map.current.setView(ll(points[0]), CLOSE_ZOOM);
        else map.current.fitBounds(points.map(ll), { padding: [56, 56], maxZoom: CLOSE_ZOOM });
      },
      rider: p => map.current.setView(ll(p), Math.max(map.current.getZoom(), CLOSE_ZOOM)),
      pan: p => map.current.panTo(ll(p), { animate: true }),
    },
  });

  useEffect(() => {
    const m = L.map(box.current, { zoomControl: false, center: ll(GURUGRAM), zoom: 13 });
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(m);
    m.attributionControl.setPrefix(false);
    m.on('dragstart', view.dragged);
    box.current.addEventListener('wheel', view.zoomed, { passive: true });
    map.current = m;
    setReady(true);
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(box.current);
    return () => {
      resize.disconnect();
      m.remove();
      map.current = null;
      layers.current = {};
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      () => L.marker(ll(kitchen), { icon: icon(kitchenPin(), PIN), zIndexOffset: 200, keyboard: false }).bindTooltip(kitchen.name || 'Kitchen'),
      m => m.setLatLng(ll(kitchen)));
  }, [kitchen?.lat, kitchen?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    layers.current.stops?.remove();
    const group = L.layerGroup(stops.filter(hasPoint).map(s => L.marker(ll(s), {
      icon: icon(stopPin(s), PIN),
      zIndexOffset: s.active ? 300 : 100,
      keyboard: false,
    }).bindTooltip(s.label || 'Customer')));
    layers.current.stops = group.addTo(map.current);
  }, [stopsKey(stops)]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (ok) showHeading(layers.current.me?.getElement(), me);
  }, [me?.lat, me?.lng, me?.accuracy, me?.heading]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`map ${className}`}>
      <div ref={box} className="map__canvas" />
      {children}
      <MapButtons view={view} />
    </div>
  );
}
