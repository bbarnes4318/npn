# Minimal Dockerfile for the ACA Agent Onboarding Node/Express app
# Build a small image and run server.js

FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install dependencies first (leverages Docker layer caching)
COPY package*.json ./
RUN npm install --production

# Copy the rest of the app
COPY . .

# Environment defaults (override in DO App Platform if needed)
ENV PORT=3000 \
    AGENTS_DIR=/var/npn/agents \
    SUBMISSIONS_DIR=/var/npn/submissions \
    UPLOADS_DIR=/var/npn/uploads

# Create writable directories inside the container (will be backed by a DO volume in production)
RUN mkdir -p /var/npn/agents /var/npn/submissions /var/npn/uploads && \
    chown -R node:node /var/npn

USER node
EXPOSE 3000

# Healthcheck endpoint is available at /health
CMD ["node", "server.js"]
