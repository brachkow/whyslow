# whyslow

Answers what runs on your Mac and why. Processes are grouped by who is responsible for them, with a one-line explanation for each group, and you can kill a whole group or a single process. A background daemon notifies you when a stale process appears.

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
whyslow log [--limit N]          # what the daemon has reported
whyslow daemon run               # watcher in foreground
whyslow daemon install           # watcher as a LaunchAgent, starts at login
whyslow daemon uninstall
whyslow daemon status
```

Keys in the interactive view: `↑↓`/`jk` move, `→`/`l` expand a group, `←`/`h` collapse, `x` kill the selected group or process with its children (`y` SIGTERM, `f` SIGKILL), `a` show quiet groups, `s` toggle CPU/memory sort, `r` refresh, `q` quit

## Sections

- **Leftovers** — orphaned, stale or suspended processes, with the command they ran and where
- **Your projects** — processes working inside a repository (found via `.git` or a package manifest), with the commands running there, who started them (terminal, IDE, multiplexer) and listening ports
- **Apps** — everything that belongs to an `.app` bundle, including helpers and child processes; iOS Simulator devices are grouped together
- **Background agents** — LaunchAgents/LaunchDaemons (matched to their plist), third-party launchd jobs, self-daemonized processes and system-wide helpers
- **macOS** — system services with a built-in description for the common heavy ones (Spotlight, Time Machine, Photos analysis…), otherwise their launchd label or framework
- **Other** — the rest, explained by their parent

Groups with under 1% CPU and 100M memory are hidden in Apps, Background, macOS and Other until you press `a`

## Flags

- **orphan** — your process whose parent exited and that got adopted by launchd, while it doesn't look like an intentional daemon: it isn't a launchd job, isn't a session leader, and either its process group leader is gone or it still holds a terminal
- **stale** — an orphan alive longer than `staleOrphanAfterMin`, a zombie nobody reaped, or a job suspended with Ctrl+Z and forgotten
- **runaway** — CPU above `runawayCpuPercent` for longer than `runawayAfterMin`

An orphan can still be doing useful work, for example a long job started in the background by a tool whose shell has exited. Check the command and directory before killing it

The daemon reports `stale` and `runaway` once per process via macOS notifications, including where the process came from, and appends them to `~/.local/state/whyslow/events.jsonl`

## Config

Optional `~/.config/whyslow/config.json`, all keys are optional:

```json
{
  "staleOrphanAfterMin": 30,
  "stuckAfterMin": 10,
  "runawayCpuPercent": 80,
  "runawayAfterMin": 10,
  "daemonIntervalSec": 15,
  "ignore": ["crashpad_handler", "chrome_crashpad_handler", "crashhelper"]
}
```

## Development

```sh
pnpm test
pnpm lint
pnpm typecheck
```
