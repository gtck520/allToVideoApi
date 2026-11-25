# LibTV OpenAI 兼容网关 Docker 镜像
# 镜像内不含任何凭据；凭据通过 volume 挂载（见 README「授权页面与 Docker 部署」）
FROM node:22-alpine

WORKDIR /app

# 只复制运行所需文件（.dockerignore 已排除 data/、.env、凭据等）
COPY package.json ./
COPY bin ./bin
COPY src ./src
COPY recipes ./recipes

ENV NODE_ENV=production
ENV GATEWAY_PORT=8787

EXPOSE 8787

# data/ 由 volume 提供；这里建空目录仅保证权限正确
RUN mkdir -p /app/data && chmod 700 /app/data

CMD ["node", "bin/gateway.mjs"]
