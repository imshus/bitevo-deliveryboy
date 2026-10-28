// Demo data for working without MongoDB: three riders, a few customers and today's orders around
// Sectors 40, 44 and 45 in Gurugram. Only ever written to the local JSON file store; when the API is
// connected to MongoDB (the admin panel's real data) these functions do nothing.
import { store } from '../db/index.js';
import { objectId } from '../lib/ids.js';
import { startOfDay } from '../lib/rules.js';
import { MIN } from '../lib/http.js';

const ZONES = ['North Zone', 'South Zone', 'East Zone', 'West Zone', 'Central'];
const ZONE = 'Central';

export const DEMO_RIDERS = [
  { name: 'Ravi Kumar', phone: '+91 98765 00001', vehicleType: 'Bike', vehicleNumber: 'HR26 DK 4521', kycStatus: 'verified' },
  { name: 'Suresh Yadav', phone: '+91 98765 00003', vehicleType: 'Scooter', vehicleNumber: 'HR26 EF 7788', kycStatus: 'verified' },
  { name: 'Amit Sharma', phone: '+91 98765 00002', vehicleType: 'E-bike', vehicleNumber: 'HR26 GH 1290', kycStatus: 'pending' },
];

const MENU = [
  ['Paneer Butter Masala', 'Food & Meals', 249], ['Butter Naan', 'Food & Meals', 45], ['Veg Biryani', 'Food & Meals', 219],
  ['Chicken Biryani', 'Food & Meals', 279], ['Dal Makhani', 'Food & Meals', 199], ['Cold Coffee', 'Drinks', 99],
  ['Masala Chai', 'Drinks', 39], ['Rajma Chawal Bowl', '1 Item', 149], ['Gulab Jamun (2 pc)', 'Food & Meals', 69],
];

// Drop points (demo positions, roughly in each sector).
const PLACES = [
  { line1: 'House 312, Block C', line2: 'Sector 45, Gurugram', landmark: 'Near Tulip Chowk', area: 'Sector 45', pincode: '122003', lat: 28.4432, lng: 77.0652 },
  { line1: 'B-17, 2nd floor', line2: 'Sector 40, Gurugram', landmark: 'Opposite community centre', area: 'Sector 40', pincode: '122003', lat: 28.4562, lng: 77.0571 },
  { line1: 'Plot 61, Tower 2', line2: 'Sector 44, Gurugram', landmark: 'Behind the metro parking', area: 'Sector 44', pincode: '122003', lat: 28.4486, lng: 77.0779 },
  { line1: 'Flat 704, Green Heights', line2: 'Sector 45, Gurugram', landmark: 'Gate 3', area: 'Sector 45', pincode: '122003', lat: 28.4411, lng: 77.0695 },
  { line1: 'H.No. 1180', line2: 'Sector 40, Gurugram', landmark: 'Near the park', area: 'Sector 40', pincode: '122003', lat: 28.4521, lng: 77.0535 },
];
const CUSTOMERS = [['Priya Mehta', '+91 98111 20451'], ['Rahul Khanna', '+91 98111 37720'], ['Neha Gupta', '+91 98111 51893'], ['Arjun Singh', '+91 98111 64108'], ['Sana Qureshi', '+91 98111 82246']];
const NOTES = ['Please ring the bell twice', '', 'Call when you reach the gate', '', 'Less spicy please'];

const pickItems = n => {
  const start = Math.floor(Math.random() * MENU.length);
  return Array.from({ length: n }, (_, i) => {
    const [name, category, price] = MENU[(start + i * 2) % MENU.length];
    return { productId: objectId(), name, category, price, qty: i === 0 && n < 3 ? 2 : 1 };
  });
};

async function nextOrderNo(now) {
  const seq = (await store.count('orders', { placedAt: { $gte: new Date(startOfDay(now)).toISOString() } })) + 1;
  const d = new Date(now);
  return `BV${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(seq).padStart(3, '0')}`;
}

