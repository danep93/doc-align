FROM node:20-slim

RUN npm install -g pnpm

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy shared package source + build
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src/ packages/shared/src/
COPY packages/shared/dist/ packages/shared/dist/
COPY packages/shared/tsconfig.json packages/shared/

# Copy backend package source + build
COPY packages/backend/package.json packages/backend/
COPY packages/backend/src/ packages/backend/src/
COPY packages/backend/tsconfig.json packages/backend/

# Install all dependencies (tsx needed at runtime for ESM resolution)
RUN pnpm install --filter @doc-align/backend --filter @doc-align/shared

WORKDIR /app/packages/backend

ENV PORT=8080
EXPOSE 8080

CMD ["npx", "tsx", "src/index.ts"]
