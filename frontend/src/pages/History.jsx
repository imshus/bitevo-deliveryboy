// Finished orders of today / the last 7 or 30 days, with deliveries, cash collected, time and rating.
import { useState } from 'react';
import { api } from '../api.js';
import { usePoll } from '../lib/hooks.js';
import { money, plural } from '../lib/format.js';
import { PastOrderRow } from '../components/OrderCard.jsx';
import { BottomNav, Spinner } from '../components/ui.jsx';
import { Clock } from '../components/Icons.jsx';

const RANGES = [[1, 'Today'], [7, '7 days'], [30, '30 days']];

export default function History() {
  const [days, setDays] = useState(1);
  const history = usePoll(() => api.history(days), 60000, [days]);
  const h = history.data;

  return (
    <div className="page">
      <header className="pagehead"><h1>History</h1></header>
      <div className="content">
        <div className="segmented" role="tablist">
          {RANGES.map(([d, label]) => (
            <button key={d} type="button" role="tab" aria-selected={days === d} className={days === d ? 'is-on' : ''} onClick={() => setDays(d)}>{label}</button>
          ))}
        </div>

        <section className="stats stats--4">
          <div><b>{h ? h.deliveries : '–'}</b><span>Delivered</span></div>
          <div><b>{h ? money(h.cashCollected) : '–'}</b><span>Cash collected</span></div>
          <div><b>{h?.avgMins != null ? `${h.avgMins} min` : '–'}</b><span>Avg. time</span></div>
          <div><b>{h?.avgRating != null ? `${h.avgRating}★` : '–'}</b><span>{h?.ratings ? plural(h.ratings, 'rating') : 'Rating'}</span></div>
        </section>

        {history.loading && !h ? <div className="center"><Spinner /></div>
          : h?.orders.length ? <div className="list">{h.orders.map(o => <PastOrderRow key={o._id} order={o} />)}</div>
          : (
            <div className="empty">
              <Clock size={28} />
              <p>{days === 1 ? 'No deliveries yet today.' : `No deliveries in the last ${days} days.`}</p>
            </div>
          )}
        {history.error && <p className="form-error">{history.error.message}</p>}
      </div>
      <BottomNav />
    </div>
  );
}
