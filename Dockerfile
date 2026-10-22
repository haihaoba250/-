FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY server.js ./
COPY public ./public

USER node
EXPOSE 4318

CMD ["node", "server.js"]
