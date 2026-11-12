# Build Orbe for Linux (AppImage + .deb) on Ubuntu 22.04 (glibc 2.35).
# Used by scripts/linux/build.sh; see that file for usage.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive \
    APPIMAGE_EXTRACT_AND_RUN=1 \
    NO_STRIP=true \
    PATH=/root/.cargo/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl wget file ca-certificates git pkg-config patchelf xdg-utils \
      libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev libssl-dev libdbus-1-dev libxdo-dev \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g pnpm@9 \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable

WORKDIR /build
COPY src/ ./
RUN pnpm install --frozen-lockfile
CMD ["sh", "-c", "pnpm tauri build --bundles appimage,deb && cp src-tauri/target/release/bundle/appimage/*.AppImage src-tauri/target/release/bundle/deb/*.deb /out/ && ls -la /out"]
