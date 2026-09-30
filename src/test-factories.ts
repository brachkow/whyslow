import { faker } from '@faker-js/faker'

import type { AnalyzedProcess, ProcessInfo } from './types'

export const MY_UID = 501

export const makeProcess = (overrides: Partial<ProcessInfo> = {}): ProcessInfo => {
  const name = overrides.name ?? faker.system.fileName({ extensionCount: 0 })
  const pid = overrides.pid ?? faker.number.int({ min: 1000, max: 99_999 })

  return {
    pid,
    ppid: faker.number.int({ min: 2, max: 999 }),
    pgid: pid,
    uid: MY_UID,
    user: 'me',
    psCpuPercent: 0,
    rssKb: faker.number.int({ min: 1000, max: 500_000 }),
    elapsedSec: 60,
    cpuTimeSec: 0,
    stat: 'S',
    tty: '??',
    command: `/usr/local/bin/${name}`,
    name,
    args: `${name} ${faker.lorem.word()}`,
    ...overrides,
  }
}

export const makeAnalyzed = (overrides: Partial<AnalyzedProcess> = {}): AnalyzedProcess => ({
  ...makeProcess(overrides),
  cpuPercent: 0,
  flags: [],
  ...overrides,
})
