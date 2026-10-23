# Self-hosted GitHub Actions runner image for MIRA CI (Bravo, Colima "gha" VM, arm64 Linux).
#
# Base: the official runner image (MIT). It already has the runner, Docker CLI + buildx and
# passwordless sudo for the `runner` user. On top we add what MIRA's workflows call WITHOUT a
# setup step, because GitHub's hosted ubuntu image ships them preinstalled:
#   gh (29 workflows), python3/pip (28/29), psql (12), jq (11), shellcheck (8), node/npm (13),
#   ripgrep, zip/unzip, build tools for pip wheels, the Compose v2 plugin (3 workflows). setup-python / setup-node / setup-bun still
#   install their own toolchains per job.
#
# Not supported here (kept on GitHub-hosted runners): Android SDK/emulator workflows.
FROM ghcr.io/actions/actions-runner:2.338.1

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg git jq unzip zip xz-utils \
      python3 python3-pip python3-venv python-is-python3 \
      build-essential libpq-dev postgresql-client \
      shellcheck ripgrep \
 && install -d -m 0755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=arm64 signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends gh nodejs \
 && curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \
      https://github.com/docker/compose/releases/download/v5.6.1/docker-compose-linux-aarch64 \
 && chmod 0755 /usr/local/lib/docker/cli-plugins/docker-compose \
 && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /home/runner/entrypoint.sh
RUN chmod 0755 /home/runner/entrypoint.sh
USER runner
ENTRYPOINT ["/home/runner/entrypoint.sh"]
