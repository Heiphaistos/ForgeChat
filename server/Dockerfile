FROM rust:slim-bookworm AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev curl && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml ./
RUN mkdir src && echo "fn main(){}" > src/main.rs && cargo build --release && rm src/main.rs
COPY src ./src
COPY migrations ./migrations
# Touch all .rs files so cargo detects changes (Docker COPY may set old timestamps)
RUN find /app/src -name "*.rs" -exec touch {} + && cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y libssl3 ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/forgechat .
COPY --from=builder /app/migrations ./migrations
RUN mkdir -p uploads
CMD ["./forgechat"]
