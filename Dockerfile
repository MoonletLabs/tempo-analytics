FROM node:22-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci


FROM deps AS build

COPY tsconfig*.json ./
COPY vite.config.ts eslint.config.js index.html ./
COPY postcss.config.js tailwind.config.js ./
COPY src ./src
COPY server ./server
COPY public ./public

RUN npm run build


FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8790

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-server ./dist-server

USER node

EXPOSE 8790

CMD ["node", "dist-server/index.js"]
