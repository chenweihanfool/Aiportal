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
# BASE_PATH 是「前端掛在網址哪一層」：預設 /aiportal/（路徑式託管，維持原行為）；
# 掛在網域根（例：反向代理把整個網域轉給本容器）請在建置時傳 --build-arg BASE_PATH=（空字串），
# 否則前端會把 API 打到 /aiportal/api/...（不存在）。compose 用法見 docker-compose.override.example.yml。
ARG BASE_PATH=/aiportal/
RUN BASE_PATH="${BASE_PATH}" pnpm --filter @workspace/gis-portal run build

FROM nginx:alpine AS runtime
COPY artifacts/gis-portal/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/artifacts/gis-portal/dist/public /usr/share/nginx/html
EXPOSE 80
