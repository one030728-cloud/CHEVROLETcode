# Cloud Run 배포용. 저장소 루트를 빌드 컨텍스트로 사용한다.
# backend/server.js가 형제 폴더 front-plugin/, pos-plugin/dist/를 정적 서빙하므로
# 이미지 안에 두 폴더가 모두 포함되어야 한다.
ARG CHEVROLET_API_BASE_URL=
FROM node:18-slim AS pos-plugin-build
ARG CHEVROLET_API_BASE_URL
WORKDIR /app/pos-plugin
COPY pos-plugin/package.json pos-plugin/package-lock.json* ./
RUN npm install
COPY pos-plugin/ ./
RUN CHEVROLET_API_BASE_URL="$CHEVROLET_API_BASE_URL" npm run build

FROM node:18-slim
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm install --omit=dev

COPY backend/ ./backend/
COPY front-plugin/ ./front-plugin/
COPY --from=pos-plugin-build /app/pos-plugin/dist ./pos-plugin/dist

RUN cd backend && npx prisma generate

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

WORKDIR /app/backend
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
