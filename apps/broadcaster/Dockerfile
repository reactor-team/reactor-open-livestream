FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/broadcaster/package.json apps/broadcaster/package.json
RUN pnpm install --frozen-lockfile --filter @reactor/infinite-broadcaster...

COPY packages/contracts packages/contracts
COPY apps/broadcaster apps/broadcaster
RUN pnpm --filter @reactor/infinite-broadcaster build

FROM mcr.microsoft.com/playwright:v1.62.1-noble
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
CMD ["node", "apps/broadcaster/dist/supervisor.js"]
