# Build context must be the monorepo root — same reason as api-server/Dockerfile.
#   docker build -f artifacts/gis-portal/Dockerfile -t aiportal-gis-portal .
#
# The build stage uses the glibc-based image (not alpine): pnpm-workspace.yaml's
# overrides deliberately exclude the musl builds of rollup/lightningcss/
# tailwindcss-oxide that `vite build` needs — those would be missing under Alpine.

FROM node:24 AS base
RUN corepack enable && corepack prepare pnpm@11.1.3 --activate

FROM base AS build
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@workspace/gis-portal..."
RUN pnpm --filter @workspace/gis-portal run build

FROM nginx:alpine AS runtime
COPY artifacts/gis-portal/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/artifacts/gis-portal/dist/public /usr/share/nginx/html
EXPOSE 80
