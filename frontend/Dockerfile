FROM docker.io/library/node:24-alpine AS build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend ./
# Force same-origin API paths for the Docker/Caddy deployment.
RUN VITE_API_BASE_URL= npm run build

FROM docker.io/library/caddy:2-alpine

RUN apk add --no-cache curl

COPY frontend/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv

EXPOSE 80

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
