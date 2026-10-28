// The online switch and the live-location line under it ("Sharing live location · ±8 m · 3 s ago").
import { useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { askForLocation, inAndroidApp, useTracker } from '../lib/tracker.js';
import { askToNotify, unlockSound } from '../lib/alerts.js';
import { useNow } from '../lib/hooks.js';
import { useToast } from './ui.jsx';

export function OnlineSwitch() {
  const { agent, setAgent } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const online = agent.status !== 'offline';

  const toggle = async () => {
    setBusy(true);
    try {
      if (!online) {
        unlockSound();
        askToNotify();
        // Location first: going online means sharing it.
        await askForLocation();
      }
      const r = await api.setOnline(!online);
      setAgent(r.agent);
      toast(online ? 'You’re offline. Location sharing stopped.' : 'You’re online. Sharing your live location.', online ? 'info' : 'good');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" role="switch" aria-checked={online} disabled={busy || !agent.canTakeOrders}
      className={`switch${online ? ' is-on' : ''}${busy ? ' is-busy' : ''}`} onClick={toggle}>
      <span className="switch__track"><span className="switch__thumb" /></span>
      <span className="switch__label">{online ? (agent.status === 'busy' ? 'On delivery' : 'Online') : 'Offline'}</span>
    </button>
  );
}

// One line describing what the tracker is doing right now.
export function LocationLine({ compact = false }) {
  const { agent } = useSession();
  const t = useTracker();
  const now = useNow(1000);
  if (agent.status === 'offline') return compact ? null : <p className="live live--off"><i />Offline · location not shared</p>;

  if (t.permission === 'denied') return <p className="live live--bad"><i />Location blocked. Allow it in {inAndroidApp ? 'the phone’s Settings → Apps → BiteVo Rider → Location' : 'the browser’s site settings'}.</p>;
  if (t.permission === 'unavailable') return <p className="live live--bad"><i />This browser can’t share location.</p>;
  if (t.networkProblem) return <p className="live live--warn"><i />No connection · {t.queued} position{t.queued === 1 ? '' : 's'} waiting to send</p>;
  if (t.gpsProblem && !t.position) return <p className="live live--warn"><i />{t.gpsProblem}</p>;
  if (!t.position) return <p className="live live--warn"><i />Finding your location…</p>;

  const secs = t.lastSentAt ? Math.max(0, Math.round((now - t.lastSentAt) / 1000)) : null;
  const sent = secs == null ? 'sending…' : secs < 3 ? 'just now' : secs < 60 ? `${secs}s ago` : `${Math.round(secs / 60)} min ago`;
  const weak = t.position.accuracy > 100;
  return (
    <p className={`live ${weak ? 'live--warn' : 'live--on'}`}>
      <i />Live location{compact ? '' : ' shared'} · ±{Math.round(t.position.accuracy)} m · {sent}
      {weak && !compact && <span className="live__hint"> (weak GPS, move to open sky)</span>}
    </p>
  );
}
