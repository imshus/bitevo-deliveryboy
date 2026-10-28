// The signed-in rider: going online / offline, live location from the phone's GPS, and today's numbers.
//
// Live location: while online the app sends its position every few seconds (POST /location, a few
// points at a time when the network was down). The latest one is kept on the agent (`location`), and
// while an order is out for delivery also on the order (`riderLocation`) and in `riderTrack`, so the
// route driven can be drawn later. `odometer` adds up today's distance.
import { Router } from 'express';
import { store } from '../db/index.js';
import { config } from '../config.js';
import { conflict, forbidden, nowIso, MIN } from '../lib/http.js';
import { LIVE_STATUSES, distanceKm, dayKey, serialize } from '../lib/rules.js';
import { canTakeOrders, publicAgent, syncAgentStatus } from '../lib/agents.js';
import { riderStats } from '../lib/stats.js';

export const router = Router();

const MAX_POINTS = 60;
const GOOD_FIX_M = 50; // fixes less accurate than this don't count towards the distance travelled
const TRACK_FIX_M = 100; // or go into an order's route
const STEP_M = 25; // distance is added in steps of at least this much, so GPS jitter while waiting adds nothing

router.post('/status', async (req, res) => {
  const agent = req.agent;
  const at = nowIso();
  if (req.body?.online === true) {
    if (!canTakeOrders(agent)) {
      throw forbidden(agent.kycStatus === 'rejected'
        ? 'Your ID check was not approved, so you can’t go online. Please contact your BiteVo manager.'
        : 'Your ID check isn’t finished yet. You can go online once your BiteVo manager verifies it.');
    }
    if (agent.status === 'offline') await store.update('agents', agent._id, { status: 'online', onlineVia: 'app', onlineAt: at, updatedAt: at });
    return res.json({ agent: publicAgent(await syncAgentStatus(agent._id)) });
  }

  const active = await store.count('orders', { agentId: agent._id, status: { $in: LIVE_STATUSES } });
  if (active) {
    throw conflict(active === 1
      ? 'You still have an order. Deliver it (or hand it back before pickup) before going offline.'
      : `You still have ${active} orders. Deliver them (or hand them back before pickup) before going offline.`);
  }
  const saved = await store.update('agents', agent._id, { status: 'offline', onlineVia: null, updatedAt: at });
  res.json({ agent: publicAgent(saved) });
});

function cleanPoint(p, now) {
  const lat = Number(p?.lat);
  const lng = Number(p?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  const t = Date.parse(p?.at);
  const at = Number.isFinite(t) && t <= now + MIN && t >= now - 6 * 60 * MIN ? t : now;
  const opt = (v, max) => {
    const n = Number(v);
    return v != null && Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 10) / 10 : null;
  };
  return {
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    accuracy: opt(p.accuracy, 100000),
    heading: opt(p.heading, 360),
    speed: opt(p.speed, 100), // m/s
    at: new Date(at).toISOString(),
  };
}

const goodFix = (p, limit) => p.accuracy == null || p.accuracy <= limit;

// Adds the distance between good fixes, in steps of at least STEP_M, to today's odometer.
function addDistance(odometer, points) {
  const today = dayKey();
  const odo = odometer?.day === today ? { ...odometer } : { day: today, km: 0, anchor: null };
  for (const p of points) {
    if (!goodFix(p, GOOD_FIX_M)) continue;
    const a = odo.anchor;
    if (!a) { odo.anchor = { lat: p.lat, lng: p.lng, at: p.at }; continue; }
    const km = distanceKm(a, p);
    const hours = (Date.parse(p.at) - Date.parse(a.at)) / 3600000;
    if (km * 1000 < STEP_M) continue;
    // Skips jumps no bike could make (a bad fix, or the phone was off for a long ride).
    if (hours > 0 && km / hours <= 120 && km < 5) odo.km = Math.round((odo.km + km) * 1000) / 1000;
    odo.anchor = { lat: p.lat, lng: p.lng, at: p.at };
  }
  return odo;
}

router.post('/location', async (req, res) => {
  const now = Date.now();
  const raw = Array.isArray(req.body?.points) ? req.body.points : [req.body];
  const points = raw.slice(-MAX_POINTS).map(p => cleanPoint(p, now)).filter(Boolean).sort((a, b) => a.at.localeCompare(b.at));

  const result = await serialize(req.agent._id, async () => {
    const agent = await store.findById('agents', req.agent._id);
    // Offline (gone offline on another phone, or set offline by the panel or for sending nothing for a while).
    if (agent.status === 'offline') return { status: 'offline' };
    const fresh = points.filter(p => !agent.location?.at || p.at > agent.location.at);
    if (!fresh.length) return { status: agent.status };

    const latest = fresh.at(-1);
    await store.update('agents', agent._id, { location: latest, odometer: addDistance(agent.odometer, fresh), onlineVia: 'app' });

    const carrying = await store.find('orders', { agentId: agent._id, status: 'out_for_delivery' }, { projection: { _id: 1 } });
    const track = fresh.filter(p => goodFix(p, TRACK_FIX_M));
    for (const o of carrying) {
      await store.update('orders', o._id, { riderLocation: latest });
      if (track.length) await store.insertMany('riderTrack', track.map(p => ({ orderId: o._id, agentId: agent._id, lat: p.lat, lng: p.lng, accuracy: p.accuracy, at: p.at })));
    }
    return { status: agent.status };
  });

  if (result.status === 'offline') throw conflict('You’re offline, so your location isn’t being shared. Go online to start again.', { status: 'offline' });
  res.json({ ok: true, status: result.status });
});

router.get('/today', async (req, res) => {
  const agent = await store.findById('agents', req.agent._id);
  const stats = await riderStats(agent._id, 1);
  const km = agent.odometer?.day === dayKey() ? agent.odometer.km : 0;
  res.json({ ...stats, km: Math.round(km * 10) / 10, onlineAt: agent.status !== 'offline' ? agent.onlineAt || null : null, offlineAfterMins: config.offlineAfterMins });
});
