# ── Builder Stage ───────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.44.0-jammy AS builder

WORKDIR /app

# Install build tools for native addons (better-sqlite3, lancedb)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install ALL dependencies (including ts-node for TypeScript execution)
COPY package*.json ./
RUN npm ci

# ── Runtime Stage ────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# Install k6 (Runtime) — using signed GPG keyring (apt-key is deprecated on Jammy)
RUN apt-get update && apt-get install -y gnupg2 curl ca-certificates \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://dl.k6.io/key.gpg | gpg --dearmor -o /etc/apt/keyrings/k6-archive-keyring.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | tee /etc/apt/sources.list.d/k6.list \
    && apt-get update \
    && apt-get install -y k6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Ensure necessary writable directories exist
RUN mkdir -p .state \
    reports/attachments/screenshots \
    reports/attachments/network-logs \
    reports/attachments/console-logs \
    reports/html \
    reports/json \
    core/project-memory \
    tests/specs \
    tests/pages \
    tests/fixtures

# Copy node_modules (including ts-node & typescript) from builder
COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Grant full ownership to unprivileged pwuser so SQLite, reports, and generated scripts can be written
RUN chown -R pwuser:pwuser /app

# Drop to unprivileged user for security
USER pwuser

# Ensure Playwright browser cache path is preserved
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Expose ports: 8080 (Approval Webhook), 3000 (ARIA Dashboard)
EXPOSE 8080 3000

# Run the orchestrator by default
CMD ["npm", "run", "pipeline:start"]
