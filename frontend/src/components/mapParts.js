// What both maps (OpenStreetMap in LiveMap.jsx, Google in GoogleMap.jsx) draw the same way: colours, the
// markers' HTML (styled in styles.css), and how much of the trip to show.
import { hasPoint } from '../lib/geo.js';

export const GURUGRAM = { lat: 28.4595, lng: 77.0266 };
export const RED = '#B71C1C';
export const BLUE = '#1A73E8';
export const CLOSE_ZOOM = 16;

const STORE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h16l-1.5-5h-13z"/><path d="M5 9v11h14V9"/><path d="M9 20v-5h6v5"/></svg>';
const HOME_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/></svg>';

// A drop-shaped pin, 36 × 44 px, its tip at (18, 42).
export const PIN = { width: 36, height: 44, x: 18, y: 42 };
export const pinHtml = (kind, inner) => `<div class="pin pin--${kind}"><span>${inner}</span></div>`;
export const kitchenPin = () => pinHtml('kitchen', STORE_SVG);
export const stopPin = s => pinHtml(s.active ? 'drop' : 'drop-dim', s.number ? `<b>${s.number}</b>` : HOME_SVG);

// The rider: a blue dot with a cone for the heading, 56 × 56 px, centred.
export const ME = { width: 56, height: 56, x: 28, y: 28 };
export const ME_HTML = '<div class="me"><div class="me__cone"></div><div class="me__dot"></div></div>';

export function showHeading(el, me) {
  const dot = el?.querySelector('.me');
  if (!dot) return;
  dot.classList.toggle('has-heading', me.heading != null);
  dot.style.setProperty('--heading', `${me.heading || 0}deg`);
}

export const tripPoints = ({ me, kitchen, stops }) => [me, kitchen, ...stops].filter(hasPoint);
export const stopsKey = stops => stops.filter(hasPoint).map(s => `${s.id}:${s.lat}:${s.lng}:${s.label}:${s.active ? 1 : 0}`).join('|');
