FROM rust:slim-bookworm AS builder
WORKDIR /app
RUN apt-get update && apt-get upgrade -y && apt-get install -y pkg-config libssl-dev curl && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml ./
RUN mkdir src && echo "fn main(){}" > src/main.rs && cargo build --release && rm src/main.rs
COPY src ./src
COPY migrations ./migrations
# GIT_SHA busts Docker's own layer cache deterministically. Observed 2026-07-22: even
# with real source changes, `docker compose up -d --build` reported every layer
# (including this RUN) as CACHED and silently kept serving the old binary for a full
# day of deploys -- COPY's content-hash cache key was not reliably invalidating on this
# host. Referencing a per-commit ARG in the RUN's own command forces Docker to recompute
# this layer independent of whatever it decided about the COPY above.
ARG GIT_SHA=unknown
RUN echo "Building commit ${GIT_SHA}" && find /app/src -name "*.rs" -exec touch {} + && cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get upgrade -y && apt-get install -y libssl3 ca-certificates curl && rm -rf /var/lib/apt/lists/* \
    && groupadd -r forgechat && useradd -r -g forgechat -d /app -s /sbin/nologin forgechat
WORKDIR /app
COPY --from=builder /app/target/release/forgechat .
COPY --from=builder /app/migrations ./migrations
RUN mkdir -p uploads && chown -R forgechat:forgechat /app
USER forgechat
CMD ["./forgechat"]
