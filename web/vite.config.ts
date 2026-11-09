import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: true } },
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Rolldown (Vite 8) requires the function form.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\/](recharts|d3-[^\/]+|victory-vendor)[\/]/.test(id)) return 'charts';
          if (/[\/](react|react-dom|react-router|scheduler)[\/]/.test(id)) return 'react';
          if (/[\/](radix-ui|@radix-ui)[\/]/.test(id)) return 'radix';
          return undefined;
        },
      },
    },
  },
});
