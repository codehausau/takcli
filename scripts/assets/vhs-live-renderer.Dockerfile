FROM node:22-bookworm AS node

FROM ghcr.io/charmbracelet/vhs

COPY --from=node /usr/local /usr/local
