// The rider's orders. The kitchen (admin panel) accepts an order (placed → preparing) and assigns a rider,
// or a rider in that zone takes it here (SELF_ASSIGN). The rider then marks it picked up
// (→ out_for_delivery) and delivered, the same steps the panel's buttons make, recorded in the order's
// history so the panel shows who did what.
import { Router } from 'express';
import { store } from '../db/index.js';
import { config } from '../config.js';
import { badRequest, conflict, forbidden, notFound, nowIso, MIN } from '../lib/http.js';
import { LIVE_STATUSES, BEFORE_PICKUP, cashToCollect, distanceKm, dropPoint, money } from '../lib/rules.js';
import { canTakeOrders, syncAgentStatus } from '../lib/agents.js';
import { finishedOrders, summarize } from '../lib/stats.js';

export const router = Router();

const AVAILABLE_FOR_MS = 12 * 60 * MIN; // older unassigned orders aren't offered to riders
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const firstName = name => String(name || '').trim().split(/\s+/)[0] || 'Customer';

// What a rider sees of an order. Riders see the customer's name, number, exact address and note only
// for their own orders; other riders' orders aren't visible at all.
function riderOrder(o, agent) {
  const mine = o.agentId === agent._id;
  const drop = dropPoint(o);
  const a = o.address || {};
  return {
    _id: o._id,
    orderNo: o.orderNo,
    placedAt: o.placedAt,
    status: o.status,
    mine,
    zone: o.zone,
    items: (o.items || []).map(it => ({ name: it.name, qty: it.qty })),
    itemCount: (o.items || []).reduce((s, it) => s + (it.qty || 1), 0),
    total: o.total,
    paymentMethod: o.paymentMethod,
    walletUsed: o.walletUsed || 0,
    cashToCollect: cashToCollect(o),
    customerName: mine ? o.customerName : firstName(o.customerName),
    customerPhone: mine ? o.customerPhone : null,
    address: mine
      ? { label: a.label || '', line1: a.line1 || '', line2: a.line2 || '', landmark: a.landmark || '', area: a.area || '', pincode: a.pincode || '', mapAddress: a.mapAddress || '', ...(drop || {}) }
      : { line2: a.line2 || '', area: a.area || '', ...(drop && { lat: round(drop.lat, 3), lng: round(drop.lng, 3) }) },
    note: mine ? o.note || '' : '',
    tripKm: config.kitchen && drop ? round(distanceKm(config.kitchen, drop)) : null,
    dispatchedAt: o.dispatchedAt || null,
    deliveredAt: o.deliveredAt || null,
    deliveryMins: o.deliveryMins ?? null,
    cashCollected: o.cashCollected ?? null,
    rating: o.rating ?? null,
    cancelledAt: mine ? o.cancelledAt || null : null,
    cancelReason: mine ? o.cancelReason || null : null,
    history: mine ? (o.history || []).map(h => ({ status: h.status, note: h.note || '', at: h.at, by: h.by || '' })) : [],
  };
}

const availableFilter = agent => ({
  agentId: null,
  status: { $in: BEFORE_PICKUP },
  placedAt: { $gte: new Date(Date.now() - AVAILABLE_FOR_MS).toISOString() },
  ...(agent.zone && { zone: agent.zone }),
});

const historyEvent = (agent, event) => ({ ...event, at: nowIso(), by: `${agent.name} (delivery app)` });

// The rider's own order (any status), or 404.
async function ownOrder(req) {
  const order = await store.findById('orders', req.params.id);
  if (!order || order.agentId !== req.agent._id) throw notFound('This order isn’t assigned to you any more.');
  return order;
}

// Explains why a step couldn't be made, after the order changed under the rider.
async function whyNot(id, agent) {
  const now = await store.findById('orders', id);
  if (!now) return notFound('This order no longer exists.');
  if (now.status === 'cancelled') return conflict('This order was cancelled.');
  if (now.agentId && now.agentId !== agent._id) return conflict(`This order is now with ${now.agentName || 'another rider'}.`);
  if (now.status === 'delivered') return conflict('This order is already delivered.');
  if (now.agentId === agent._id) return conflict('This order is already yours.');
  return conflict('This order changed. Refresh and try again.');
}

router.get('/', async (req, res) => {
  const agent = req.agent;
  const mine = await store.find('orders', { agentId: agent._id, status: { $in: LIVE_STATUSES } }, { sort: { placedAt: 1 } });
  const offer = config.selfAssign && canTakeOrders(agent);
  const available = offer ? await store.find('orders', availableFilter(agent), { sort: { placedAt: 1 }, limit: 30 }) : [];
  // Out for delivery first, then the oldest.
  const rank = o => (o.status === 'out_for_delivery' ? 0 : 1);
  mine.sort((a, b) => rank(a) - rank(b) || a.placedAt.localeCompare(b.placedAt));
  res.json({
    mine: mine.map(o => riderOrder(o, agent)),
    available: available.map(o => riderOrder(o, agent)),
    selfAssign: config.selfAssign,
    slotsLeft: Math.max(0, config.maxActiveOrders - mine.length),
  });
});

// Finished orders of the last `days` days (1 = today), with totals.
router.get('/history', async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 1, 1), 30);
  const orders = await finishedOrders(req.agent._id, days);
  res.json({ days, ...summarize(orders), orders: orders.map(o => riderOrder(o, req.agent)) });
});

