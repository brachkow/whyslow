export type KillSignal = 'SIGTERM' | 'SIGKILL'

export type KillResult = {
  killed: number[]
  failed: Array<{ pid: number, error: string }>
}

export const killProcesses = (pids: number[], signal: KillSignal): KillResult => {
  const result: KillResult = { killed: [], failed: [] }

  for (const pid of pids) {
    try {
      process.kill(pid, signal)
      result.killed.push(pid)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ESRCH') {
        continue
      }
      result.failed.push({ pid, error: code === 'EPERM' ? 'permission denied' : String(error) })
    }
  }

  return result
}

// SIGCHLD tells a parent that a child finished, which prompts well-behaved programs to collect their zombies
export const nudgeParent = (pid: number) => {
  try {
    return process.kill(pid, 'SIGCHLD')
  } catch {
    return false
  }
}
