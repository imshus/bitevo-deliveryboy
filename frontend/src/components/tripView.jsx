// Which part of the trip a live map shows, the same on both maps: everything (again whenever fitKey changes,
// or a new point arrives until the rider moves the map), or the rider, followed as they move. Dragging the
// map stops following.
import { useEffect, useRef, useState } from 'react';
import { hasPoint } from '../lib/geo.js';
import { Locate, Route } from './Icons.jsx';

// show.all(points), show.rider(me) and show.pan(me) move the map; `ready` once it exists.
export function useTripView({ ready, me, points, fitKey, followMe, show }) {
  const fitted = useRef({ key: null, n: 0 });
  const touched = useRef(false);
  const [follow, setFollow] = useState(followMe);

  const n = points.length;
  useEffect(() => {
    if (!ready || !n || follow) return;
    const f = fitted.current;
    if (f.key === fitKey && (n <= f.n || touched.current)) return;
    fitted.current = { key: fitKey, n };
    show.all(points);
  }, [ready, fitKey, n, follow]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (ready && follow && hasPoint(me)) show.pan(me);
  }, [ready, follow, me?.lat, me?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    follow,
    dragged() {
      touched.current = true;
      setFollow(false);
    },
    zoomed() {
      touched.current = true;
    },
    followRider() {
      if (!hasPoint(me)) return show.all(points);
      setFollow(true);
      show.rider(me);
    },
    showAll() {
      setFollow(false);
      touched.current = false;
      show.all(points);
    },
  };
}

export function MapButtons({ view }) {
  return (
    <div className="map__buttons">
      <button type="button" className="map__btn" onClick={view.showAll} aria-label="Show the whole trip"><Route size={20} /></button>
      <button type="button" className={`map__btn${view.follow ? ' is-on' : ''}`} onClick={view.followRider} aria-label="Follow my location"><Locate size={20} /></button>
    </div>
  );
}
