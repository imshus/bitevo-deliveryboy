import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// The API runs on port 4002; Vite forwards /api (and /photos, delivery photos kept by the API without
// Supabase) to it, so the app and API share one address.
// `npm run dev:phone` (mode "phone") serves over HTTPS on the local network: phones only give a web
// page their GPS position over HTTPS (or on localhost).
const api = { '/api': 'http://127.0.0.1:4002', '/photos': 'http://127.0.0.1:4002' };

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'phone' ? [basicSsl()] : [])],
  server: { port: 2003, strictPort: true, proxy: api },
  preview: { port: 2003, strictPort: true, proxy: api },
}));
