# Cloud Run container for Node.js API (server lives under project/server)
# Uses Node 20 LTS on a small Alpine base image.
FROM node:20-alpine

##
## Simplified: assume DOCKER BUILD CONTEXT = REPO ROOT.
## We always copy the project/ subfolder explicitly. This removes ambiguity that caused
## /app/project/server/index.js to be missing when APP_DIR was mis-set during Cloud Build.
## If you want to build from the project subfolder directly, use the separate project/Dockerfile instead.
##

ARG NODE_ENV=production
ARG MONGODB_URI="mongodb+srv://omranmahmoud888:pass12345@cluster0.3soglw6.mongodb.net/gamila?retryWrites=true&w=majority&appName=Cluster0"

WORKDIR /app/project

# Copy only the app's package manifest(s) first for better layer caching.
# Note: We copy both package.json and package-lock.json (if present) to leverage cache,
# but we will gracefully fall back to `npm install` if `npm ci` detects a mismatch.
# Copy the entire build context to a temp location, then detect the app root.
# This supports both contexts:
#  - repo root (expects project/package.json)
#  - project folder (expects package.json)
COPY . /tmp/context

# Detect app directory, copy into /app/project, then install production deps
RUN set -eux; \
		SRC=/tmp/context; \
		if [ -f "$SRC/package.json" ]; then \
			APP_DIR="$SRC"; \
		elif [ -f "$SRC/project/package.json" ]; then \
			APP_DIR="$SRC/project"; \
		else \
			echo "[error] Could not find package.json in build context or project/ subfolder"; \
			ls -la "$SRC" || true; \
			ls -la "$SRC/project" || true; \
			exit 1; \
		fi; \
		mkdir -p /app/project; \
		cp -R "$APP_DIR"/. /app/project/; \
		cd /app/project; \
		if [ -f package-lock.json ]; then \
			(npm ci --omit=dev || (echo "[warn] npm ci failed; removing lock and npm install --omit=dev" && rm -f package-lock.json && npm install --omit=dev)); \
		else \
			npm install --omit=dev; \
		fi; \
		rm -rf /tmp/context

# Optional diagnostic: show where the server entry should be
RUN set -eux; \
	echo "[diagnostic] Listing /app and /app/project and /app/server"; \
	ls -la /app || true; \
	ls -la /app/project || true; \
	ls -la /app/server || true

# Environment
ENV NODE_ENV=${NODE_ENV}
ENV MONGODB_URI=${MONGODB_URI}
# Cloud Run provides $PORT; default to 8080 for local runs
ENV PORT=8080

# Expose container port (for documentation; Cloud Run maps it)
EXPOSE 8080

# Start the API server: try common entry locations to be resilient across layouts
CMD ["/bin/sh", "-lc", "for p in /app/project/server/index.js /app/server/index.js /app/project/index.js /app/index.js; do if [ -f \"$p\" ]; then echo \"[startup] Starting node $p\"; exec node \"$p\"; fi; done; echo '[startup][error] No entry file found'; echo 'Tree of /app:'; ls -la /app; echo 'Tree of /app/project:'; ls -la /app/project || true; echo 'Tree of /app/server:'; ls -la /app/server || true; exit 1"]
