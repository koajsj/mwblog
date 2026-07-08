// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  integrations: [react()],
  adapter: node({
    mode: 'standalone',
  }),
  vite: {
    ssr: {
      noExternal: ['@supabase/supabase-js'],
    },
  },
});
