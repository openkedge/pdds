# Multi-stage reproducible Dockerfile for CAC v0.4 Research Artifact
FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /workspace

# Copy manifest files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages/ packages/
COPY tests/ tests/
COPY configs/ configs/
COPY study/ study/
COPY study-contract.json ./
COPY bin/ bin/
COPY artifact/ artifact/

# Install dependencies and build
RUN pnpm install --frozen-lockfile
RUN pnpm build

# Default command runs smoke test
CMD ["./artifact/run-smoke.sh"]
