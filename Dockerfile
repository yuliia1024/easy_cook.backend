FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

USER node
EXPOSE 3000

# Migrations are applied on start-up.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
