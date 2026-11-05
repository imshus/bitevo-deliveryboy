import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Vite forwards /api (and /photos, delivery photos kept by the API without Supabase) to the API, so the app and
// API share one address and the sign-in cookie is the app's own. The API is the local one on port 4002, or the
// one in API_PROXY (frontend/.env), e.g. API_PROXY=https://driverapi.bitevo.in to try the app against the live
// API: a cookie from another address than the page's is refused, which a proxy avoids.
// `npm run dev:phone` (mode "phone") serves over HTTPS on the local network: phones only give a web
// page their GPS position over HTTPS (or on localhost).
export default defineConfig(({ mode }) => {
  const target = loadEnv(mode, process.cwd(), '').API_PROXY || 'http://127.0.0.1:4002';
  const forward = { target, changeOrigin: true };
  const api = { '/api': forward, '/photos': forward };
  return {
    plugins: [react(), ...(mode === 'phone' ? [basicSsl()] : [])],
    server: { port: 2003, strictPort: true, proxy: api },
    preview: { port: 2003, strictPort: true, proxy: api },
  };
});
