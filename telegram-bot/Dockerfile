FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc

# Remove source files and dev deps after build
RUN rm -rf src/ tsconfig.json

CMD ["node", "dist/index.js"]
