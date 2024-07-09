FROM node:latest

RUN apt-get update && \
    apt-get install -y docker.io docker-compose


WORKDIR /app

RUN npm i -g pnpm

ADD package.json /app/package.json
ADD pnpm-lock.yaml /app/pnpm-lock.yaml
RUN pnpm install

ADD config.js /app/config.js
ADD server.js /app/server.js
ADD utils/ /app/utils/
ADD models/ /app/models/


CMD ["pnpm", "start"]
