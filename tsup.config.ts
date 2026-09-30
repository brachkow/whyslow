import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.tsx'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  clean: true,
})
