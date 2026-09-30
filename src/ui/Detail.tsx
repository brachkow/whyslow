import { Text } from 'ink'
import os from 'node:os'

import { formatCpu, formatDuration, formatMemory, truncate } from '../format'
import { ancestorsOf, SECTION_TITLES, tildify } from '../origin'
import type { AnalyzedProcess, Flag, ProcessGroup } from '../types'
import { FLAG_COLORS, Ports } from './Rows'

const home = os.homedir()
const LISTENING = ' · listening on '

const chainOf = (process: AnalyzedProcess, byPid: ReadonlyMap<number, AnalyzedProcess>) =>
  [...ancestorsOf(process, byPid).toReversed(), process]
    .filter(member => member.pid > 0)
    .map(member => member.name)
    .join(' → ')

// One line for all flags keeps the pane at a fixed height
const FlagLine = ({ flags }: { flags: Flag[] }) => (
  <Text wrap="truncate">
    {flags.map((flag, index) => (
      <Text key={flag.kind}>
        {index > 0 && ' · '}
        <Text bold color={FLAG_COLORS[flag.kind]}>{flag.kind}</Text>
        {` ${flag.reason}`}
      </Text>
    ))}
  </Text>
)

type GroupDetailProps = {
  group: ProcessGroup
  byPid: ReadonlyMap<number, AnalyzedProcess>
  width: number
}

export const GroupDetail = ({ group, byPid, width }: GroupDetailProps) => {
  const heaviest = group.processes.toSorted((a, b) => b.cpuPercent - a.cpuPercent)[0]
  const stats = `${group.processes.length} processes · CPU ${formatCpu(group.cpuPercent)} · ${formatMemory(group.rssKb)} · up ${formatDuration(group.elapsedSec)}`

  return (
    <>
      <Text wrap="truncate">
        <Text bold>{group.title}</Text>
        <Text dimColor>{` · ${SECTION_TITLES[group.section]}${group.location ? ` · ${truncate(group.location, width)}` : ''}`}</Text>
      </Text>
      <Text wrap="truncate">{group.why}</Text>
      <Text wrap="truncate">
        <Text dimColor>{stats}</Text>
        {group.ports.length > 0 && <Text dimColor>{LISTENING}</Text>}
        {group.ports.length > 0 && <Ports ports={group.ports} width={width - stats.length - LISTENING.length} />}
      </Text>
      {heaviest && <Text dimColor wrap="truncate">{chainOf(heaviest, byPid)}</Text>}
      <FlagLine flags={group.flags} />
    </>
  )
}

type ProcessDetailProps = {
  process: AnalyzedProcess
  byPid: ReadonlyMap<number, AnalyzedProcess>
  cwd: string | undefined
  ports: number[]
  width: number
}

export const ProcessDetail = ({ process, byPid, cwd, ports, width }: ProcessDetailProps) => {
  const parent = byPid.get(process.ppid)
  const location = cwd ? `in ${tildify(cwd, home)}` : 'working directory unknown'

  return (
    <>
      <Text bold wrap="truncate">{process.args}</Text>
      <Text dimColor wrap="truncate">
        {`pid ${process.pid} · parent ${parent?.name ?? '?'} (${process.ppid}) · ${process.user} · running ${formatDuration(process.elapsedSec)} · state ${process.stat}`}
      </Text>
      <Text wrap="truncate">
        <Text dimColor>{location}</Text>
        {ports.length > 0 && <Text dimColor>{LISTENING}</Text>}
        {ports.length > 0 && <Ports ports={ports} width={width - location.length - LISTENING.length} />}
      </Text>
      <Text dimColor wrap="truncate">{chainOf(process, byPid)}</Text>
      <FlagLine flags={process.flags} />
    </>
  )
}
