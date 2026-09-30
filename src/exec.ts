import { execFile } from 'node:child_process'

// `ps args` of every process on the machine can easily exceed the 1MB default
const MAX_BUFFER = 64 * 1024 * 1024

export type ExecResult = {
  stdout: string
  exitCode: number
}

export const exec = (file: string, args: string[], env?: NodeJS.ProcessEnv) =>
  new Promise<ExecResult>((resolve) => {
    execFile(file, args, { env, maxBuffer: MAX_BUFFER }, (error, stdout) => {
      resolve({ stdout, exitCode: error ? Number(error.code ?? 1) : 0 })
    })
  })

export const execOrThrow = async (file: string, args: string[], env?: NodeJS.ProcessEnv) => {
  const result = await exec(file, args, env)
  if (result.exitCode !== 0) {
    throw new Error(`${file} ${args.join(' ')} exited with ${result.exitCode}`)
  }
  return result.stdout
}
