import { setTimeout as sleep } from 'node:timers/promises'

import { createTracker } from './analyze'
import { loadConfig } from './config'
import { appendEvent } from './events'
import { formatMemory } from './format'
import { currentPlatform } from './platform'
import { collectNewReports } from './reports'
import type { ReportState } from './reports'
import { groupProcesses, readTrackerInput } from './snapshot'
import type { AnalyzedProcess, StaleEvent } from './types'

const MAX_SEPARATE_NOTIFICATIONS = 3
const notify = (title: string, message: string) => currentPlatform().notify(title, message)

const describe = (event: StaleEvent) => `${event.name} (${event.pid}) ${event.reason}, ${formatMemory(event.rssKb)}${event.why ? ` · ${event.why}` : ''}`

const announce = async (events: StaleEvent[]) => {
  for (const event of events) {
    console.log(`[${event.at}] ${event.kind}: ${describe(event)} — ${event.args}`)
    await appendEvent(event)
  }

  if (events.length > MAX_SEPARATE_NOTIFICATIONS) {
    const names = [...new Set(events.map(event => event.name))].join(', ')
    await notify(`whyslow: ${events.length} stale processes`, `${names}. Run whyslow to review`)
    return
  }

  for (const event of events) {
    await notify(`whyslow: ${event.kind} process`, describe(event))
  }
}

// Origins need working directories, ports and service definitions, so they are only resolved when there is something to report
const explain = async (events: StaleEvent[], processes: AnalyzedProcess[]) => {
  const { groups } = await groupProcesses(processes)
  const groupByPid = new Map(groups.flatMap(group => group.processes.map(process => [process.pid, group] as const)))

  return events.map((event) => {
    const group = groupByPid.get(event.pid)
    const why = group?.section === 'leftovers' ? group.why : group && `${group.title}: ${group.why}`
    return why ? { ...event, why } : event
  })
}

export const runDaemon = async ({ once = false } = {}) => {
  const config = await loadConfig()
  const tracker = createTracker(config)
  const reported: ReportState = new Map()

  console.log(`whyslow daemon started, checking every ${config.daemonIntervalSec}s`)

  for (;;) {
    const { processes, context } = await readTrackerInput()
    const analyzed = tracker.update(processes, { ...context, now: Date.now() })
    const events = collectNewReports(reported, analyzed, new Date())
    await announce(events.length > 0 ? await explain(events, analyzed) : events)

    if (once) {
      return
    }
    await sleep(config.daemonIntervalSec * 1000)
  }
}
