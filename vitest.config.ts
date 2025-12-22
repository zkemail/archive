import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // Environment for testing React components
    environment: 'jsdom',

    // Enable global test APIs (describe, it, expect, etc.)
    globals: true,

    // Setup files to run before tests
    setupFiles: ['./vitest.setup.ts'],

    // Test file patterns
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],

    // Files to exclude
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
    ],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '.next/',
        'coverage/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/types/**',
      ],
    },

    // Test timeout
    testTimeout: 10000,

    // Watch mode options
    watch: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/generated': path.resolve(__dirname, './src/generated'),
    },
  },
});
