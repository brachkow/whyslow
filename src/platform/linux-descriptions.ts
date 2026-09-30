const DESCRIPTIONS: Record<string, string> = {
  'systemd': 'starts and supervises services',
  'systemd-journald': 'system log',
  'systemd-logind': 'login sessions, seats and power buttons',
  'systemd-udevd': 'device events and drivers',
  'systemd-resolved': 'DNS resolver',
  'systemd-networkd': 'network configuration',
  'systemd-timesyncd': 'clock synchronization',
  'systemd-oomd': 'kills processes before memory runs out',
  'systemd-userdbd': 'user and group lookups',
  'dbus-daemon': 'message bus between processes',
  'dbus-broker': 'message bus between processes',
  'dbus-broker-launch': 'message bus between processes',
  'NetworkManager': 'network connections',
  'wpa_supplicant': 'Wi-Fi authentication',
  'ModemManager': 'mobile broadband modems',
  'sshd': 'SSH server',
  'cron': 'scheduled jobs',
  'crond': 'scheduled jobs',
  'atd': 'one-off scheduled jobs',
  'polkitd': 'permission checks for privileged actions',
  'udisksd': 'mounting disks',
  'upowerd': 'battery and power information',
  'accounts-daemon': 'user account information',
  'rtkit-daemon': 'real-time scheduling for audio',
  'avahi-daemon': 'mDNS and local service discovery',
  'cupsd': 'printing',
  'bluetoothd': 'Bluetooth',
  'chronyd': 'clock synchronization',
  'rsyslogd': 'system log',
  'irqbalance': 'spreads hardware interrupts across CPUs',
  'thermald': 'thermal management',
  'power-profiles-daemon': 'power profiles',
  'fwupd': 'firmware updates',
  'packagekitd': 'package updates',
  'snapd': 'Snap packages',
  'containerd': 'container runtime',
  'containerd-shim-runc-v2': 'runs one container',
  'dockerd': 'Docker engine',
  'pipewire': 'audio and video streams',
  'pipewire-pulse': 'PulseAudio compatibility for PipeWire',
  'wireplumber': 'audio and video session manager for PipeWire',
  'pulseaudio': 'audio',
  'Xorg': 'X11 display server',
  'Xwayland': 'runs X11 apps on Wayland',
  'gnome-shell': 'GNOME desktop and compositor',
  'plasmashell': 'KDE Plasma desktop',
  'kwin_wayland': 'KDE window manager and compositor',
  'kwin_x11': 'KDE window manager',
  'gdm': 'login screen',
  'gdm-session-worker': 'login screen session',
  'sddm': 'login screen',
  'gvfsd': 'virtual file systems for apps (network shares, trash)',
  'tracker-miner-fs-3': 'GNOME search is indexing files',
  'localsearch-3': 'GNOME search is indexing files',
  'baloo_file': 'KDE search is indexing files',
  'baloo_file_extractor': 'KDE search is reading files to index them',
  'at-spi-bus-launcher': 'accessibility',
  'at-spi2-registryd': 'accessibility',
  'kthreadd': 'parent of all kernel threads',
}

export const describeLinuxProcess = (name: string): string | null => DESCRIPTIONS[name] ?? null

const LINUX_SYSTEM_PREFIXES = ['/usr/lib/', '/usr/libexec/', '/usr/sbin/', '/usr/bin/', '/lib/', '/sbin/', '/bin/']

export const isLinuxSystemPath = (command: string) =>
  LINUX_SYSTEM_PREFIXES.some(prefix => command.startsWith(prefix))

// Helpers the desktop runs on the user's behalf live here, while /usr/bin also holds the user's own tools
const LINUX_HELPER_PREFIXES = ['/usr/lib/', '/usr/libexec/', '/lib/']

export const isLinuxHelperPath = (command: string) =>
  LINUX_HELPER_PREFIXES.some(prefix => command.startsWith(prefix))
