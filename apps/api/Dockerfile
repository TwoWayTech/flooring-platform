# The API image (blueprint "Provider portability", rule 5: the API ships as a Docker image).
# Build from the repository root:  docker build -f apps/api/Dockerfile -t flooring-api .
# Run:  docker run -p 4000:4000 --env-file .env flooring-api   (variables: docs/environment.md)

FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "api..."
RUN pnpm --filter api build
RUN pnpm --filter api deploy --prod --legacy /out

FROM node:24-slim
ARG APP_VERSION=dev
ENV NODE_ENV=production APP_VERSION=$APP_VERSION API_PORT=4000
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]
