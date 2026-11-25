# YATS agent lab — isolated environment for testing connect-installed configs.
# All agent CLIs live INSIDE this image; nothing is installed on the host.
# The local yats-toolkit (this branch, incl. connect templates) is packed
# in by build-image.sh and installed globally so `yats bridge` works here.
FROM node:22-slim

ENV DEBIAN_FRONTEND=noninteractive

# git (agents + fixture repos), ripgrep (Claude Code search tool),
# curl/tar (Cursor installer), python3 (benchmark helper scripts)
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ripgrep curl ca-certificates tar python3 \
    && rm -rf /var/lib/apt/lists/*

# AI agent CLIs from npm
RUN npm install -g \
      @anthropic-ai/claude-code \
      @openai/codex \
      @google/gemini-cli \
      @github/copilot

# Cursor Agent CLI — official installer (no npm package)
RUN curl -fsS https://cursor.com/install | bash

# YATS CLI from this branch's local pack
COPY yats-toolkit-*.tgz /tmp/
RUN npm install -g /tmp/yats-toolkit-*.tgz && rm -f /tmp/yats-toolkit-*.tgz

ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /work
CMD ["/bin/bash"]
