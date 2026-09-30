import fs from 'node:fs/promises'

import { CONFIG_FILE } from './paths'
import type { Config } from './types'

export const DEFAULT_CONFIG: Config = {
  staleOrphanAfterMin: 30,
  stuckAfterMin: 10,
  runawayCpuPercent: 80,
  runawayAfterMin: 10,
  daemonIntervalSec: 15,
  // Crash reporters intentionally detach from their app, they are not real orphans
  ignore: ['crashpad_handler', 'chrome_crashpad_handler', 'crashhelper'],
}

export const loadConfig = async (): Promise<Config> => {
  const raw = await fs.readFile(CONFIG_FILE, 'utf8').catch(() => null)
  if (raw === null) {
    return DEFAULT_CONFIG
  }

  return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<Config>) }
}
