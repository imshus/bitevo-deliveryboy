// A rider's finished orders over the last few days, and what they add up to.
import { store } from '../db/index.js';
import { startOfDay } from './rules.js';

export async function finishedOrders(agentId, days) {
  const since = new Date(startOfDay(Date.now(), days - 1)).toISOString();
  return store.find('orders', { agentId, status: { $in: ['delivered', 'cancelled'] }, placedAt: { $gte: since } }, { sort: { placedAt: -1 }, limit: 500 });
}

export function summarize(orders) {
  const delivered = orders.filter(o => o.status === 'delivered');
  const timed = delivered.filter(o => o.deliveryMins > 0);
  const rated = delivered.filter(o => o.rating > 0);
  const avg = (list, f) => (list.length ? Math.round((list.reduce((s, o) => s + f(o), 0) / list.length) * 10) / 10 : null);
  return {
    deliveries: delivered.length,
    cancelled: orders.length - delivered.length,
    cashCollected: delivered.reduce((s, o) => s + (o.cashCollected || 0), 0),
    avgMins: avg(timed, o => o.deliveryMins),
    avgRating: avg(rated, o => o.rating),
    ratings: rated.length,
  };
}

export const riderStats = async (agentId, days) => summarize(await finishedOrders(agentId, days));
