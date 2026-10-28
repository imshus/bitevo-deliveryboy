// Order summaries for the home and history lists.
import { Link } from 'react-router-dom';
import { money, ago, when, plural } from '../lib/format.js';
import { StatusChip, Spinner } from './ui.jsx';
import { Chevron, Star } from './Icons.jsx';

const NEXT_STEP = {
  placed: 'The kitchen will accept it shortly',
  preparing: 'Head to the kitchen to pick it up',
  out_for_delivery: 'Deliver to the customer',
};

// Riders only see an amount when they collect it (cash or UPI on delivery), never for orders paid online.
const Payment = ({ order }) => (order.cashToCollect > 0
  ? <span className="pay pay--cash">Collect <b>{money(order.cashToCollect)}</b></span>
  : <span className="pay pay--paid">Paid <b>online</b></span>);

export function MyOrderCard({ order, number, now }) {
  return (
    <Link to={`/orders/${order._id}`} className={`ocard ocard--mine is-${order.status}`}>
      <div className="ocard__top">
        {number && <span className="ocard__num">{number}</span>}
        <StatusChip status={order.status} />
        <span className="ocard__no">{order.orderNo}</span>
      </div>
      <div className="ocard__main">
        <div className="ocard__who">
          <b>{order.customerName}</b>
          <span>{order.address.area || order.address.line2}</span>
        </div>
        <Payment order={order} />
      </div>
      <div className="ocard__foot">
        <span>{NEXT_STEP[order.status]}</span>
        <Chevron size={18} />
      </div>
      <div className="ocard__meta">{plural(order.itemCount, 'item')}{order.tripKm != null && ` · ${order.tripKm} km from kitchen`} · placed {ago(order.placedAt, now)}</div>
    </Link>
  );
}

export function OfferCard({ order, onAccept, busy, blockedReason, now }) {
  return (
    <div className="ocard ocard--offer">
      <Link to={`/orders/${order._id}`} className="ocard__link">
        <div className="ocard__top">
          <span className="ocard__area">{order.address.area || order.address.line2 || order.zone}</span>
          <span className="ocard__no">{ago(order.placedAt, now)}</span>
        </div>
        <div className="ocard__main">
          <div className="ocard__who">
            <b>{plural(order.itemCount, 'item')}</b>
            <span>{order.tripKm != null ? `${order.tripKm} km from kitchen · ` : ''}{order.status === 'placed' ? 'Kitchen accepting' : 'Being prepared'}</span>
          </div>
          <Payment order={order} />
        </div>
      </Link>
      <button type="button" className="btn btn--primary btn--block" disabled={busy || Boolean(blockedReason)} onClick={() => onAccept(order)}>
        {busy ? <Spinner /> : blockedReason || 'Accept order'}
      </button>
    </div>
  );
}

export function PastOrderRow({ order }) {
  return (
    <Link to={`/orders/${order._id}`} className="prow">
      <div className="prow__main">
        <b>{order.orderNo} · {order.address.area || order.address.line2}</b>
        <span>{when(order.deliveredAt || order.cancelledAt || order.placedAt)}{order.deliveryMins ? ` · ${order.deliveryMins} min` : ''}</span>
      </div>
      <div className="prow__side">
        {order.status === 'delivered' ? (
          <>
            <b>{order.cashCollected ? money(order.cashCollected) : 'Online'}</b>
            {order.rating ? <span className="stars"><Star size={13} /> {order.rating}</span> : <span>{order.cashCollected ? 'cash' : 'paid'}</span>}
          </>
        ) : <StatusChip status={order.status} />}
      </div>
    </Link>
  );
}
