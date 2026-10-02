import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // In dev, the API runs separately (npm run dev -w server).
    proxy: { '/api': 'http://localhost:3000' },
  },
});
