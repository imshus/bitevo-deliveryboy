// The rider's details as the admin panel has them, location sharing status and tips, help, sign out.
import { useEffect, useState } from 'react';
import { useSession } from '../session.jsx';
import { inAndroidApp, readPermission, useTracker } from '../lib/tracker.js';
import { initials, telLink } from '../lib/format.js';
import { LocationLine } from '../components/LiveStatus.jsx';
import { BottomNav } from '../components/ui.jsx';
import { Bike, Logout, Phone, Shield, Signal, Store } from '../components/Icons.jsx';

const ID_CHECK = { verified: 'Verified', pending: 'Pending', rejected: 'Not approved' };
const PERMISSION = { granted: 'Allowed', denied: 'Blocked', prompt: 'Not asked yet', unavailable: 'Not available', unknown: 'Asked when you go online' };

export default function Profile() {
  const { agent, config, signOut } = useSession();
  const tracker = useTracker();
  const [installEvent, setInstallEvent] = useState(null);
  const installed = window.matchMedia?.('(display-mode: standalone)').matches;

  useEffect(() => {
    readPermission();
    const onPrompt = e => {
      e.preventDefault();
      setInstallEvent(e);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  return (
    <div className="page">
      <header className="pagehead"><h1>Profile</h1></header>
      <div className="content">
        <div className="profile">
          <span className="avatar avatar--lg">{initials(agent.name)}</span>
          <div>
            <b>{agent.name}</b>
            <span>{agent.phone}</span>
          </div>
        </div>

        <div className="card">
          <dl className="details">
            <div><dt><Store size={18} /> Zone</dt><dd>{agent.zone}</dd></div>
            <div><dt><Bike size={18} /> Vehicle</dt><dd>{agent.vehicleType}{agent.vehicleNumber && ` · ${agent.vehicleNumber}`}</dd></div>
            <div><dt><Shield size={18} /> ID check</dt><dd className={`id-${agent.kycStatus}`}>{ID_CHECK[agent.kycStatus] || agent.kycStatus}</dd></div>
          </dl>
          <p className="muted small">Something wrong here? Your BiteVo manager can change it in the admin panel.</p>
        </div>

        <div className="card">
          <h3 className="card__title"><Signal size={18} /> Live location</h3>
          <LocationLine />
          <dl className="details">
            <div><dt>Permission</dt><dd>{PERMISSION[tracker.permission] || tracker.permission}</dd></div>
            {inAndroidApp
              ? <div><dt>With the screen off</dt><dd>Keeps sharing</dd></div>
              : <div><dt>Screen kept on</dt><dd>{tracker.screenOn ? 'Yes' : 'No'}</dd></div>}
          </dl>
          <ul className="tips">
            <li>Your location is shared with the BiteVo team only while you’re online. While you carry an order, your route is saved with it.</li>
            {inAndroidApp
              ? <li>Sharing goes on with the screen off or another app open, until you go offline. Android shows “Sharing live location” while it’s on.</li>
              : <li>Keep this app open on screen while working. Phones pause location for apps in the background.</li>}
            <li>Turn on your phone’s Location (GPS, high accuracy) and keep battery saver off.</li>
          </ul>
          {!installed && !inAndroidApp && (installEvent
            ? <button type="button" className="btn btn--ghost btn--block" onClick={() => installEvent.prompt()}>Install the app on this phone</button>
            : <p className="muted small">Tip: add this app to your home screen (browser menu → Add to Home screen) to open it like an app.</p>)}
        </div>

        {(config.supportPhone || config.kitchen?.phone) && (
          <div className="card">
            <h3 className="card__title">Help</h3>
            {config.supportPhone && <a className="btn btn--ghost btn--block" href={telLink(config.supportPhone)}><Phone size={18} /> Call BiteVo support</a>}
            {config.kitchen?.phone && <a className="btn btn--ghost btn--block" href={telLink(config.kitchen.phone)}><Store size={18} /> Call the kitchen</a>}
          </div>
        )}

        <button type="button" className="btn btn--danger-ghost btn--block" onClick={signOut}><Logout size={18} /> Sign out</button>
        <p className="muted small center">BiteVo Delivery Partner · v1.0</p>
      </div>
      <BottomNav />
    </div>
  );
}
