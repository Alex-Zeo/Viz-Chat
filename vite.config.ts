import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/copilotkit': 'http://localhost:3002',
      '/api': 'http://localhost:3002',
    },
  },
});
