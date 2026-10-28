// The live map on Google Maps, used by LiveMap.jsx when the API has a Google Maps key: the same markers, route
// and trail as the OpenStreetMap version, with the markers drawn as the same HTML. Calls onFail() when Google
// refuses the key or doesn't load, and LiveMap switches to OpenStreetMap.
import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../lib/googleMaps.js';
import { hasPoint } from '../lib/geo.js';
import { BLUE, CLOSE_ZOOM, GURUGRAM, ME, ME_HTML, PIN, RED, kitchenPin, showHeading, stopPin, stopsKey, tripPoints } from './mapParts.js';
import { MapButtons, useTripView } from './tripView.jsx';

// A marker drawn as HTML. (Google's own markers need a Map ID set up in Google Cloud for that; an overlay doesn't.)
function htmlMarkerClass(OverlayView) {
  return class HtmlMarker extends OverlayView {
    constructor({ position, html, size, z = 0, title, pane = 'overlayMouseTarget' }) {
      super();
      this.position = position;
      this.size = size;
      this.pane = pane;
      this.div = document.createElement('div');
      this.div.className = 'map-icon';
      this.div.innerHTML = html;
      Object.assign(this.div.style, { position: 'absolute', width: `${size.width}px`, height: `${size.height}px`, zIndex: z });
      if (title) this.div.title = title;
    }

    onAdd() {
      this.getPanes()[this.pane].appendChild(this.div);
    }

    draw() {
      const p = this.getProjection()?.fromLatLngToDivPixel(this.position);
      if (!p) return;
      this.div.style.left = `${p.x - this.size.x}px`;
      this.div.style.top = `${p.y - this.size.y}px`;
    }

    onRemove() {
      this.div.remove();
    }

    moveTo(position) {
      this.position = position;
      this.draw();
    }
  };
}

const dashes = color => [{ icon: { path: 'M 0,-1 0,1', strokeColor: color, strokeOpacity: 0.85, scale: 3 }, offset: '0', repeat: '14px' }];

export default function GoogleMap({ apiKey, onFail, me, kitchen, stops = [], route, trail, fitKey = 'all', followMe = false, className = '', children }) {
  const box = useRef(null);
  const map = useRef(null);
  const g = useRef(null); // the Google classes, once loaded
  const layers = useRef({});
  const [ready, setReady] = useState(false);
  const pos = p => new g.current.LatLng(p.lat, p.lng);

  const view = useTripView({
    ready, me, points: tripPoints({ me, kitchen, stops }), fitKey, followMe,
    show: {
      all(points) {
        const m = map.current;
        if (points.length === 1) {
          m.setCenter(pos(points[0]));
          m.setZoom(CLOSE_ZOOM);
          return;
        }
        const bounds = new g.current.LatLngBounds();
        points.forEach(p => bounds.extend(pos(p)));
        m.fitBounds(bounds, 56);
        g.current.event.addListenerOnce(m, 'idle', () => { if (m.getZoom() > CLOSE_ZOOM) m.setZoom(CLOSE_ZOOM); });
      },
      rider(p) {
        map.current.setCenter(pos(p));
        map.current.setZoom(Math.max(map.current.getZoom(), CLOSE_ZOOM));
      },
      pan: p => map.current.panTo(pos(p)),
    },
  });

  useEffect(() => {
    let live = true;
    const failed = () => live && onFail();
    window.addEventListener('bitevo:maps-auth-failed', failed);
    loadGoogleMaps(apiKey)
      .then(gm => Promise.all([gm.importLibrary('maps'), gm.importLibrary('core')]))
      .then(([maps, core]) => {
        if (!live) return;
        g.current = { ...core, Polyline: maps.Polyline, Circle: maps.Circle, HtmlMarker: htmlMarkerClass(maps.OverlayView) };
        const m = new maps.Map(box.current, {
          center: GURUGRAM, zoom: 13,
          disableDefaultUI: true, gestureHandling: 'greedy', clickableIcons: false, keyboardShortcuts: false,
        });
        m.addListener('dragstart', view.dragged);
        box.current.addEventListener('wheel', view.zoomed, { passive: true });
        map.current = m;
        setReady(true);
      })
      .catch(failed);
    return () => {
      live = false;
      window.removeEventListener('bitevo:maps-auth-failed', failed);
      Object.values(layers.current).flat().forEach(l => l.setMap(null));
      layers.current = {};
      map.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Adds, moves or removes one layer.
  const place = (key, wanted, create, update) => {
    const l = layers.current;
    if (!wanted) {
      l[key]?.setMap(null);
      delete l[key];
    } else if (!l[key]) {
      l[key] = create();
      l[key].setMap(map.current);
    } else {
      update(l[key]);
    }
  };

  useEffect(() => {
    if (!ready) return;
    place('kitchen', hasPoint(kitchen),
      () => new g.current.HtmlMarker({ position: pos(kitchen), html: kitchenPin(), size: PIN, z: 200, title: kitchen.name || 'Kitchen' }),
      m => m.moveTo(pos(kitchen)));
  }, [ready, kitchen?.lat, kitchen?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready) return;
    layers.current.stops?.forEach(m => m.setMap(null));
    layers.current.stops = stops.filter(hasPoint).map(s => {
      const m = new g.current.HtmlMarker({ position: pos(s), html: stopPin(s), size: PIN, z: s.active ? 300 : 100, title: s.label || 'Customer' });
      m.setMap(map.current);
      return m;
    });
  }, [ready, stopsKey(stops)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready) return;
    const path = route?.line?.length > 1 ? route.line.map(([lat, lng]) => ({ lat, lng })) : null;
    const style = route?.straight
      ? { strokeOpacity: 0, icons: dashes(RED) }
      : { strokeColor: RED, strokeOpacity: 0.85, strokeWeight: 5, icons: [] };
    place('route', path, () => new g.current.Polyline({ path, clickable: false, zIndex: 2, ...style }), p => p.setOptions({ path, ...style }));
  }, [ready, route]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready) return;
    const path = trail?.length > 1 ? trail.map(([lat, lng]) => ({ lat, lng })) : null;
    place('trail', path,
      () => new g.current.Polyline({ path, clickable: false, zIndex: 1, strokeColor: BLUE, strokeOpacity: 0.55, strokeWeight: 4 }),
      p => p.setPath(path));
  }, [ready, trail]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready) return;
    const ok = hasPoint(me);
    place('accuracy', ok && me.accuracy > 15,
      () => new g.current.Circle({
        center: pos(me), radius: me.accuracy, clickable: false,
        strokeColor: BLUE, strokeWeight: 1, strokeOpacity: 0.4, fillColor: BLUE, fillOpacity: 0.1,
      }),
      c => { c.setCenter(pos(me)); c.setRadius(me.accuracy); });
    place('me', ok,
      () => new g.current.HtmlMarker({ position: pos(me), html: ME_HTML, size: ME, z: 1000, pane: 'overlayLayer' }),
      m => m.moveTo(pos(me)));
    if (ok) showHeading(layers.current.me.div, me);
  }, [ready, me?.lat, me?.lng, me?.accuracy, me?.heading]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`map map--google ${className}`}>
      <div ref={box} className="map__canvas" />
      {children}
      <MapButtons view={view} />
    </div>
  );
}
