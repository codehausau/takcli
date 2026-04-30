FROM node:22-alpine AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json eslint.config.js vitest.config.ts ./
RUN corepack enable
RUN pnpm install --frozen-lockfile

COPY src ./src
COPY test ./test
COPY README.md ./
COPY scripts ./scripts
RUN pnpm build

FROM node:22-alpine AS prod-deps

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:22-alpine AS runtime

WORKDIR /app

COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY README.md ./
COPY scripts ./scripts

RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

USER node

ENTRYPOINT ["node", "/app/dist/cli.js"]
