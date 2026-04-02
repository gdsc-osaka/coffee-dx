FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS development-dependencies-env
COPY . /app
WORKDIR /app
RUN pnpm install --frozen-lockfile

FROM base AS production-dependencies-env
COPY . /app
WORKDIR /app
RUN pnpm install --frozen-lockfile --prod

FROM base AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN pnpm --filter drip build

FROM base
# ワークスペース全体の情報をコピー
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* /app/
COPY --from=build-env /app/apps/drip/package.json /app/apps/drip/package.json
# プロダクション用の依存をコピー
COPY --from=production-dependencies-env /app/node_modules /app/node_modules
COPY --from=production-dependencies-env /app/apps/drip/node_module[s] /app/apps/drip/node_modules
# 今回のフィルタービルドで出力されたディレクトリをコピー
COPY --from=build-env /app/apps/drip/build /app/apps/drip/build
WORKDIR /app
# セキュリティ向上のため、特権を持つ root ユーザーではなく一般ユーザー(node)として実行
USER node
CMD ["pnpm", "--filter", "drip", "start"]