FROM node:24-alpine AS build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./

RUN npm ci

COPY frontend/ ./

ENV VITE_API_BASE_URL=/api

RUN npm run build

FROM nginx:alpine

# Production defaults preserve the existing live routing. Northflank
# staging overrides these environment variables to point at its own API.
ENV API_UPSTREAM_URL=https://api.hypersynced.app
ENV API_UPSTREAM_HOST=api.hypersynced.app

COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template
COPY frontend/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
