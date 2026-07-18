FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.mjs .

EXPOSE 8080
CMD ["node", "server.mjs"]
