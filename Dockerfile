FROM node:20-alpine AS builder

# Install dependencies and build the React app
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

RUN npm run build

FROM nginx:1.27-alpine AS runner

# Copy custom nginx configuration (supports client-side routing)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the compiled React build output
COPY --from=builder /app/build /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
