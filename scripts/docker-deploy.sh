#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Starting or updating the rootless Quadlet stack"
systemctl --user daemon-reload
systemctl --user restart calendar-backend.service calendar-worker.service calendar-web.service
echo "Current container status"
podman ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' | grep '^calendar-' || true
