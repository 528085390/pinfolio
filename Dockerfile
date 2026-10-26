# syntax=docker/dockerfile:1
# 多阶段构建：build 里装全量依赖编前端 + 打服务端单文件，runtime 只装生产依赖。
# 选 Debian slim 而不是 alpine：node:sqlite 是内置模块，alpine 变体历史上出过编译差异。

FROM node:26-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@12.3.4
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json vite.config.ts ./
COPY server ./server
COPY web ./web
RUN pnpm build

FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7788 \
    PINBOARD_DATA=/data
WORKDIR /app
RUN npm install -g pnpm@12.3.4
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile && npm cache clean --force
COPY --from=build /app/dist ./dist
# /app 要给 node 用户可写：SNAPSHOT.md 写在应用根目录（写失败只打日志，但没必要天天刷警告）
RUN mkdir -p /data && chown -R node:node /app /data
USER node
VOLUME ["/data"]
EXPOSE 7788
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7788)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
