# Build and review on the isolated runner host, then pin its sha256 image ID.
# No image pull, install or build occurs when a learner submits an answer.
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 g++ \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /workspace /opt/course-runner \
    && chown 10001:10001 /workspace
COPY container-exec.mjs /opt/course-runner/container-exec.mjs
USER 10001:10001
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/node", "/opt/course-runner/container-exec.mjs"]
