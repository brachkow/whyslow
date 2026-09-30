import fs from 'node:fs/promises'

import { EVENTS_FILE, STATE_DIR } from './paths'
import type { StaleEvent } from './types'

export const appendEvent = async (event: StaleEvent) => {
  await fs.mkdir(STATE_DIR, { recursive: true })
  await fs.appendFile(EVENTS_FILE, `${JSON.stringify(event)}\n`)
}

export const readEvents = async (): Promise<StaleEvent[]> => {
  const raw = await fs.readFile(EVENTS_FILE, 'utf8').catch(() => '')

  return raw
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as StaleEvent)
}
