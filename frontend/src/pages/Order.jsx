// One order: a map with the road route to the next stop (the kitchen before pickup, the customer after)
// and the route driven so far; the customer, their address and note, call and navigate buttons, what to
// collect (an amount only when the customer pays on delivery: cash, or UPI to BiteVo's QR code shown on the
// rider's phone); and the next step (accept → picked up → delivered). Delivering takes proof at the door:
// camera photos of the handover (lib/proof.js).
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
import { Back, Camera, Cash, Check, Navigate, Note, Phone, Pin, Store, Alert, Star } from '../components/Icons.jsx';
import { shrinkPhoto } from '../lib/proof.js';
// BiteVo's Razorpay UPI QR code (any UPI app; the customer types the amount). Cropped from Razorpay's poster.
import upiQr from '../assets/upi-qr.png';

const FAR_FROM_DROP_M = 250;
// Photos at the door: at least MIN_PHOTOS before "Delivered", up to MAX_PHOTOS (the API checks the same numbers).
const MIN_PHOTOS = 4;
const MAX_PHOTOS = 6;

// At the door, on a pay-on-delivery order: how the customer pays the amount due. Cash, or UPI: the rider
// shows BiteVo's QR code, the customer pays the exact amount with any UPI app, and the rider confirms once
// the customer's phone shows it paid (the UPI reference from that screen is optional).
function PayAtDoor({ amount, name, pay, setPay }) {
  const first = name.split(' ')[0];
  const set = change => setPay(p => ({ ...p, ...change }));
  return (
    <div className="payat">
      <b className="payat__title">{first} pays {money(amount)}</b>
      <div className="segmented segmented--2" role="tablist" aria-label="How the customer pays">
        <button type="button" role="tab" aria-selected={pay.by === 'cash'} className={pay.by === 'cash' ? 'is-on' : ''} onClick={() => set({ by: 'cash', ok: false })}>
          <Cash size={16} /> Cash
        </button>
        <button type="button" role="tab" aria-selected={pay.by === 'upi'} className={pay.by === 'upi' ? 'is-on' : ''} onClick={() => set({ by: 'upi', ok: false })}>
          <QrIcon /> UPI · show QR
        </button>
      </div>
      {pay.by === 'upi' ? (
        <>
          <div className="upi">
            <span className="upi__to">Pay to <b>BiteVo</b></span>
            <img className="upi__qr" src={upiQr} alt="BiteVo UPI QR code" width="448" height="448" />
            <span className="upi__amount">{money(amount)}</span>
            <span className="upi__apps">Scan with any UPI app: Google Pay, PhonePe, Paytm, BHIM…</span>
          </div>
          <p className="muted small">Ask {first} to scan it and enter exactly <b>{money(amount)}</b>. Wait until their phone shows the payment as successful.</p>
          <label className="field">
            <span>UPI reference no. <small className="muted">(optional, from {first}’s payment screen)</small></span>
            <input type="text" inputMode="numeric" autoComplete="off" maxLength={40} placeholder="e.g. 431298765012"
              value={pay.ref} onChange={e => set({ ref: e.target.value })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={pay.ok} onChange={e => set({ ok: e.target.checked })} />
            <span>I saw <b>{money(amount)}</b> paid by UPI on {first}’s phone</span>
          </label>
        </>
      ) : (
        <label className="check">
          <input type="checkbox" checked={pay.ok} onChange={e => set({ ok: e.target.checked })} />
          <span>I collected <b>{money(amount)}</b> in cash from {first}</span>
        </label>
      )}
    </div>
  );
}

const QrIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" />
  </svg>
);

