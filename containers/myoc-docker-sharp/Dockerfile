FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node server.mjs .

EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
