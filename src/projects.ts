import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const PROJECT_MARKERS = ['.git', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'Gemfile', 'deno.json']

const exists = (file: string) => fs.access(file).then(() => true, () => false)

const hasMarker = async (directory: string, markers: string[]) => {
  const found = await Promise.all(markers.map(marker => exists(path.join(directory, marker))))
  return found.some(Boolean)
}

const findUp = async (start: string, markers: string[]): Promise<string | null> => {
  const home = os.homedir()
  // Home itself is never a project, even when it is a dotfiles repo
  for (let directory = start; directory !== home && directory !== path.dirname(directory); directory = path.dirname(directory)) {
    if (await hasMarker(directory, markers)) {
      return directory
    }
  }
  return null
}

// Repository root wins over nested package manifests, so a monorepo stays one project
const findProjectRoot = async (cwd: string) =>
  (await findUp(cwd, ['.git'])) ?? findUp(cwd, PROJECT_MARKERS)

export const readProjectRoots = async (cwds: Iterable<string>): Promise<Map<string, string>> => {
  const unique = [...new Set(cwds)]
  const roots = await Promise.all(unique.map(findProjectRoot))

  return new Map(unique.flatMap((cwd, index) => {
    const root = roots[index]
    return root ? [[cwd, root] as const] : []
  }))
}
