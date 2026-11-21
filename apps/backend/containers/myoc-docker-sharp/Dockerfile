FROM node:26-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node server.mjs preview.mjs avifColor.mjs animatedAvif.mjs ./

EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
