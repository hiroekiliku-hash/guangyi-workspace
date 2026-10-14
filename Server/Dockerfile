FROM node:24-bookworm-slim
WORKDIR /app
COPY server.mjs ./server.mjs
ENV NODE_ENV=production DATABASE_PATH=/data/workspace.sqlite PORT=8080 HOST=0.0.0.0
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
