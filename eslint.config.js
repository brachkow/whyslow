import { defineConfig, GLOB_TS } from 'eslint-config-fans'

// eslint-config-fans only targets .ts, Ink components live in .tsx
const TS_GLOB_SUFFIX = /\.({js,ts}|ts)$/

const withTsx = config => config.files
  ? { ...config, files: config.files.flatMap(glob => glob === GLOB_TS || glob.endsWith('.{js,ts}') ? [glob, glob.replace(TS_GLOB_SUFFIX, '.tsx')] : [glob]) }
  : config

export default [
  ...defineConfig({
    typescript: true,
    test: true,
    formatter: 'stylistic',
  }).map(withTsx),
  {
    rules: {
      // CLI output goes to stdout
      'no-console': 'off',
      // tsup is a deliberate choice for bundling the CLI
      'e18e/ban-dependencies': ['error', { allowed: ['tsup'] }],
    },
  },
]
