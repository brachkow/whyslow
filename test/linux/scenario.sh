#!/bin/sh
# Sets up processes worth explaining, then runs the given command
set -e

# A project with a dev server listening on a port; this shell becomes whyslow on exec, so it stays its parent
mkdir -p ~/site/.git
cd ~/site
node -e "require('node:http').createServer().listen(5173)" &
cd - > /dev/null

# A leftover: its parent shell exits right away, so pid 1 adopts it
sh -c 'cd /tmp && sleep 100000 &'

sleep 1
exec "$@"
