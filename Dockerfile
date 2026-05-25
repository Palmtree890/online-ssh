FROM node:20-alpine

# Install build deps for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy and install server dependencies first (layer caching)
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# Copy server source and client
COPY server/ ./server/
COPY client/ ./client/

# Create data and logs directories with open permissions so volume mounts are writable
RUN mkdir -p data logs && chmod 777 data logs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/auth/me || exit 1

CMD ["node", "server/src/index.js"]