router.get('/:id', async (req, res) => {
  const order = await store.findById('orders', req.params.id);
  const agent = req.agent;
  const visible = order && (order.agentId === agent._id
    || (config.selfAssign && !order.agentId && BEFORE_PICKUP.includes(order.status) && (!agent.zone || order.zone === agent.zone)));
  if (!visible) throw notFound('This order isn’t available any more.');
  res.json(riderOrder(order, agent));
});

// The route driven so far while the order was out for delivery (at most ~400 points).
router.get('/:id/track', async (req, res) => {
  const order = await ownOrder(req);
  const points = await store.find('riderTrack', { orderId: order._id }, { sort: { at: 1 }, limit: 5000 });
  const every = Math.max(1, Math.ceil(points.length / 400));
  const thin = points.filter((p, i) => i % every === 0 || i === points.length - 1);
  res.json({ points: thin.map(p => ({ lat: p.lat, lng: p.lng, at: p.at })) });
});

router.post('/:id/accept', async (req, res) => {
  const agent = req.agent;
  if (!config.selfAssign) throw forbidden('Orders are assigned by the kitchen.');
  if (!canTakeOrders(agent)) throw forbidden('You can take orders once your ID check is verified.');
  if (agent.status === 'offline') throw badRequest('Go online first to take orders.');
  const active = await store.count('orders', { agentId: agent._id, status: { $in: LIVE_STATUSES } });
  if (active >= config.maxActiveOrders) throw badRequest(`You can carry up to ${config.maxActiveOrders} orders at a time. Deliver one first.`);

  const saved = await store.updateWhere('orders', { ...availableFilter(agent), _id: req.params.id },
    { agentId: agent._id, agentName: agent.name, zone: agent.zone, updatedAt: nowIso() },
    { push: { history: historyEvent(agent, { status: 'assigned', note: agent.name }) } });
  if (!saved) throw await whyNot(req.params.id, agent);
  res.json(riderOrder(saved, agent));
});

// Hands an order back before pickup, so the kitchen (or another rider) can give it to someone else.
router.post('/:id/release', async (req, res) => {
  const agent = req.agent;
  const saved = await store.updateWhere('orders', { _id: req.params.id, agentId: agent._id, status: { $in: BEFORE_PICKUP } },
    { agentId: null, agentName: null, updatedAt: nowIso() },
    // The panel shows this as "Assigned to no one (handed back by …)".
    { push: { history: historyEvent(agent, { status: 'assigned', note: `no one (handed back by ${agent.name})` }) } });
  if (!saved) {
    const order = await store.findById('orders', req.params.id);
    if (order?.agentId === agent._id && order.status === 'out_for_delivery') throw conflict('You’ve picked this order up already. Please deliver it, or call the kitchen.');
    throw await whyNot(req.params.id, agent);
  }
  res.json({ ok: true });
});

router.post('/:id/pickup', async (req, res) => {
  const agent = req.agent;
  const order = await ownOrder(req);
  if (order.status === 'placed') throw badRequest('The kitchen hasn’t accepted this order yet. Wait until it’s being prepared.');
  if (agent.status === 'offline') throw badRequest('Go online first, so the customer can follow you.');

  const saved = await store.updateWhere('orders', { _id: order._id, agentId: agent._id, status: 'preparing' },
    { status: 'out_for_delivery', dispatchedAt: nowIso(), updatedAt: nowIso() },
    { push: { history: historyEvent(agent, { status: 'out_for_delivery', note: 'Picked up' }) } });
  if (!saved) throw await whyNot(order._id, agent);
  await syncAgentStatus(agent._id);
  res.json(riderOrder(saved, agent));
});

// `cashCollected`: on cash orders, the amount the rider confirms they took (must be the amount due).
// `lat`/`lng`: where the rider was, kept with the order.
router.post('/:id/deliver', async (req, res) => {
  const agent = req.agent;
  const order = await ownOrder(req);
  if (order.status !== 'out_for_delivery') {
    throw badRequest(order.status === 'delivered' ? 'This order is already delivered.' : 'Mark the order picked up first.');
  }
  const due = cashToCollect(order);
  if (due > 0 && Number(req.body?.cashCollected) !== due) throw badRequest(`Collect ${money(due)} in cash, then confirm.`);

  const at = nowIso();
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  const drop = dropPoint(order);
  const where = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { lat: round(lat, 6), lng: round(lng, 6), ...(drop && { metresFromDrop: Math.round(distanceKm({ lat, lng }, drop) * 1000) }) }
    : null;

  const saved = await store.updateWhere('orders', { _id: order._id, agentId: agent._id, status: 'out_for_delivery' }, {
    status: 'delivered',
    deliveredAt: at,
    deliveryMins: Math.max(1, Math.round((Date.now() - Date.parse(order.placedAt)) / MIN)),
    ...(due > 0 && { cashCollected: due }),
    deliveredFrom: where,
    updatedAt: at,
  }, { push: { history: historyEvent(agent, { status: 'delivered', note: 'Delivery app' }) } });
  if (!saved) throw await whyNot(order._id, agent);

  // Coupon cashback goes to the customer's wallet on delivery, exactly as the panel's "Delivered" button does.
  if (order.cashback > 0) {
    await store.insert('walletTxns', {
      customerId: order.customerId, customerName: order.customerName, customerPhone: order.customerPhone,
      orderId: order._id, type: 'cashback', amount: order.cashback, note: `${order.couponCode} on order ${order.orderNo}`, at,
    });
  }
  await syncAgentStatus(agent._id);
  res.json(riderOrder(saved, agent));
});
