import { Box, Text } from 'ink'
import Link from 'ink-link'

import { fitPorts, formatCpu, formatDuration, formatMemory, portsLabel, truncate } from '../format'
import { SECTION_TITLES, shortCommand } from '../origin'
import type { AnalyzedProcess, FlagKind, ProcessGroup, Section } from '../types'

export const FLAG_COLORS: Record<FlagKind, string> = {
  orphan: 'yellow',
  stale: 'red',
  runaway: 'magenta',
}

const SECTION_COLORS: Record<Section, string> = {
  leftovers: 'red',
  projects: 'green',
  apps: 'cyan',
  background: 'blue',
  system: 'gray',
  other: 'gray',
}

const COLUMNS = { marker: 2, title: 28, count: 5, cpu: 8, mem: 8, age: 8, ports: 20 }
const FIXED_WIDTH = COLUMNS.marker + COLUMNS.title + COLUMNS.count + COLUMNS.cpu + COLUMNS.mem + COLUMNS.age + 2 + COLUMNS.ports + 2
const PROCESS_INDENT = 4
const PROCESS_PID_WIDTH = 7

// Ports open http://localhost:<port> on click in terminals that support hyperlinks
export const Ports = ({ ports, width }: { ports: number[], width: number }) => {
  const { shown, hidden } = fitPorts(ports, width)
  const label = portsLabel(shown, hidden)

  return (
    <Text>
      {shown.map((port, index) => (
        <Text key={port}>
          {index > 0 && ' '}
          <Link url={`http://localhost:${port}`} fallback={false}>
            <Text color="cyan">{`:${port}`}</Text>
          </Link>
        </Text>
      ))}
      {hidden > 0 && <Text dimColor>{`${shown.length > 0 ? ' ' : ''}+${hidden}`}</Text>}
      {' '.repeat(Math.max(0, width - label.length))}
    </Text>
  )
}

export const SectionRow = ({ section, count }: { section: Section, count: number }) => (
  <Box marginTop={1}>
    <Text bold color={SECTION_COLORS[section]}>{`${SECTION_TITLES[section]} (${count})`}</Text>
  </Box>
)

export const QuietRow = ({ count }: { count: number }) => (
  <Text dimColor>{`${' '.repeat(COLUMNS.marker)}+ ${count} quiet, press a to show`}</Text>
)

type GroupRowProps = {
  group: ProcessGroup
  expanded: boolean
  selected: boolean
  width: number
}

export const GroupRow = ({ group, expanded, selected, width }: GroupRowProps) => {
  const badges = group.flags.map(flag => flag.kind)
  const whyWidth = Math.max(0, width - FIXED_WIDTH - badges.join(' ').length - (badges.length > 0 ? 1 : 0))

  return (
    <Text inverse={selected} wrap="truncate">
      {expanded ? '▾ ' : '▸ '}
      {truncate(group.title, COLUMNS.title - 1).padEnd(COLUMNS.title)}
      {String(group.processes.length).padStart(COLUMNS.count - 1).padEnd(COLUMNS.count)}
      {formatCpu(group.cpuPercent).padStart(COLUMNS.cpu)}
      {formatMemory(group.rssKb).padStart(COLUMNS.mem)}
      {formatDuration(group.elapsedSec).padStart(COLUMNS.age)}
      {'  '}
      <Ports ports={group.ports} width={COLUMNS.ports} />
      {'  '}
      {badges.map(kind => (
        <Text key={kind} bold color={FLAG_COLORS[kind]}>{`${kind} `}</Text>
      ))}
      <Text dimColor={!selected}>{truncate(group.why, whyWidth)}</Text>
    </Text>
  )
}

type ProcessRowProps = {
  process: AnalyzedProcess
  ports: number[]
  selected: boolean
  width: number
}

export const ProcessRow = ({ process, ports, selected, width }: ProcessRowProps) => {
  const commandWidth = COLUMNS.marker + COLUMNS.title + COLUMNS.count - PROCESS_INDENT - PROCESS_PID_WIDTH - 2
  const flags = process.flags.map(flag => flag.kind).join(' ')

  return (
    <Text inverse={selected} wrap="truncate">
      {' '.repeat(PROCESS_INDENT)}
      <Text dimColor={!selected}>{String(process.pid).padEnd(PROCESS_PID_WIDTH)}</Text>
      {'  '}
      {truncate(shortCommand(process), commandWidth - 1).padEnd(commandWidth)}
      {formatCpu(process.cpuPercent).padStart(COLUMNS.cpu)}
      {formatMemory(process.rssKb).padStart(COLUMNS.mem)}
      {formatDuration(process.elapsedSec).padStart(COLUMNS.age)}
      {'  '}
      <Ports ports={ports} width={COLUMNS.ports} />
      {'  '}
      <Text color="yellow">{truncate(flags, Math.max(0, width - FIXED_WIDTH))}</Text>
    </Text>
  )
}
