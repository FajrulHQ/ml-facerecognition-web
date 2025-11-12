FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

ARG REACT_APP_RECOGNITION_API_URL
ENV REACT_APP_RECOGNITION_API_URL=${REACT_APP_RECOGNITION_API_URL}

RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /srv/app
RUN npm install -g serve

COPY --from=builder /app/build ./build

EXPOSE 3000
CMD ["serve", "-s", "build", "-l", "3000"]
