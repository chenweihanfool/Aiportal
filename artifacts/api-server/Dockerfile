# Build context must be the monorepo root (not this directory) because this
# workspace depends on sibling packages (@workspace/db, @workspace/api-zod)
# and pnpm needs the full workspace to resolve the filtered install graph.
#   docker build -f artifacts/api-server/Dockerfile -t aiportal-api-server .
#
# The build stage uses the glibc-based image (not alpine) because
# pnpm-workspace.yaml's overrides deliberately exclude the musl builds of
# esbuild/rollup/lightningcss/tailwindcss-oxide — those native binaries would
# be missing under Alpine.

FROM node:24 AS base
RUN corepack enable && corepack prepare pnpm@11.1.3 --activate

FROM base AS build
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@workspace/api-server..."
RUN pnpm --filter @workspace/api-server run build

# esbuild bundles all workspace + npm dependencies into a single file, so the
# runtime image only needs the compiled output — no node_modules required.
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/artifacts/api-server/dist ./dist
EXPOSE 8080
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
