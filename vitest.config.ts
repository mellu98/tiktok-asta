import { defineConfig } from 'vitest/config'

// Test unitari (node): parsing ADB, DeviceManager, sanitizzazione input.
// Nessun dispositivo reale richiesto.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
