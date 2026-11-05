# ── 构建阶段：安装依赖并构建前端 + 打包后端 ──────────────────
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# VITE_ 变量在构建时打入前端包，通过 build arg 传入
ARG VITE_KIMI_AUTH_URL
ARG VITE_APP_ID
ENV VITE_KIMI_AUTH_URL=$VITE_KIMI_AUTH_URL \
    VITE_APP_ID=$VITE_APP_ID

RUN npm run build

# ── 运行阶段：后端已打包为单文件 dist/boot.js，无需 node_modules ──
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

EXPOSE 3000
CMD ["node", "dist/boot.js"]
