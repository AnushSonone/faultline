# Faultline public demo image: API-only binary + curated fixtures. The UI is
# the embed on anush.wiki/blog/faultline, which calls this API cross-origin.
# Local Docker now; the same image is the Oracle deploy artifact later (build
# with --platform linux/arm64 for Ampere).

# --- backend ---
FROM rust:1-slim AS backend
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY crates/ crates/
COPY apps/ apps/
RUN cargo build --release -p faultlined

# --- runtime ---
FROM debian:bookworm-slim
RUN useradd --system --home /app faultline
WORKDIR /app
COPY --from=backend /build/target/release/faultlined /app/faultlined
# .dockerignore trims fixtures to the 6 curated incidents.
COPY datasets/fixtures /data/fixtures
# Checkpoints need a writable dir for the non-root user (crash-test demo).
RUN mkdir -p /data/checkpoints && chown faultline /data/checkpoints

ENV FAULTLINE_ADDR=0.0.0.0:8080 \
    FAULTLINE_FIXTURES=/data/fixtures \
    FAULTLINE_CHECKPOINTS=/data/checkpoints \
    FAULTLINE_MAX_SESSIONS=24 \
    FAULTLINE_SESSION_TTL_S=900 \
    FAULTLINE_ALLOWED_INCIDENTS=rec-mem-001,eval-cpu-cart-007,re2ob-checkoutservice-mem-1,re2ob-currencyservice-delay-1,re2ob-recommendationservice-mem-1,re2ob-emailservice-cpu-1

USER faultline
EXPOSE 8080
CMD ["/app/faultlined"]
