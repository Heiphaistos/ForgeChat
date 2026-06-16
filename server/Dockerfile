FROM rust:slim-bookworm AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

# Étape 1 : compiler seulement les dépendances (cache Cargo)
COPY Cargo.toml Cargo.lock* ./
RUN mkdir -p src && echo "fn main(){}" > src/main.rs \
    && cargo build --release \
    && rm -rf src

# Étape 2 : compiler le vrai code — touch pour invalider le cache Cargo
COPY src ./src
COPY migrations ./migrations
RUN find src -name "*.rs" -exec touch {} + \
    && cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/forgechat .
COPY --from=builder /app/migrations ./migrations
RUN mkdir -p uploads
CMD ["./forgechat"]
