// Pages, and live location: tracking runs whenever the signed-in rider is online, on every page.
import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './session.jsx';
import { startTracking, stopTracking } from './lib/tracker.js';
import { Spinner, useToast } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import OrderPage from './pages/Order.jsx';
import History from './pages/History.jsx';
import Profile from './pages/Profile.jsx';

export default function App() {
  const { loading, agent, refresh } = useSession();
  const toast = useToast();
  const online = Boolean(agent && agent.status !== 'offline');

  useEffect(() => {
    if (!online) return stopTracking();
    startTracking({
      onOffline: message => {
        toast(message, 'error');
        refresh().catch(() => {});
      },
    });
  }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="page center-page"><Spinner /></div>;
  if (!agent) return <Login />;

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/orders/:id" element={<OrderPage />} />
      <Route path="/history" element={<History />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
