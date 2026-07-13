// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import { loadEnv } from 'vite';

const env = loadEnv(process.env.NODE_ENV || 'production', process.cwd(), '');
const appOrigin = env.APP_ORIGIN || process.env.APP_ORIGIN || '';
/** @type {Array<{ hostname: string; protocol: string; port?: string }>} */
let allowedDomains = [];

try {
  const origin = new URL(appOrigin);
  allowedDomains = [{
    hostname: origin.hostname,
    protocol: origin.protocol.replace(':', ''),
    ...(origin.port ? { port: origin.port } : {}),
  }];
} catch {
  // Local development does not use a trusted reverse-proxy origin.
}

// https://astro.build/config
export default defineConfig({
  output: 'server',
  integrations: [react()],
  security: {
    allowedDomains,
  },
  adapter: node({
    mode: 'standalone',
  }),
});
