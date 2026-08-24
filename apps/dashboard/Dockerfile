# apps/dashboard - depende de packages/* via workspace, entao o build precisa da raiz
# do repo como contexto. Build a partir da raiz:
#   docker build -f apps/dashboard/Dockerfile -t durtone-dashboard .
FROM oven/bun:1 AS build
WORKDIR /repo

# NEXT_PUBLIC_* sao inlined no bundle do browser em build-time, nao dao pra trocar depois via
# `environment:` do compose/Fly como as outras envs - precisam chegar aqui como build args.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ARG NEXT_PUBLIC_EDGE_HOSTNAME=
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_EDGE_HOSTNAME=$NEXT_PUBLIC_EDGE_HOSTNAME

COPY . .
RUN bun install --frozen-lockfile
RUN cd apps/dashboard && bun run build

FROM oven/bun:1 AS runtime
WORKDIR /app

# next.config.ts define outputFileTracingRoot na raiz do workspace, entao o standalone ja
# vem com node_modules hoisted certo - so falta copiar static/public, que o "standalone"
# do Next nao inclui por padrao.
COPY --from=build /repo/apps/dashboard/.next/standalone ./
COPY --from=build /repo/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=build /repo/apps/dashboard/public ./apps/dashboard/public

ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /app/apps/dashboard

CMD ["bun", "server.js"]
