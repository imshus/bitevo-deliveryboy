// Home: the online switch, the live map (rider, kitchen, drop points), today's numbers, the rider's
// orders and new orders nearby. Polls the API every 10 s and chimes when an order arrives.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { useTracker } from '../lib/tracker.js';
import { usePoll, useNow } from '../lib/hooks.js';
import { alertRider } from '../lib/alerts.js';
import { money, initials, plural } from '../lib/format.js';
import LiveMap from '../components/LiveMap.jsx';
import { OnlineSwitch, LocationLine } from '../components/LiveStatus.jsx';
import { MyOrderCard, OfferCard } from '../components/OrderCard.jsx';
import { BottomNav, Spinner, useToast } from '../components/ui.jsx';
import { Alert, Bag, Plus, Shield } from '../components/Icons.jsx';

export default function Home() {
  const { agent, config } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const tracker = useTracker();
  const now = useNow(30000);
  const online = agent.status !== 'offline';
  const orders = usePoll(() => api.orders(), 10000, [agent.status]);
  const today = usePoll(() => api.today(), 60000, [agent.status]);
  const [accepting, setAccepting] = useState(null);
  const seen = useRef(null);

  const mine = orders.data?.mine || [];
  const available = orders.data?.available || [];

  // A chime and a vibration for each new order assigned to the rider, or offered nearby, and when the kitchen
  // moves one of the rider's orders along in the admin panel (accepted, sent out, cancelled or given to someone else).
  const statuses = useRef(null); // the rider's orders at the last check: id → { status, orderNo }
  useEffect(() => {
    if (!orders.data) return;
    const ids = new Set([...mine, ...available].map(o => o._id));
    if (seen.current) {
      const assigned = mine.find(o => !seen.current.has(o._id));
      const offered = available.find(o => !seen.current.has(o._id));
      if (assigned) {
        alertRider('New order assigned to you', `${assigned.orderNo} · ${assigned.address.area || assigned.address.line2}`);
        toast(`New order assigned: ${assigned.orderNo}`, 'good');
      } else if (offered && online) {
        alertRider('New order near you', `${plural(offered.itemCount, 'item')} · ${offered.address.area || offered.zone}`);
      }
    }
    seen.current = ids;

    const before = statuses.current;
    statuses.current = new Map(mine.map(o => [o._id, { status: o.status, orderNo: o.orderNo }]));
    if (!before) return;
    for (const o of mine) {
      const was = before.get(o._id)?.status;
      if (!was || was === o.status) continue;
      const byKitchen = !/\(delivery app\)/.test(o.history.at(-1)?.by || '');
      if (o.status === 'preparing') {
        alertRider('The kitchen accepted your order', `${o.orderNo} · head to the kitchen to pick it up`);
        toast(`${o.orderNo}: the kitchen accepted it. Head to the kitchen.`, 'good');
      } else if (o.status === 'out_for_delivery' && byKitchen) {
        alertRider('Order sent out', `${o.orderNo} is marked out for delivery`);
        toast(`${o.orderNo} is now out for delivery. Take it to ${o.customerName}.`, 'good');
      }
    }
    for (const [id, was] of before) {
      if (mine.some(o => o._id === id) || was.status === 'out_for_delivery') continue; // still mine, or just delivered
      alertRider('Order taken off your list', `${was.orderNo} was cancelled or given to another rider`);
      toast(`${was.orderNo} was cancelled or given to another rider by the kitchen.`, 'error');
    }
  }, [orders.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const accept = async order => {
    setAccepting(order._id);
    try {
      await api.accept(order._id);
      toast(`${order.orderNo} is yours. Head to the kitchen.`, 'good');
      navigate(`/orders/${order._id}`);
    } catch (err) {
      toast(err.message, 'error');
      orders.reload();
    } finally {
      setAccepting(null);
    }
  };

  const addDemo = async () => {
    try {
      await api.demoOrder();
      orders.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const stops = [
    ...mine.map((o, i) => ({ id: o._id, lat: o.address.lat, lng: o.address.lng, label: `${i + 1}. ${o.customerName}`, number: i + 1, active: true })),
    ...(online ? available.map(o => ({ id: o._id, lat: o.address.lat, lng: o.address.lng, label: `New order · ${o.address.area || o.zone}` })) : []),
  ];
  const blockedReason = !online ? 'Go online to accept' : orders.data?.slotsLeft === 0 ? 'Deliver your orders first' : null;
  const t = today.data;

  return (
    <div className="page page--home">
      <header className="topbar">
        <Link to="/profile" className="who">
          <span className="avatar">{initials(agent.name)}</span>
          <span className="who__text">
            <b>Hi, {agent.name.split(' ')[0]}</b>
            <small>{agent.zone} · {agent.vehicleType}</small>
          </span>
        </Link>
        <OnlineSwitch />
      </header>

      <LiveMap className="map--home" me={online ? tracker.position : null} kitchen={config.kitchen} stops={stops} fitKey="home">
        <div className="map__status"><LocationLine compact /></div>
      </LiveMap>

      <div className="content">
        {!agent.canTakeOrders && (
          <div className="banner banner--warn">
            <Shield size={20} />
            <p>{agent.kycStatus === 'rejected'
              ? 'Your ID check was not approved, so you can’t take orders. Please talk to your BiteVo manager.'
              : 'Your ID check is pending. You can go online and take orders once your BiteVo manager verifies it.'}</p>
          </div>
        )}
        {agent.canTakeOrders && !online && (
          <div className="banner">
            <Alert size={20} />
            <p>You’re offline. Go online to get orders. Your live location is shared only while you’re online.</p>
          </div>
        )}

        <section className="stats" aria-label="Today">
          <div><b>{t ? t.deliveries : '–'}</b><span>Delivered today</span></div>
          <div><b>{t ? money(t.cashCollected) : '–'}</b><span>Cash collected</span></div>
          <div><b>{t ? `${t.km} km` : '–'}</b><span>Travelled</span></div>
        </section>

        <section className="block">
          <h2 className="block__title">Your orders {mine.length > 0 && <span className="count">{mine.length}</span>}</h2>
          {orders.loading && !orders.data ? <div className="center"><Spinner /></div>
            : mine.length ? mine.map((o, i) => <MyOrderCard key={o._id} order={o} number={mine.length > 1 ? i + 1 : null} now={now} />)
            : (
              <div className="empty">
                <Bag size={28} />
                <p>{online ? 'No orders yet. Orders the kitchen gives you appear here, with a chime.' : 'No orders. Go online to start receiving them.'}</p>
              </div>
            )}
        </section>

        {orders.data?.selfAssign && agent.canTakeOrders && (
          <section className="block">
            <h2 className="block__title">New orders near you {available.length > 0 && <span className="count count--live">{available.length}</span>}</h2>
            {available.length
              ? available.map(o => <OfferCard key={o._id} order={o} now={now} onAccept={accept} busy={accepting === o._id} blockedReason={blockedReason} />)
              : <p className="muted small">No orders waiting in {agent.zone} right now.</p>}
          </section>
        )}

        {orders.error && <p className="form-error">{orders.error.message}</p>}

        {config.demo && (
          <button type="button" className="btn btn--ghost btn--block demo-btn" onClick={addDemo}>
            <Plus size={18} /> Add a demo order (test data)
          </button>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
