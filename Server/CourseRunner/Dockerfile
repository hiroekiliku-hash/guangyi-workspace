# Build and review on the isolated runner host, then pin its sha256 image ID.
# No image pull, install or build occurs when a learner submits an answer.
FROM node:24-bookworm-slim@sha256:ec857ea6bb60cb3d0fa4d97495590c5fe7d51be8572c307b55957eeb06569cf7
ARG DEBIAN_MIRROR
RUN if [ -n "$DEBIAN_MIRROR" ]; then sed -i "s|http://deb.debian.org|$DEBIAN_MIRROR|g" /etc/apt/sources.list.d/debian.sources; fi \
    && apt-get update && apt-get install -y --no-install-recommends python3 g++ \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /workspace /opt/course-runner \
    && chown 10001:10001 /workspace
COPY container-exec.mjs cpp-basic-policy.mjs /opt/course-runner/
USER 10001:10001
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/node", "/opt/course-runner/container-exec.mjs"]