// At the door: photos of the handover, each saved on the order straight away, so `o` always says what's done.
// Several can be picked at once where the phone allows it; in the app each tap takes one with the camera.
function Proof({ o, onSaved }) {
  const photoInput = useRef(null);
  const [uploading, setUploading] = useState(0); // photos still being sent
  const [error, setError] = useState('');
  const photos = o.deliveryPhotos || [];
  const left = Math.max(0, MIN_PHOTOS - photos.length);

  const addPhotos = async e => {
    const files = [...(e.target.files || [])].slice(0, MAX_PHOTOS - photos.length);
    e.target.value = '';
    if (!files.length) return;
    setError('');
    setUploading(files.length);
    try {
      for (const file of files) {
        await api.deliveryPhoto(o._id, await shrinkPhoto(file));
        setUploading(n => n - 1);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(0);
      await onSaved().catch(() => {});
    }
  };

  return (
    <div className="proof">
      <div className={`proof__step${left ? '' : ' is-done'}`}>
        <b>
          Photos of the handover
          <span className="proof__count">{photos.length} of {MIN_PHOTOS}{photos.length > MIN_PHOTOS ? '+' : ''}</span>
        </b>
        <p className="muted small">
          {left ? `Take at least ${MIN_PHOTOS}: the order, the door or house number, and the customer receiving it. ${left} more to go.`
            : 'Enough photos. You can add more if something needs showing.'}
        </p>
        <div className="proof__photos">
          {photos.map(src => <img key={src} src={src} alt="Delivery photo" />)}
          {photos.length < MAX_PHOTOS && (
            <button type="button" className="proof__add" disabled={uploading > 0} onClick={() => photoInput.current.click()}>
              {uploading ? <Spinner /> : <><Camera size={22} />{photos.length ? 'Add another' : 'Take photo'}</>}
            </button>
          )}
        </div>
        <input ref={photoInput} type="file" accept="image/*" capture="environment" multiple hidden onChange={addPhotos} />
      </div>
      {error && <p className="banner banner--warn"><Alert size={18} /> {error}</p>}
    </div>
  );
}

// The rider's two stages: first to the kitchen to pick the order up, then to the customer to deliver it.
function Steps({ status }) {
  const done = { placed: 0, preparing: 0, out_for_delivery: 1, delivered: 3 }[status] || 0;
  return (
    <ol className="steps">
      {['Pick up from kitchen', 'Deliver to customer', 'Delivered'].map((label, i) => (
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
  // Payment at the door (pay-on-delivery orders): cash or UPI, confirmed by the rider.
  const [pay, setPay] = useState({ by: 'cash', ok: false, ref: '' });
  const openDeliver = by => { setPay({ by, ok: false, ref: '' }); setConfirm('deliver'); };
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
  const byUpi = o?.cashToCollect > 0 && pay.by === 'upi';
  const paid = !o?.cashToCollect ? {}
    : byUpi ? { paidVia: 'upi', upiCollected: o.cashToCollect, upiRef: pay.ref.trim() || undefined }
    : { cashCollected: o.cashToCollect };
  const deliver = () => run(() => api.deliver(id, { ...paid, lat: me?.lat, lng: me?.lng }), async () => {
    setConfirm(null);
    toast(!o.cashToCollect ? 'Delivered. Great job!'
      : byUpi ? `Delivered. ${money(o.cashToCollect)} paid by UPI.` : `Delivered. ${money(o.cashToCollect)} collected in cash.`, 'good');
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
  const photoCount = o.deliveryPhotos?.length || 0;
  const proofDone = photoCount >= MIN_PHOTOS;
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
          <Stop icon={<Pin />} title="Deliver to" name={o.address.area || o.address.line2}
            lines={[o.tripKm != null ? `${o.tripKm} km from the kitchen` : '', 'Full address and phone number show once you accept.']} />
        )}
        {o.mine && o.dropIgnoredKm != null && !['delivered', 'cancelled'].includes(o.status) ? (
          <div className="banner banner--warn">
            <Alert size={20} />
            <p>The location saved with this address is {o.dropIgnoredKm} km from the kitchen, so it can’t be right and isn’t used. Go by the address above: Navigate searches it. Call {o.customerName.split(' ')[0]} if you can’t find it.</p>
          </div>
        ) : o.mine && carrying && !drop && (
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
            <div><b>Collect {money(cash)}</b><span>Pay on delivery · cash or UPI (show the BiteVo QR)</span></div>
          ) : (
            <div><b>Paid online · nothing to collect</b><span>Don’t take any money for this order</span></div>
          )}
          {carrying && cash > 0 && (
            <button type="button" className="paybox__upi" onClick={() => openDeliver('upi')}><QrIcon /> UPI QR</button>
          )}
        </div>

        {o.status === 'delivered' && (
          <div className="card done">
            <Check size={22} />
            <div>
              <b>Delivered at {clock(o.deliveredAt)}</b>
              <span>
                {o.deliveryMins} min after the order
                {o.collectedVia === 'upi' ? ` · ${money(o.upiCollected)} paid by UPI${o.upiRef ? ` (ref ${o.upiRef})` : ''}`
                  : o.cashCollected ? ` · ${money(o.cashCollected)} cash collected` : ''}
              </span>
              {o.rating && <span className="stars"><Star size={14} /> Rated {o.rating} by the customer</span>}
              {o.deliveryPhotos?.length > 0 && (
                <span className="proof__photos proof__photos--done">{o.deliveryPhotos.map(src => <img key={src} src={src} alt="Delivery photo" />)}</span>
              )}
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
            <button type="button" className="btn btn--good btn--block btn--lg" disabled={busy} onClick={() => openDeliver('cash')}>
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
          {cash > 0
            ? <PayAtDoor amount={cash} name={o.customerName} pay={pay} setPay={setPay} />
            : <p className="muted">Paid online. Don’t take any money.</p>}
          <Proof o={o} onSaved={order.reload} />
          <button type="button" className="btn btn--good btn--block btn--lg" disabled={busy || !proofDone || (cash > 0 && !pay.ok)} onClick={deliver}>
            {busy ? <Spinner />
              : !proofDone ? `Take ${MIN_PHOTOS - photoCount} more photo${MIN_PHOTOS - photoCount === 1 ? '' : 's'} first`
              : cash > 0 && !pay.ok ? (pay.by === 'upi' ? 'Confirm the UPI payment first' : 'Confirm the cash first')
              : 'Confirm delivery'}
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
