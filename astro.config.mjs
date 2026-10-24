// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.riftjumpers.space',
  image: {
    // Alex's portrait is hosted on his site; let astro:assets fetch and shrink it at build time.
    domains: ['alexzahnaudio.com']
  },
  vite: {
    plugins: [tailwindcss()]
  }
});