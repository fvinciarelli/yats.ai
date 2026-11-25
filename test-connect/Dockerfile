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
# pi.dev is NOT baked in: its npm install lives on the host and is bind-mounted
# read-only at runtime (see run-agent.sh → /opt/pi-agent). Zero image growth.
RUN npm install -g \
      @anthropic-ai/claude-code \
      @openai/codex \
      @google/gemini-cli \
      @github/copilot

# Cursor Agent CLI — official installer (no npm package), installed to /opt so
# the non-root `agent` user can run it (the installer writes under $HOME).
RUN mkdir -p /opt/cursor-agent && export HOME=/opt/cursor-agent && curl -fsS https://cursor.com/install | bash \
    && ln -sf /opt/cursor-agent/.local/bin/cursor-agent /usr/local/bin/agent \
    && ln -sf /opt/cursor-agent/.local/bin/cursor-agent /usr/local/bin/cursor-agent

# Non-root user: the image's built-in `node` user is uid/gid 1000, matching the
# host user so bind-mounted homes are writable. Claude Code refuses
# --dangerously-skip-permissions when running as root.
RUN mkdir -p /home/agent && chown node:node /home/agent

# YATS CLI from this branch's local pack
COPY yats-toolkit-*.tgz /tmp/
RUN npm install -g /tmp/yats-toolkit-*.tgz && rm -f /tmp/yats-toolkit-*.tgz

USER node

WORKDIR /work
CMD ["/bin/bash"]
