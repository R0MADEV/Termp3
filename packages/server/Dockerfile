# Relay de catunes — servidor de salas (headless, solo texto).
FROM oven/bun:1.3-alpine

WORKDIR /app

# El relay no tiene dependencias externas por ahora; copiamos su codigo.
COPY packages/server/package.json ./
COPY packages/server/src ./src

EXPOSE 3000
ENV PORT=3000

CMD ["bun", "run", "src/index.ts"]
