import os from 'node:os'
import path from 'node:path'

const home = os.homedir()

export const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'whyslow')
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

export const STATE_DIR = path.join(process.env.XDG_STATE_HOME ?? path.join(home, '.local', 'state'), 'whyslow')
export const EVENTS_FILE = path.join(STATE_DIR, 'events.jsonl')
export const DAEMON_LOG_FILE = path.join(STATE_DIR, 'daemon.log')

export const LAUNCH_AGENT_LABEL = 'dev.whyslow.daemon'
export const LAUNCH_AGENT_FILE = path.join(home, 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`)
