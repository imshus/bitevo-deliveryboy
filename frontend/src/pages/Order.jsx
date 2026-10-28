// One order: a map with the road route to the next stop (the kitchen before pickup, the customer after)
// and the route driven so far; the customer, their address and note, call and navigate buttons, what to
// collect; and the next step (accept → picked up → delivered).
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { useTracker } from '../lib/tracker.js';
import { usePoll, useRoute } from '../lib/hooks.js';
import { alertRider } from '../lib/alerts.js';
import { distanceM, directionsUrl, addressLine, hasPoint } from '../lib/geo.js';
import { money, when, clock, distance, duration, telLink, plural } from '../lib/format.js';
import LiveMap from '../components/LiveMap.jsx';
import { LocationLine } from '../components/LiveStatus.jsx';
import { Sheet, Spinner, StatusChip, useToast } from '../components/ui.jsx';
import { Back, Cash, Check, Navigate, Note, Phone, Pin, Store, Alert, Star } from '../components/Icons.jsx';

const FAR_FROM_DROP_M = 250;

function Steps({ status }) {
  const done = { placed: 1, preparing: 1, out_for_delivery: 2, delivered: 3 }[status] || 0;
  return (
    <ol className="steps">
      {['Accepted', 'Picked up', 'Delivered'].map((label, i) => (
        <li key={label} className={i < done ? 'is-done' : i === done ? 'is-now' : ''}>
          <span>{i < done ? <Check size={14} /> : i + 1}</span>{label}
        </li>
      ))}
    </ol>
  );
}

function Stop({ icon, title, name, lines, phone, phoneLabel, navUrl, far }) {
  return (
    <div className="stop">
      <div className="stop__icon">{icon}</div>
      <div className="stop__body">
        <small>{title}</small>
        <b>{name}</b>
        {lines.filter(Boolean).map(l => <span key={l}>{l}</span>)}
        {far != null && <span className="stop__far">{distance(far)} from you</span>}
      </div>
      <div className="stop__actions">
        {phone && <a className="round-btn" href={telLink(phone)} aria-label={phoneLabel}><Phone size={20} /></a>}
        {navUrl && <a className="round-btn round-btn--primary" href={navUrl} target="_blank" rel="noreferrer" aria-label="Navigate"><Navigate size={20} /></a>}
      </div>
    </div>
  );
}

