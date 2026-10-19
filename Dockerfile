# Multi-stage Dockerfile for Pliegos API and Worker
# Stage 1: Install all dependencies
FROM node:24-alpine AS deps
WORKDIR /app
RUN npm install -g pnpm@12
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# Stage 2: Compile TypeScript
FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@12
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY scripts ./scripts
RUN pnpm run build

# Stage 3: Minimal production runtime
FROM node:24-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache curl && npm install -g pnpm@12

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

COPY --from=build /app/dist ./dist
COPY migrations ./migrations

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health/live || exit 1

CMD ["node", "dist/src/main.js"]
