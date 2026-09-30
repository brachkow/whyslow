FROM node:26-bookworm-slim

RUN npm install --global pnpm@12.6.0

# The image's regular user, so the "your processes" logic applies like on a desktop
USER node
WORKDIR /home/node/whyslow

COPY --chown=node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY --chown=node . .
RUN pnpm build

ENTRYPOINT ["test/linux/scenario.sh"]
CMD ["node", "dist/cli.js", "list"]
