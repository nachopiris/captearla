FROM node:22-slim

WORKDIR /app

# Prototype image: install all deps (incl. tsx) and run TypeScript directly,
# no separate build step. Simpler than a multi-stage build for a hackathon
# entry; trade image size for reliability.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npx", "tsx", "src/main.ts"]
