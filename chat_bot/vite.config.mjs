import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 3000, strictPort: true },
  preview: { port: 3000, strictPort: true },
  build: { outDir: 'build', sourcemap: false },
  test: {
    environment: 'jsdom', globals: true, setupFiles: './src/setupTests.js',
    include: ['src/**/*.test.{js,jsx}'],
    environmentOptions: { jsdom: { url: 'http://localhost:3000' } },
  },
});
