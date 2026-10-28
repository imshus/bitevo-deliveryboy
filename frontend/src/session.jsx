// The signed-in rider and the app's settings from the API, shared by every page.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setSignedOutHandler } from './api.js';
import { stopTracking } from './lib/tracker.js';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [agent, setAgent] = useState(null);
  const [config, setConfig] = useState(null);

  useEffect(() => {
    setSignedOutHandler(() => {
      stopTracking();
      setAgent(null);
    });
    Promise.all([
      api.config().catch(() => null),
      api.me().then(r => r.agent).catch(() => null),
    ]).then(([cfg, me]) => {
      setConfig(cfg);
      setAgent(me);
      setLoading(false);
    });
  }, []);

  const refresh = useCallback(async () => {
    const { agent: me } = await api.me();
    setAgent(me);
    return me;
  }, []);

  const signOut = useCallback(async () => {
    stopTracking();
    await api.logout().catch(() => {});
    setAgent(null);
  }, []);

  const value = useMemo(() => ({ loading, agent, config: config || {}, setAgent, refresh, signOut }), [loading, agent, config, refresh, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
