import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'packages/**/*.test.ts'],
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      '@radio-services/core': path.resolve(__dirname, './packages/core/src'),
      '@radio-services/shared': path.resolve(__dirname, './packages/shared/src'),
      '@radio-services/server': path.resolve(__dirname, './packages/server/src'),
      '@radio-services/plugins/archive': path.resolve(__dirname, './packages/plugins/archive/src'),
      '@radio-services/plugins/ffmpeg': path.resolve(__dirname, './packages/plugins/ffmpeg/src'),
      '@radio-services/plugins/listeners': path.resolve(__dirname, './packages/plugins/listeners/src'),
      '@radio-services/plugins/playlist': path.resolve(__dirname, './packages/plugins/playlist/src'),
    },
  },
})
