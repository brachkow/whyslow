#!/usr/bin/env node
import { MouseProvider } from '@ink-tools/ink-mouse'
import { render } from 'ink'
import dayjs from 'dayjs'
import { parseArgs } from 'node:util'

import { byCpu } from './analyze'
import { loadConfig } from './config'
import { runDaemon } from './daemon'
import { readEvents } from './events'
import { formatCpu, formatDuration, formatMemory } from './format'
import { isAlive } from './kill'
import { arrangeSections, SECTION_TITLES } from './origin'
import { CONFIG_FILE, EVENTS_FILE } from './paths'
import { currentPlatform } from './platform'
import { takeSnapshot } from './snapshot'
import { App } from './ui/App'

const HELP = `whyslow — what runs on your Mac and why

Usage
  whyslow                   interactive view, kill offenders
  whyslow list [--all] [--json]  print what runs and why
  whyslow log [--limit N]   show what the daemon has reported
  whyslow daemon run        run the watcher in foreground
  whyslow daemon install    run the watcher in background at login (LaunchAgent or systemd user unit)
  whyslow daemon uninstall  remove it again
  whyslow daemon status     show whether the watcher is running

Config: ${CONFIG_FILE}`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    limit: { type: 'string', default: '20' },
    once: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

const list = async () => {
  const { groups } = await takeSnapshot(await loadConfig())
  const sections = arrangeSections(groups, byCpu, values.all)

  if (values.json) {
    console.log(JSON.stringify(sections, null, 2))
    return
  }

  for (const { section, groups: sectionGroups, quietCount } of sections) {
    console.log(`\n${SECTION_TITLES[section]}`)
    for (const group of sectionGroups) {
      const ports = group.ports.length > 0 ? `  ${group.ports.map(port => `:${port}`).join(' ')}` : ''
      const flags = group.flags.length > 0 ? `  [${group.flags.map(flag => flag.kind).join(', ')}]` : ''
      console.log([
        `  ${group.title.slice(0, 28).padEnd(28)}`,
        String(group.processes.length).padStart(4),
        formatCpu(group.cpuPercent).padStart(7),
        formatMemory(group.rssKb).padStart(7),
        formatDuration(group.elapsedSec).padStart(8),
        `  ${group.why}${ports}${flags}`,
      ].join(''))
    }
    if (quietCount > 0) {
      console.log(`  + ${quietCount} quiet, --all to show`)
    }
  }
}

const log = async () => {
  const events = await readEvents()
  if (events.length === 0) {
    console.log(`No reports yet (${EVENTS_FILE})`)
    return
  }

  for (const event of events.slice(-Number(values.limit))) {
    const time = dayjs(event.at).format('YYYY-MM-DD HH:mm')
    const gone = isAlive(event.pid) ? '' : '  [gone]'
    console.log(`${time}  ${event.kind.padEnd(7)}  ${event.name} (${event.pid})  ${event.reason}  ${formatMemory(event.rssKb)}${event.why ? `  ${event.why}` : ''}${gone}`)
  }
}

const daemonStatus = async () => {
  const { daemon } = currentPlatform()
  const installed = await daemon.isInstalled()
  const pid = await daemon.pid()
  console.log(`installed: ${installed ? 'yes' : 'no'}`)
  console.log(`running: ${pid === null ? 'no' : `yes (pid ${pid})`}`)
  console.log(`log: ${daemon.logHint}`)
}

const DAEMON_COMMANDS: Record<string, () => Promise<void>> = {
  run: () => runDaemon({ once: values.once }),
  install: async () => {
    await currentPlatform().daemon.install()
    console.log('Daemon installed and started')
  },
  uninstall: async () => {
    await currentPlatform().daemon.uninstall()
    console.log('Daemon stopped and removed')
  },
  status: daemonStatus,
}

const tui = async () => {
  const config = await loadConfig()
  const { waitUntilExit } = render(
    <MouseProvider>
      <App config={config} />
    </MouseProvider>,
    { alternateScreen: true },
  )
  await waitUntilExit()
}

const COMMANDS: Record<string, () => Promise<void>> = {
  list,
  log,
  daemon: async () => {
    const action = DAEMON_COMMANDS[positionals[1] ?? 'status']
    if (action) {
      return action()
    }
    console.log(HELP)
    process.exitCode = 1
  },
}

const main = async () => {
  if (values.help) {
    console.log(HELP)
    return
  }

  const [command] = positionals
  if (command === undefined) {
    return tui()
  }

  const handler = COMMANDS[command]
  if (handler) {
    return handler()
  }

  console.log(HELP)
  process.exitCode = 1
}

await main()
