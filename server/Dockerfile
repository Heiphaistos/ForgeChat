# rust:slim-bookworm (multi-arch, épinglé le 2026-10-10)
FROM rust:slim-bookworm@sha256:2c3a22f0a5533ea2dd5a16627bc841228151faa2d4de2644ac9987e4a2f1f2fa AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev curl && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main(){}" > src/main.rs && cargo build --release --locked && rm src/main.rs
COPY src ./src
COPY migrations ./migrations
# GIT_SHA busts Docker's own layer cache deterministically. Observed 2026-07-22: even
# with real source changes, `docker compose up -d --build` reported every layer
# (including this RUN) as CACHED and silently kept serving the old binary for a full
# day of deploys -- COPY's content-hash cache key was not reliably invalidating on this
# host. Referencing a per-commit ARG in the RUN's own command forces Docker to recompute
# this layer independent of whatever it decided about the COPY above.
ARG GIT_SHA=unknown
RUN echo "Building commit ${GIT_SHA}" && find /app/src -name "*.rs" -exec touch {} + && cargo build --release --locked

# Pas d'apt-get upgrade (non reproductible) : les correctifs viennent de l'image de base.
# Images épinglées par digest (audit 2026-10-10) : `--pull` ne les met plus à jour, il faut
# remplacer le digest (tag en commentaire ; registre Docker Hub, index multi-arch).
# debian:bookworm-slim (multi-arch, épinglé le 2026-10-10)
FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587
RUN apt-get update && apt-get install -y --no-install-recommends libssl3 ca-certificates curl && rm -rf /var/lib/apt/lists/* \
    && groupadd -r forgechat && useradd -r -g forgechat -d /app -s /sbin/nologin forgechat
WORKDIR /app
COPY --from=builder /app/target/release/forgechat .
COPY --from=builder /app/migrations ./migrations
RUN mkdir -p uploads && chown -R forgechat:forgechat /app
USER forgechat
CMD ["./forgechat"]
