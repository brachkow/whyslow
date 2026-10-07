# whyslow

Answers what runs on your computer and why, on macOS and Linux. Processes are grouped by who is responsible for them, with a one-line explanation for each group, and you can kill a whole group or a single process.

## Setup

```sh
mise install
pnpm i
pnpm build
pnpm add -g .       # makes `whyslow` available globally
```

The global install links to this folder, so run `pnpm build` after changing the code. `pnpm dev` runs the source directly via tsx

## Usage

```sh
whyslow                          # interactive view
whyslow list [--all] [--json]    # print what runs and why
```

Keys in the interactive view: `↑↓`/`jk` or the mouse wheel move, Enter or a click expands or collapses a group, `/` searches (Enter keeps the filter, Esc clears it), `x` kills the selected group or process with its children (`y` SIGTERM, `f` SIGKILL), `a` shows quiet groups, `s` cycles the sort between CPU, memory and runtime, `r` refreshes, `q` quits. whyslow never kills itself. On a zombie, `x` first asks its parent to collect it and only offers to stop the parent if it ignores that

## Sections

- **Leftovers** — orphaned, stale or suspended processes, with the command they ran and where
- **Your projects** — processes working inside a repository (found via `.git` or a package manifest), with the commands running there, who started them (terminal, IDE, multiplexer) and listening ports
- **Apps** — everything that belongs to an app, including helpers and child processes. On macOS that is an `.app` bundle (iOS Simulator devices are grouped together), on Linux the systemd scope a desktop environment starts each app in, named from its `.desktop` file, or a Snap
- **Background agents** — services that didn't ship with the OS: LaunchAgents/LaunchDaemons matched to their plist on macOS, systemd services and user services with units in `/etc` or your home on Linux, Docker containers, plus self-daemonized processes and system-wide helpers
- **macOS / System** — the OS itself, with a built-in description for common heavy services (Spotlight, Time Machine, journald, PipeWire…), otherwise their launchd label, systemd unit or framework. On Linux all kernel threads form one group
- **Other** — the rest, explained by their parent

Groups with under 1% CPU and 100M memory are hidden in Apps, Background, macOS/System and Other until you press `a`

## Flags

- **orphan** — your process whose parent exited and that got adopted by launchd, init or `systemd --user`, while it doesn't look like an intentional daemon: the service manager didn't start it, it isn't a session leader, and either its process group leader is gone or it still holds a terminal
- **stale** — an orphan alive longer than 30 minutes, or a zombie or a job suspended with Ctrl+Z left for more than 10 minutes
- **runaway** — at least 80% CPU for longer than 10 minutes

An orphan can still be doing useful work, for example a long job started in the background by a tool whose shell has exited. Check the command and directory before killing it

## Linux

Everything is read from `/proc`, so no `ps`, `lsof` or `ss` is needed. Ports and working directories are only visible for your own processes, like on macOS

## Development

```sh
pnpm test
pnpm lint
pnpm typecheck
pnpm test:linux     # the test suite inside a Linux container
pnpm start:linux    # the interactive view inside a Linux container, next to a sample project and a leftover
```

OS-specific code lives in `src/platform`: `darwin.ts` and `linux.ts` implement the same `Platform` interface