function demoOrder({ i, now, minsAgo, status, payment, rider, extra = {} }) {
  const at = now - minsAgo * MIN;
  const [customerName, customerPhone] = CUSTOMERS[i % CUSTOMERS.length];
  const items = pickItems(1 + (i % 3));
  const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
  const total = subtotal + 20;
  const place = PLACES[i % PLACES.length];
  return {
    _id: objectId(new Date(at)),
    placedAt: new Date(at).toISOString(),
    customerId: `demo-customer-${i % CUSTOMERS.length}`, customerName, customerPhone,
    items, subtotal, deliveryFee: 20, discount: 0, cashback: 0, couponCode: null, total,
    paymentMethod: payment, walletUsed: payment === 'Cash on delivery' && i % 4 === 3 ? 50 : payment === 'Wallet' ? total : 0,
    status, agentId: rider?._id ?? null, agentName: rider?.name ?? null, zone: ZONE,
    deliveryMins: null, rating: null, isFirstOrder: false, refund: null, history: [],
    address: { label: 'Home', zone: ZONE, mapAddress: `${place.line1}, ${place.line2}`, ...place },
    note: NOTES[i % NOTES.length], source: 'web', demo: true,
    updatedAt: new Date(at).toISOString(),
    ...extra,
  };
}

async function insertOrders(list) {
  for (const o of list) await store.insert('orders', { ...o, orderNo: await nextOrderNo(Date.parse(o.placedAt)) });
}

// Stands in for the kitchen while there's no admin panel on this data: new demo orders are accepted
// (placed → preparing) after two minutes.
export async function demoKitchenTick() {
  if (store.kind !== 'file') return;
  const cutoff = new Date(Date.now() - 2 * MIN).toISOString();
  const waiting = await store.find('orders', { status: 'placed', demo: true, placedAt: { $lt: cutoff } });
  for (const o of waiting) {
    await store.update('orders', o._id, { status: 'preparing', updatedAt: new Date().toISOString() },
      { push: { history: { status: 'preparing', at: new Date().toISOString(), by: 'Demo kitchen' } } });
  }
}

// Adds one new order waiting for a rider (the app's "Add a demo order" button, JSON store only).
export async function addDemoOrder() {
  if (store.kind !== 'file') return null;
  const now = Date.now();
  const i = Math.floor(Math.random() * 1000);
  const o = demoOrder({ i, now, minsAgo: 0, status: 'preparing', payment: i % 2 ? 'Cash on delivery' : 'UPI' });
  await insertOrders([o]);
  return o;
}

export async function seedDemoIfEmpty() {
  if (store.kind !== 'file' || (await store.count('agents'))) return null;
  const now = Date.now();
  const at = new Date(now).toISOString();

  await store.insert('settings', { _id: 'app', zones: ZONES, vehicleTypes: ['Bike', 'Scooter', 'E-bike', 'Bicycle'], updatedAt: at });
  const riders = [];
  for (const r of DEMO_RIDERS) {
    riders.push(await store.insert('agents', { ...r, email: '', zone: ZONE, isActive: true, status: 'offline', demo: true, createdAt: at, updatedAt: at }));
  }
  for (const [name, phone] of CUSTOMERS) await store.insert('customers', { name, phone, createdAt: at, demo: true });
  const [ravi] = riders;

  const delivered = (i, minsAgo, mins, rating) => {
    const o = demoOrder({ i, now, minsAgo, status: 'delivered', payment: i % 2 ? 'Cash on delivery' : 'UPI', rider: ravi });
    return { ...o, deliveredAt: new Date(Date.parse(o.placedAt) + mins * MIN).toISOString(), deliveryMins: mins, rating, ...(o.paymentMethod === 'Cash on delivery' && { cashCollected: o.total - o.walletUsed }) };
  };
  const orders = [
    delivered(1, 300, 28, 5),
    delivered(2, 190, 34, null),
    demoOrder({ i: 0, now, minsAgo: 12, status: 'preparing', payment: 'Cash on delivery', rider: ravi }),
    demoOrder({ i: 1, now, minsAgo: 8, status: 'preparing', payment: 'UPI' }),
    demoOrder({ i: 3, now, minsAgo: 6, status: 'preparing', payment: 'Cash on delivery' }),
    demoOrder({ i: 2, now, minsAgo: 2, status: 'placed', payment: 'Cash on delivery' }),
  ];
  await insertOrders(orders.sort((a, b) => a.placedAt.localeCompare(b.placedAt)));
  return { agents: riders.length, orders: orders.length };
}

// Wipes the JSON store's demo collections and loads fresh demo data (npm run seed -- --reset).
export async function resetDemo() {
  if (store.kind !== 'file') return null;
  for (const name of ['settings', 'agents', 'customers', 'orders', 'walletTxns', 'sessions', 'loginEvents', 'agentOtpCodes', 'riderTrack']) {
    await store.removeMany(name, {});
  }
  return seedDemoIfEmpty();
}
