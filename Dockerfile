FROM node:24.15.0-bookworm-slim AS build

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /usr/src/app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack prepare pnpm@11.1.1 --activate \
  && pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM node:24.15.0-alpine
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
USER node
WORKDIR /usr/src/app
COPY --chown=node:node --from=build /usr/src/app/node_modules /usr/src/app/node_modules
COPY --chown=node:node --from=build /usr/src/app/dist /usr/src/app/dist
CMD ["dumb-init", "node", "dist/index.js"]
