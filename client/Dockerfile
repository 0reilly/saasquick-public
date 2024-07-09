# Build stage
FROM node:latest as build

WORKDIR /app

RUN npm i -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install

COPY postcss.config.js tailwind.config.js ./
COPY src/ ./src/
COPY public/ ./public/

RUN pnpm build

# Production stage
FROM nginx:alpine

COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
