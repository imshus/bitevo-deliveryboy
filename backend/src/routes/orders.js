// The rider's orders. The kitchen (admin panel) accepts an order (placed → preparing) and assigns a rider,
// or a rider in that zone takes it here when self-assign is on (the panel's switch, else SELF_ASSIGN). The rider then marks it picked up
// (→ out_for_delivery) and delivered, the same steps the panel's buttons make, recorded in the order's
// history so the panel shows who did what.
import express, { Router } from 'express';
import { store } from '../db/index.js';
import { config } from '../config.js';
import { HttpError, badRequest, conflict, forbidden, notFound, nowIso, MIN } from '../lib/http.js';
import { LIVE_STATUSES, BEFORE_PICKUP, cashToCollect, distanceKm, dropPoint, money } from '../lib/rules.js';
import { canTakeOrders, syncAgentStatus } from '../lib/agents.js';
import { finishedOrders, summarize } from '../lib/stats.js';
import { selfAssign } from '../lib/settings.js';
import { imageKind, saveDeliveryPhoto } from '../lib/photos.js';

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
    // The bill only when the rider collects it: paid online or from the wallet, they never see an amount.
    total: cashToCollect(o) > 0 ? o.total : null,
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
    // Proof of delivery: the rider's photos of the handover and the order's barcode label scanned at the door.
    deliveryPhotos: mine ? (o.deliveryPhotos || []).map(ph => ph.url) : [],
    barcodeChecked: mine ? Boolean(o.barcodeCheckedAt) : false,
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
  const self = await selfAssign();
  const offer = self && canTakeOrders(agent);
  const available = offer ? await store.find('orders', availableFilter(agent), { sort: { placedAt: 1 }, limit: 30 }) : [];
  // Out for delivery first, then the oldest.
  const rank = o => (o.status === 'out_for_delivery' ? 0 : 1);
  mine.sort((a, b) => rank(a) - rank(b) || a.placedAt.localeCompare(b.placedAt));
  res.json({
    mine: mine.map(o => riderOrder(o, agent)),
    available: available.map(o => riderOrder(o, agent)),
    selfAssign: self,
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
    || (!order.agentId && (await selfAssign()) && BEFORE_PICKUP.includes(order.status) && (!agent.zone || order.zone === agent.zone)));
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
  if (!(await selfAssign())) throw forbidden('Orders are assigned by the kitchen.');
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
// Proof of delivery, at the door, before "Delivered":
//  1. photos of the handover, taken with the phone's camera (the raw image, shrunk by the app), up to MAX_PHOTOS;
//  2. the barcode on the order's label (the kitchen prints it from the admin panel: the order number),
//     scanned with the camera; another order's label is refused.
// Both are always needed to mark the order delivered in the app (the admin panel can still mark it delivered).
const MAX_PHOTOS = 4;
const photoBody = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '6mb' });
router.post('/:id/photo', photoBody, async (req, res) => {
  const agent = req.agent;
  const order = await ownOrder(req);
  if (order.status !== 'out_for_delivery') throw badRequest('Take the photos when you hand the order over.');
  if ((order.deliveryPhotos || []).length >= MAX_PHOTOS) throw badRequest(`That’s ${MAX_PHOTOS} photos already, which is plenty.`);
  const ext = imageKind(req.body);
  if (!ext) throw badRequest('That isn’t a photo. Take it again with the camera.');
  let url;
  try {
    url = await saveDeliveryPhoto(order, req.body, ext);
  } catch (err) {
    console.error(`Delivery photo for ${order.orderNo} not saved: ${err.message}`);
    throw new HttpError(502, 'The photo couldn’t be saved. Check your internet and try again.');
  }
  const at = nowIso();
  const saved = await store.updateWhere('orders', { _id: order._id, agentId: agent._id, status: 'out_for_delivery' }, { updatedAt: at },
    { push: { deliveryPhotos: { url, at, agentId: agent._id, agentName: agent.name } } });
  if (!saved) throw await whyNot(order._id, agent);
  res.json(riderOrder(saved, agent));
});

// "BV1028-001", " bv1028 001 " and "BV1028001" are the same label.
const labelCode = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

router.post('/:id/scan', async (req, res) => {
  const agent = req.agent;
  const order = await ownOrder(req);
  if (order.status !== 'out_for_delivery') throw badRequest('Scan the label when you hand the order over.');
  const code = labelCode(req.body?.code).slice(0, 60);
  if (!code) throw badRequest('No barcode was read. Try again, holding the label flat and in good light.');
  if (code !== labelCode(order.orderNo)) {
    const other = await store.findOne('orders', { orderNo: { $in: [String(req.body.code).trim().toUpperCase()] } }, { projection: { orderNo: 1 } });
    await store.update('orders', order._id, { barcodeMismatches: (order.barcodeMismatches || 0) + 1 });
    throw badRequest(other
      ? `This label is for order ${other.orderNo}, not ${order.orderNo}. Check you’re handing over the right bag.`
      : `This barcode doesn’t match order ${order.orderNo}. Scan the BiteVo label on the bag.`);
  }
  const saved = await store.updateWhere('orders', { _id: order._id, agentId: agent._id, status: 'out_for_delivery' }, { barcodeCheckedAt: nowIso() });
  if (!saved) throw await whyNot(order._id, agent);
  res.json(riderOrder(saved, agent));
});

router.post('/:id/deliver', async (req, res) => {
  const agent = req.agent;
  const order = await ownOrder(req);
  if (order.status !== 'out_for_delivery') {
    throw badRequest(order.status === 'delivered' ? 'This order is already delivered.' : 'Mark the order picked up first.');
  }
  if (!order.deliveryPhotos?.length) throw badRequest('Take a photo of the order at the door first.');
  if (!order.barcodeCheckedAt) throw badRequest('Scan the barcode on the order’s label first.');
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
