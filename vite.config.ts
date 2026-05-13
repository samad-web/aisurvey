import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// survey-web is the public market-research questionnaire deployed as its own
// SPA. The dev port (5174) is one above the main app so both can run side by
// side. `/api` is proxied to the same backend the main app talks to.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: true,
    target: 'es2022',
  },
});
