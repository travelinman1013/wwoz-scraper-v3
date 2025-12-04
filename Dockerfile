# ==============================================================================
# Stage 1: Builder - Compile TypeScript
# ==============================================================================
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy TypeScript source and configuration
COPY tsconfig.json ./
COPY src/ ./src/

# Build the TypeScript project
RUN npm run build

# ==============================================================================
# Stage 2: Production - Runtime image with Playwright and Python
# ==============================================================================
FROM mcr.microsoft.com/playwright:v1.55.0-jammy AS production

# Install Python 3, pip, and timezone data for artist discovery pipeline
# Set timezone non-interactively before installing tzdata
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=America/Chicago
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    tzdata \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/bin/python

WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Note: Playwright base image already includes Chromium browser

# Copy compiled application from builder stage
COPY --from=builder /app/dist ./dist

# Copy data files (schedule.json, etc.)
COPY src/data/ ./src/data/

# Copy templates directory
COPY templates/ ./templates/

# Copy example config (actual config will be mounted at runtime)
COPY config/config.example.yaml ./config/config.example.yaml

# Copy Python files and install dependencies
COPY requirements.txt ./
COPY *.py ./
RUN pip3 install --no-cache-dir -r requirements.txt

# Create non-root user for security
RUN groupadd -r wwoz && useradd -r -g wwoz wwoz

# Create directories that need to be writable and set ownership
RUN mkdir -p /app/config/state && \
    chown -R wwoz:wwoz /app

# Set environment variables
ENV CONFIG_PATH=/app/config/config.yaml
ENV NODE_ENV=production

# Switch to non-root user
USER wwoz

# Use ENTRYPOINT so arguments can be appended
ENTRYPOINT ["node", "dist/index.js"]