export default function OrderPage() {
  const { id } = useParams();
  const { agent, config, refresh } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const tracker = useTracker();
  const online = agent.status !== 'offline';
  const order = usePoll(() => api.order(id), 10000, [id]);
  const o = order.data;
  const carrying = o?.mine && o.status === 'out_for_delivery';
  const track = usePoll(() => (carrying ? api.track(id) : Promise.resolve(null)), 20000, [id, carrying]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'deliver' | 'release'
  const [cashOk, setCashOk] = useState(false);
  const lastStatus = useRef(null);

  // The kitchen cancelled it while the rider was looking at it.
  useEffect(() => {
    if (!o) return;
    if (lastStatus.current && lastStatus.current !== 'cancelled' && o.status === 'cancelled') {
      alertRider('Order cancelled', `${o.orderNo} was cancelled by the kitchen.`);
    }
    lastStatus.current = o.status;
  }, [o?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const me = online ? tracker.position : null;
  const kitchen = config.kitchen;
  const drop = hasPoint(o?.address) ? { lat: o.address.lat, lng: o.address.lng } : null;
  const beforePickup = o && ['placed', 'preparing'].includes(o.status);
  // The leg the rider is on: to the kitchen, then to the customer. For an order on offer: kitchen → customer.
  const [from, to] = !o ? [null, null]
    : !o.mine ? (beforePickup ? [kitchen, drop] : [null, null])
    : beforePickup ? (me ? [me, kitchen] : [kitchen, drop])
    : carrying ? [me || kitchen, drop]
    : [null, null];
  const route = useRoute(from, to);
  const trail = carrying ? [...(track.data?.points || []).map(p => [p.lat, p.lng]), ...(me ? [[me.lat, me.lng]] : [])] : null;
  const fromDrop = me && drop ? distanceM(me, drop) : null;

  const run = async (step, done) => {
    setBusy(true);
    try {
      const result = await step();
      await done?.(result);
    } catch (err) {
      toast(err.message, 'error');
      order.reload();
    } finally {
      setBusy(false);
    }
  };

  const accept = () => run(() => api.accept(id), async () => {
    toast(`${o.orderNo} is yours. Head to the kitchen.`, 'good');
    await order.reload();
  });
  const pickup = () => run(() => api.pickup(id), async () => {
    toast('Picked up. Head to the customer.', 'good');
    await Promise.all([order.reload(), refresh()]);
  });
  const deliver = () => run(() => api.deliver(id, { cashCollected: o.cashToCollect || undefined, lat: me?.lat, lng: me?.lng }), async () => {
    setConfirm(null);
    toast(o.cashToCollect ? `Delivered. ${money(o.cashToCollect)} cash collected.` : 'Delivered. Great job!', 'good');
    await refresh();
    navigate('/');
  });
  const release = () => run(() => api.release(id), async () => {
    setConfirm(null);
    toast(`${o.orderNo} handed back to the kitchen.`);
    navigate('/');
  });

  if (order.loading && !o) return <div className="page center-page"><Spinner /></div>;
  if (!o) {
    return (
      <div className="page center-page">
        <Alert size={32} />
        <p>{order.error?.message || 'This order isn’t available any more.'}</p>
        <Link to="/" className="btn btn--primary">Back to home</Link>
      </div>
    );
  }

  const cash = o.cashToCollect;
  const legLabel = beforePickup && o.mine && me ? 'to the kitchen' : 'to the customer';

  return (
    <div className="page page--order">
      <LiveMap className="map--order" me={me} kitchen={kitchen} route={route} trail={trail} fitKey={`${o._id}:${o.status}`}
        stops={drop ? [{ id: o._id, ...drop, label: o.customerName, active: true }] : []}>
        <button type="button" className="map__back" onClick={() => navigate(-1)} aria-label="Back"><Back /></button>
        {route && to && (
          <div className="eta">
            <b>{duration(route.durationS)}</b> · {distance(route.distanceM)}{route.straight ? ' approx.' : ''} {legLabel}
          </div>
        )}
        {o.mine && <div className="map__status"><LocationLine compact /></div>}
      </LiveMap>

      <div className="panel">
        <div className="panel__head">
          <div>
            <h1>{o.orderNo}</h1>
            <small>Placed {when(o.placedAt)} · {plural(o.itemCount, 'item')}</small>
          </div>
          <StatusChip status={o.status} />
        </div>

        {o.mine && o.status !== 'cancelled' && <Steps status={o.status} />}

        {o.status === 'cancelled' && (
          <div className="banner banner--bad"><Alert size={20} /><p>The kitchen cancelled this order{o.cancelReason ? `: ${o.cancelReason}` : ''}. Don’t deliver it; return any food to the kitchen.</p></div>
        )}
        {o.mine && o.status === 'placed' && (
          <div className="banner"><Store size={20} /><p>The kitchen hasn’t accepted this order yet. You can head over; pickup opens once it’s being prepared.</p></div>
        )}

        {o.mine && beforePickup && kitchen && (
          <Stop icon={<Store />} title="Pick up from" name={kitchen.name} lines={[kitchen.address]}
            phone={kitchen.phone} phoneLabel="Call the kitchen" navUrl={directionsUrl(kitchen)} far={me ? distanceM(me, kitchen) : null} />
        )}
        {o.mine ? (
          <Stop icon={<Pin />} title={o.status === 'delivered' ? 'Delivered to' : 'Deliver to'} name={o.customerName}
            lines={[addressLine(o.address), o.address.landmark && `Landmark: ${o.address.landmark}`]}
            phone={['delivered', 'cancelled'].includes(o.status) ? null : o.customerPhone} phoneLabel="Call the customer"
            navUrl={['delivered', 'cancelled'].includes(o.status) ? null : directionsUrl(drop, addressLine(o.address))}
            far={carrying ? fromDrop : null} />
        ) : (
          <Stop icon={<Pin />} title="Deliver to" name={o.address.area || o.address.line2 || o.zone}
            lines={[o.tripKm != null ? `${o.tripKm} km from the kitchen` : '', 'Full address and phone number show once you accept.']} />
        )}
        {o.mine && carrying && !drop && (
          <p className="muted small">This customer typed their address without a map pin. Use Navigate (it searches the address) or call them.</p>
        )}

        {o.note && <div className="note"><Note size={18} /><p>“{o.note}”</p></div>}

        <div className="card">
          <h3 className="card__title">Items</h3>
          <ul className="items">
            {o.items.map((it, i) => <li key={i}><span className="items__qty">{it.qty}×</span>{it.name}</li>)}
          </ul>
        </div>

        <div className={`paybox ${cash > 0 ? 'paybox--cash' : 'paybox--paid'}`}>
          <Cash size={26} />
          {cash > 0 ? (
            <div><b>Collect {money(cash)} in cash</b><span>Cash on delivery{o.walletUsed > 0 ? ` · ${money(o.walletUsed)} already paid from wallet` : ''}</span></div>
          ) : (
            <div><b>Paid online · don’t collect cash</b><span>{o.paymentMethod} · bill {money(o.total)}</span></div>
          )}
        </div>

        {o.status === 'delivered' && (
          <div className="card done">
            <Check size={22} />
            <div>
              <b>Delivered at {clock(o.deliveredAt)}</b>
              <span>{o.deliveryMins} min after the order{o.cashCollected ? ` · ${money(o.cashCollected)} cash collected` : ''}</span>
              {o.rating && <span className="stars"><Star size={14} /> Rated {o.rating} by the customer</span>}
            </div>
          </div>
        )}
      </div>

      {/* The next step, always within thumb reach. */}
      {(beforePickup || carrying) && (
        <div className="actionbar">
          {!o.mine && (
            <button type="button" className="btn btn--primary btn--block btn--lg" disabled={busy || !online} onClick={accept}>
              {busy ? <Spinner /> : online ? 'Accept order' : 'Go online to accept'}
            </button>
          )}
          {o.mine && beforePickup && (
            <>
              <button type="button" className="btn btn--primary btn--block btn--lg" disabled={busy || o.status === 'placed'} onClick={pickup}>
                {busy ? <Spinner /> : o.status === 'placed' ? 'Waiting for the kitchen' : 'Picked up from kitchen'}
              </button>
              <button type="button" className="btn btn--ghost btn--block" disabled={busy} onClick={() => setConfirm('release')}>Can’t take it? Hand it back</button>
            </>
          )}
          {carrying && (
            <button type="button" className="btn btn--good btn--block btn--lg" disabled={busy} onClick={() => { setCashOk(false); setConfirm('deliver'); }}>
              <Check size={20} /> Mark delivered
            </button>
          )}
        </div>
      )}

      {confirm === 'deliver' && (
        <Sheet title={`Deliver ${o.orderNo}?`} onClose={() => setConfirm(null)}>
          {fromDrop != null && fromDrop > FAR_FROM_DROP_M && (
            <p className="banner banner--warn"><Alert size={18} /> You’re {distance(fromDrop)} from the customer’s pin. Only confirm once you’ve handed the order over.</p>
          )}
          {cash > 0 ? (
            <label className="check">
              <input type="checkbox" checked={cashOk} onChange={e => setCashOk(e.target.checked)} />
              <span>I collected <b>{money(cash)}</b> in cash from {o.customerName.split(' ')[0]}</span>
            </label>
          ) : <p className="muted">Paid online. There’s nothing to collect.</p>}
          <button type="button" className="btn btn--good btn--block btn--lg" disabled={busy || (cash > 0 && !cashOk)} onClick={deliver}>
            {busy ? <Spinner /> : 'Confirm delivery'}
          </button>
          <button type="button" className="btn btn--ghost btn--block" onClick={() => setConfirm(null)}>Not yet</button>
        </Sheet>
      )}
      {confirm === 'release' && (
        <Sheet title="Hand this order back?" onClose={() => setConfirm(null)}>
          <p className="muted">The kitchen gets it back to give to another rider. Only do this if you can’t pick it up.</p>
          <button type="button" className="btn btn--danger btn--block btn--lg" disabled={busy} onClick={release}>{busy ? <Spinner /> : 'Hand it back'}</button>
          <button type="button" className="btn btn--ghost btn--block" onClick={() => setConfirm(null)}>Keep it</button>
        </Sheet>
      )}
    </div>
  );
}
