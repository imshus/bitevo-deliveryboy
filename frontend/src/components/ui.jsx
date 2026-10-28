// Small shared pieces: toasts, a confirm sheet, status chips, the bottom navigation.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Clock, User } from './Icons.jsx';

// ---- Toasts ------------------------------------------------------------------------------
const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const show = useCallback((message, tone = 'info') => setToast({ message, tone, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.tone === 'error' ? 5000 : 3200);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && <div key={toast.id} className={`toast toast--${toast.tone}`} role="status">{toast.message}</div>}
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

// ---- Bottom sheet for confirming a step -------------------------------------------------
export function Sheet({ title, children, onClose }) {
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="sheet__grip" />
        <h2 className="sheet__title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

// ---- Order status ------------------------------------------------------------------------
// What each order status means to a rider.
export const RIDER_STATUS = {
  placed: { label: 'Waiting for kitchen', tone: 'warning' },
  preparing: { label: 'Being prepared', tone: 'info' },
  out_for_delivery: { label: 'On the way', tone: 'live' },
  delivered: { label: 'Delivered', tone: 'good' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
};

export const StatusChip = ({ status }) => {
  const s = RIDER_STATUS[status] || { label: status, tone: 'info' };
  return <span className={`chip chip--${s.tone}`}>{s.label}</span>;
};

export const Spinner = () => <span className="spinner" aria-label="Loading" />;

export function BottomNav() {
  const link = ({ isActive }) => `nav__item${isActive ? ' is-active' : ''}`;
  return (
    <nav className="nav" aria-label="Main">
      <NavLink to="/" end className={link}><Home /><span>Home</span></NavLink>
      <NavLink to="/history" className={link}><Clock /><span>History</span></NavLink>
      <NavLink to="/profile" className={link}><User /><span>Profile</span></NavLink>
    </nav>
  );
}
