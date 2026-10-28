// Delivery agents (riders) as the admin panel keeps them: name, phone, zone, vehicle, ID check
// (`kycStatus`), `isActive`, and `status` online / busy (on a delivery) / offline.
import { store } from '../db/index.js';
import { nowIso } from './http.js';
import { phoneDigits } from './rules.js';

export const canTakeOrders = a => a.isActive && a.kycStatus === 'verified';

// What the app gets to know about the signed-in rider.
export const publicAgent = a => ({
  _id: a._id,
  name: a.name,
  phone: a.phone,
  email: a.email || '',
  zone: a.zone,
  vehicleType: a.vehicleType,
  vehicleNumber: a.vehicleNumber || '',
  kycStatus: a.kycStatus,
  canTakeOrders: canTakeOrders(a),
  status: a.status || 'offline',
  location: a.location || null,
});

// The agent with this mobile number, however it was typed into the panel.
export async function findAgentByPhone(phone) {
  const digits = phoneDigits(phone);
  const all = await store.find('agents', {}, { projection: { phone: 1 } });
  const match = all.find(a => phoneDigits(a.phone) === digits);
  return match ? store.findById('agents', match._id) : null;
}

// Online riders carrying an order are "busy" (On delivery in the panel); otherwise "online".
// Offline riders stay offline.
export async function syncAgentStatus(agentId) {
  const agent = await store.findById('agents', agentId);
  if (!agent || agent.status === 'offline') return agent;
  const carrying = await store.count('orders', { agentId, status: 'out_for_delivery' });
  const status = carrying > 0 ? 'busy' : 'online';
  return status === agent.status ? agent : store.update('agents', agentId, { status, updatedAt: nowIso() });
}
