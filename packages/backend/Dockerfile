FROM node:20-slim

WORKDIR /app

# Copy shared package
COPY packages/shared/package.json packages/shared/
COPY packages/shared/dist/ packages/shared/dist/

# Copy backend package
COPY packages/backend/package.json packages/backend/
COPY packages/backend/dist/ packages/backend/dist/

# Copy root package files for workspace resolution
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install production dependencies only
RUN npm install -g pnpm && \
    pnpm install --prod --filter @doc-align/backend --filter @doc-align/shared

WORKDIR /app/packages/backend

ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
