import fs from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { createTracker } from './analyze'
import { loadConfig } from './config'
import { appendEvent } from './events'
import { exec, execOrThrow } from './exec'
import { formatMemory } from './format'
import { DAEMON_LOG_FILE, LAUNCH_AGENT_FILE, LAUNCH_AGENT_LABEL, STATE_DIR } from './paths'
import { collectNewReports } from './reports'
import type { ReportState } from './reports'
import { groupProcesses } from './snapshot'
import { readLaunchdJobs, readProcesses } from './system'
import type { AnalyzedProcess, StaleEvent } from './types'

const MAX_SEPARATE_NOTIFICATIONS = 3
const LAUNCHCTL_PID_REGEX = /"PID" = (\d+);/

const notify = async (title: string, message: string) => {
  await exec('osascript', [
    '-e', 'on run argv',
    '-e', 'display notification (item 2 of argv) with title (item 1 of argv)',
    '-e', 'end run',
    title,
    message,
  ])
}

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

// Origins need lsof and plist reads, so they are only resolved when there is something to report
const explain = async (events: StaleEvent[], processes: AnalyzedProcess[], launchdJobs: ReadonlyMap<number, string>) => {
  const { groups } = await groupProcesses(processes, launchdJobs)
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
  const myUid = process.getuid?.() ?? 0

  console.log(`whyslow daemon started, checking every ${config.daemonIntervalSec}s`)

  for (;;) {
    const [processes, launchdJobs] = await Promise.all([readProcesses(), readLaunchdJobs()])
    const analyzed = tracker.update(processes, { myUid, launchdJobs, now: Date.now() })
    const events = collectNewReports(reported, analyzed, new Date())
    await announce(events.length > 0 ? await explain(events, analyzed, launchdJobs) : events)

    if (once) {
      return
    }
    await sleep(config.daemonIntervalSec * 1000)
  }
}

const escapeXml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const buildPlist = (programArguments: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments.map(arg => `    <string>${escapeXml(arg)}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(DAEMON_LOG_FILE)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(DAEMON_LOG_FILE)}</string>
</dict>
</plist>
`

const domain = () => `gui/${process.getuid?.() ?? 0}`

export const getDaemonPid = async (): Promise<number | null> => {
  const result = await exec('launchctl', ['list', LAUNCH_AGENT_LABEL])
  if (result.exitCode !== 0) {
    return null
  }

  const pid = LAUNCHCTL_PID_REGEX.exec(result.stdout)?.[1]
  return pid ? Number(pid) : null
}

export const isDaemonInstalled = async () => fs.access(LAUNCH_AGENT_FILE).then(() => true, () => false)

export const uninstallDaemon = async () => {
  await exec('launchctl', ['bootout', `${domain()}/${LAUNCH_AGENT_LABEL}`])
  await fs.rm(LAUNCH_AGENT_FILE, { force: true })
}

export const installDaemon = async () => {
  // Re-run the same way this process was started, so it works for the built bin and for tsx in development
  const script = await fs.realpath(process.argv[1] ?? '')
  const plist = buildPlist([process.execPath, ...process.execArgv, script, 'daemon', 'run'])

  await uninstallDaemon()
  await fs.mkdir(path.dirname(LAUNCH_AGENT_FILE), { recursive: true })
  await fs.mkdir(STATE_DIR, { recursive: true })
  await fs.writeFile(LAUNCH_AGENT_FILE, plist)
  await execOrThrow('launchctl', ['bootstrap', domain(), LAUNCH_AGENT_FILE])
}
