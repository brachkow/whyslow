#!/usr/bin/env node
import { MouseProvider } from '@ink-tools/ink-mouse'
import { render } from 'ink'
import { parseArgs } from 'node:util'

import { byCpu } from './analyze'
import { formatCpu, formatDuration, formatMemory } from './format'
import { arrangeSections, SECTION_TITLES } from './origin'
import { takeSnapshot } from './snapshot'
import { App } from './ui/App'

const HELP = `whyslow — what runs on your computer and why

Usage
  whyslow                         interactive view, kill offenders
  whyslow list [--all] [--json]   print what runs and why`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

const list = async () => {
  const { groups } = await takeSnapshot()
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

const tui = async () => {
  const { waitUntilExit } = render(
    <MouseProvider>
      <App />
    </MouseProvider>,
    { alternateScreen: true },
  )
  await waitUntilExit()
}

const COMMANDS: Record<string, () => Promise<void>> = {
  list,
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
