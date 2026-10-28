// Live location. While the rider is online this follows the phone's GPS and sends the position to the API:
//  - a point whenever the rider has moved SEND_EVERY_M, and every SEND_EVERY_MS while standing still,
//    so the panel always knows where they are and that the app is still running;
//  - points are kept while the network is down and sent together when it's back;
//  - the screen is kept on (Wake Lock) while online, because phones pause the GPS of a page that's
//    off screen. The rider should keep the app open while working.
// Inside the BiteVo Rider Android app (mobile/) the app's own location service does all this instead, and
// keeps going with the screen off. The app gives the page `window.BiteVoRider` to start and stop it, and
// reports back with `bitevo-rider` events carrying the same fields as `state`, plus `position` or
// `locationError` (askForLocation), `offline` (the API's message) or `signedOut`.
// React reads the state with useTracker().
import { useSyncExternalStore } from 'react';
import { api } from '../api.js';
import { distanceM } from './geo.js';

const SEND_EVERY_M = 20;
const SEND_EVERY_MS = 12000;
const MAX_QUEUE = 300;
const BATCH = 60;

let state = {
  running: false,
  permission: 'unknown', // granted | denied | prompt | unavailable | unknown
  position: null, // { lat, lng, accuracy, heading, speed, at }
  gpsProblem: null,
  lastSentAt: null,
  queued: 0,
  networkProblem: false,
  screenOn: false,
};
const listeners = new Set();
const set = patch => {
  state = { ...state, ...patch };
  listeners.forEach(l => l());
};
const subscribe = l => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useTracker = () => useSyncExternalStore(subscribe, () => state);
export const trackerState = () => state;

const app = typeof window !== 'undefined' ? window.BiteVoRider : undefined;
export const inAndroidApp = Boolean(app);

let watchId = null;
let timer = null;
let queue = [];
let lastQueued = null; // { lat, lng, time }
let sending = false;
let wakeLock = null;
let handlers = {};

const round = (n, d) => (n == null || Number.isNaN(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

function enqueue(pos) {
  // Stamped with the time it's sent from the phone, so a resent position still counts as fresh.
  queue.push({ ...pos, at: new Date().toISOString() });
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  lastQueued = { lat: pos.lat, lng: pos.lng, time: Date.now() };
  set({ queued: queue.length });
}

async function flush() {
  if (sending || !queue.length || !state.running) return;
  sending = true;
  const batch = queue.slice(0, BATCH);
  try {
    await api.sendLocation(batch);
    queue = queue.slice(batch.length);
    set({ lastSentAt: Date.now(), queued: queue.length, networkProblem: false });
  } catch (err) {
    if (err.status === 409 && err.data?.status === 'offline') {
      stopTracking();
      handlers.onOffline?.(err.message);
    } else if (err.status === 401) {
      stopTracking();
    } else {
      set({ networkProblem: true });
    }
  } finally {
    sending = false;
  }
  if (queue.length && state.running && !state.networkProblem) flush();
}

function onPosition(p) {
  const pos = {
    lat: round(p.coords.latitude, 6),
    lng: round(p.coords.longitude, 6),
    accuracy: round(p.coords.accuracy, 1),
    heading: Number.isFinite(p.coords.heading) ? round(p.coords.heading, 0) : null,
    speed: Number.isFinite(p.coords.speed) ? round(p.coords.speed, 1) : null,
    at: new Date(p.timestamp || Date.now()).toISOString(),
  };
  set({ position: pos, permission: 'granted', gpsProblem: null });
  const moved = !lastQueued || distanceM(lastQueued, pos) >= SEND_EVERY_M;
  const due = !lastQueued || Date.now() - lastQueued.time >= SEND_EVERY_MS;
  if (moved || due) {
    enqueue(pos);
    flush();
  }
}

function onGpsError(e) {
  if (e.code === 1) set({ permission: 'denied', gpsProblem: 'Location is blocked for this app. Allow it in your browser’s site settings.' });
  else if (e.code === 3) set({ gpsProblem: 'Waiting for a GPS signal…' });
  else set({ gpsProblem: 'Your phone can’t find its location. Turn on Location (GPS) and try again.' });
}

// Standing still, the GPS may stay quiet: resend the last position now and then, and retry sending.
function tick() {
  if (state.position && (!lastQueued || Date.now() - lastQueued.time >= SEND_EVERY_MS)) enqueue(state.position);
  flush();
}

async function keepScreenOn() {
  if (!('wakeLock' in navigator) || wakeLock || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    set({ screenOn: true });
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
      set({ screenOn: false });
    });
  } catch {
    // Not allowed right now (battery saver, or the page isn't visible); tried again on the next visit.
  }
}

function onVisible() {
  if (!state.running || document.visibilityState !== 'visible') return;
  keepScreenOn();
  tick();
}

function onNetworkBack() {
  if (!state.running) return;
  set({ networkProblem: false });
  flush();
}

if (app) {
  window.addEventListener('bitevo-rider', e => {
    // (barcode answers are for lib/proof.js)
    const { offline, signedOut, locationError, barcode, barcodeError, barcodeCancelled, photoError, ...patch } = e.detail || {};
    set(patch);
    if (offline) {
      stopTracking();
      handlers.onOffline?.(offline);
    } else if (signedOut) {
      stopTracking();
    }
  });
}

export async function readPermission() {
  if (app) return set({ permission: app.permission() });
  if (!('geolocation' in navigator)) return set({ permission: 'unavailable' });
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    set({ permission: status.state });
    status.onchange = () => set({ permission: status.state });
  } catch {
    // Older browsers can't tell before asking.
  }
}

// Asks for the location once (the browser shows its permission prompt) and resolves with the position.
export function askForLocation() {
  if (app) return askTheApp();
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      set({ permission: 'unavailable' });
      return reject(new Error('This phone or browser can’t share its location.'));
    }
    navigator.geolocation.getCurrentPosition(p => {
      onPosition(p);
      resolve(state.position);
    }, e => {
      onGpsError(e);
      reject(new Error(e.code === 1
        ? 'Allow location for this app to go online. The BiteVo team follows your live position while you work.'
        : 'Your phone can’t find its location. Turn on Location (GPS) and try again.'));
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
  });
}

// The app explains and asks for location access (also "Allow all the time"), then finds one position.
function askTheApp() {
  return new Promise((resolve, reject) => {
    const answer = e => {
      const { position, locationError } = e.detail || {};
      if (!position && !locationError) return;
      window.removeEventListener('bitevo-rider', answer);
      if (locationError) reject(new Error(locationError));
      else resolve(position);
    };
    window.addEventListener('bitevo-rider', answer);
    app.askForLocation();
  });
}

// `onOffline(message)`: the API says this rider is offline (e.g. set offline after a long silence).
export function startTracking(opts = {}) {
  handlers = opts;
  if (state.running) return;
  if (app) {
    set({ running: true, networkProblem: false });
    return app.startTracking();
  }
  if (!('geolocation' in navigator)) return set({ permission: 'unavailable' });
  set({ running: true, networkProblem: false });
  watchId = navigator.geolocation.watchPosition(onPosition, onGpsError, { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 });
  timer = setInterval(tick, 4000);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onNetworkBack);
  keepScreenOn();
  flush(); // the position found while going online
}

export function stopTracking() {
  if (app && state.running) app.stopTracking();
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  clearInterval(timer);
  timer = null;
  document.removeEventListener('visibilitychange', onVisible);
  window.removeEventListener('online', onNetworkBack);
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  queue = [];
  lastQueued = null;
  set({ running: false, queued: 0, networkProblem: false, screenOn: false, lastSentAt: null });
}
