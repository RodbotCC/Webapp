# Comeketo Sales Command Center — container for Railway, Render, Fly.io, etc.
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3141

EXPOSE 3141

CMD ["node", "server.js"]
