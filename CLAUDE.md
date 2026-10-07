# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

whyslow is a terminal tool (Ink + React on Node) that explains what runs on macOS and Linux and why: it groups processes by who is responsible for them, flags orphaned, stale and runaway ones, and can kill them. A daemon reports newly stale processes.

## Commands

Tools come from `mise.toml` (node, pnpm); dependencies via pnpm.

```sh
pnpm dev                                  # run the interactive view from source (tsx)
pnpm exec tsx src/cli.tsx list --all      # non-interactive output, quickest way to inspect classification
pnpm build                                # tsup bundle to dist/cli.js (the package bin)
pnpm test                                 # vitest
pnpm vitest run src/origin.test.ts -t "zombie"   # single file / test name
pnpm lint                                 # eslint, `pnpm lint --fix` applies the stylistic rules
pnpm typecheck
pnpm test:linux                           # test suite inside a Linux container (test/linux/compose.yaml)
pnpm start:linux                          # interactive view inside that container, next to a sample project and a leftover
```

The global `whyslow` (`pnpm add -g .`) links to this folder and runs `dist/`, so run `pnpm build` after changes to see them there.

## Architecture

One snapshot flows through these layers:

1. **`src/platform/`** — everything OS-specific behind the `Platform` interface (`types.ts`), chosen by `currentPlatform()`. `darwin.ts` uses `ps`, `lsof`, `launchctl`, `plutil`, `vm_stat`; `linux.ts` reads `/proc` directly (no `ps`/`lsof`/`ss`) and gets services and desktop apps from systemd cgroups. Pure parsers live in `*-parse.ts` so they are tested on any OS. Each platform also provides `PlatformRules` (`appOf`, `systemGroupOf`, `adopterName`): pure classification rules used by the shared code.
2. **`src/analyze.ts`** — `createTracker` turns raw processes into `AnalyzedProcess` with CPU % and flags. CPU is the cputime delta between two samples taken 1s apart (`snapshot.ts`), not `ps %cpu`. Orphan detection relies on `TrackerContext`: `adopterPids` (pid 1, plus `systemd --user` on Linux), `managedPids` (started by launchd/systemd) and `selfPid` (whyslow never flags itself).
3. **`src/origin.ts`** — `buildGroups` assigns every process an origin and merges them into `ProcessGroup`s per section (leftovers, projects, apps, background, system, other). Resolution order per process: leftover tree (orphan/stale root and its descendants; zombies grouped by parent) → adopters → own origin (app, project by working directory, non-system service, detached daemon) → inherit from parent (only for leftovers/apps/projects/background, never from adopters) → system group → other. Projects come from `projects.ts` (nearest `.git`, then package manifests, never `$HOME`).
4. **`src/snapshot.ts`** — glue: `readTrackerInput` (cheap, used every daemon tick) and `groupProcesses` (working directories, ports, detailed service definitions; slower).
5. **`src/ui/`** — Ink app. `layout.ts` holds the row model, the scrolling window and line→row mapping for mouse clicks; `App.tsx` owns state, keys, search, kill flow.
6. **`src/daemon.ts`** — loop on `readTrackerInput`, `reports.ts` dedupes events per process, `explain` resolves origins only when there is something to report.

## Things that are easy to get wrong

- Testing kills against real processes: only ever kill processes you started yourself (spawn a throwaway `sleep`/`perl` and select it, e.g. via `/` search). The first Leftovers row is usually a real user process.
- Zombies can't be killed; `x` nudges the parent with SIGCHLD and only then offers to stop the parent.
- Mouse tracking (`@ink-tools/ink-mouse`) sends SGR reports like `[<35;12;7M` through Ink's `useInput`, so text input (search) must filter them; `ink-text-input` would type them into the query.
- The library's own hit test treats a row's bottom edge as inclusive, which is why clicks go through a single list handler and `rowAtLine` instead of per-row handlers.
- Ink JSX text: `@stylistic` autofix splits `Text {value}` across lines and drops spaces, so build strings with template literals.
- macOS `ps` `comm` is the full executable path (may contain spaces), Linux `comm` is 15 chars; `ProcessInfo.command`/`name` normalize this.
- Linux times in `/proc/<pid>/stat` are in USER_HZ (100) ticks; memory is read from `status` VmRSS because page size varies on arm64.

## Tooling notes

- TypeScript is pinned to 6.0.x because typescript-eslint doesn't support 7.
- `eslint-config-fans` only targets `.ts`; `eslint.config.js` extends its globs to `.tsx`, disables `no-console` (CLI output) and allowlists `tsup` in `e18e/ban-dependencies`.
- `pnpm-workspace.yaml` allows esbuild's install script and blocks unrs-resolver's (its native binding comes via optional deps).
- `test/linux/` runs as the image's `node` user with `init: true`, so orphans are adopted by pid 1 like on a real system. It has no systemd or desktop session; app scopes, unit files and `systemd --user` adoption are covered by unit tests with fixtures instead.
