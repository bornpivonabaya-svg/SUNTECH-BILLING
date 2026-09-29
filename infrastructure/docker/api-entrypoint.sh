#!/bin/sh
# Brings up the platform's own WireGuard interface inside this container's network namespace,
# then hands off to the API process.
#
# Why in the container rather than on the host: the API manages peers by shelling out to `wg`
# (packages/network/src/wireguard-peer.service.ts), so the interface has to live in a namespace
# this process can see. Giving the container host networking would do that too, but it would
# also drop it off the compose network -- and postgres/redis publish no host ports, so the API
# would lose its database and cache entirely. An interface owned by the container keeps the
# compose network intact, and routing to routers over the tunnel then works from this namespace
# where the API actually needs it.
#
# Requires: cap_add NET_ADMIN, a published UDP port, and the wireguard module on the host kernel
# (built in on Ubuntu 24.04). Every failure here is non-fatal -- a VPN that won't come up must
# not take the whole API down with it, so we warn and start anyway.
set -e

if [ "${ENABLE_WIREGUARD_REMOTE_ACCESS}" = "true" ]; then
  IFACE="${WIREGUARD_INTERFACE:-wg0}"
  PORT="${WIREGUARD_LISTEN_PORT:-51820}"
  # .1 of the pool is the server's own address -- allocateNextVpnIp() reserves it and hands
  # routers .2 upward, so these two must agree.
  SERVER_IP="$(echo "${WIREGUARD_SUBNET_CIDR:-10.90.0.0/16}" | sed 's#\.0/.*##').1"
  PREFIX="$(echo "${WIREGUARD_SUBNET_CIDR:-10.90.0.0/16}" | sed 's#.*/##')"

  # The generated key is kept in a volume (wireguard_key in docker-compose.prod.yml): a key kept
  # only inside the container changed on every rebuild, and every router's VPN then pointed at a
  # key the server no longer had.
  KEY_DIR="${WIREGUARD_KEY_DIR:-/var/lib/wireguard}"
  mkdir -p "${KEY_DIR}" 2>/dev/null || true
  if [ -z "${WIREGUARD_SERVER_PRIVATE_KEY}" ]; then
    if [ -s "${KEY_DIR}/server.key" ]; then
      WIREGUARD_SERVER_PRIVATE_KEY="$(cat "${KEY_DIR}/server.key")"
    elif [ -s /tmp/wg_server.key ]; then
      WIREGUARD_SERVER_PRIVATE_KEY="$(cat /tmp/wg_server.key)"
    else
      WIREGUARD_SERVER_PRIVATE_KEY="$(wg genkey 2>/dev/null || true)"
    fi
    if [ -n "${WIREGUARD_SERVER_PRIVATE_KEY}" ] && [ ! -s "${KEY_DIR}/server.key" ]; then
      (umask 077; printf '%s\n' "${WIREGUARD_SERVER_PRIVATE_KEY}" > "${KEY_DIR}/server.key") 2>/dev/null || true
    fi
  fi

  if [ -z "${WIREGUARD_SERVER_PRIVATE_KEY}" ]; then
    echo "[entrypoint] WARNING: wireguard-tools genkey unavailable; skipping ${IFACE}." >&2
  else
    echo "[entrypoint] Bringing up ${IFACE} on UDP ${PORT} at ${SERVER_IP}/${PREFIX}"
    {
      ip link add "${IFACE}" type wireguard
      umask 077
      printf '%s' "${WIREGUARD_SERVER_PRIVATE_KEY}" > /tmp/wg.key
      wg set "${IFACE}" listen-port "${PORT}" private-key /tmp/wg.key
      rm -f /tmp/wg.key
      ip address add "${SERVER_IP}/${PREFIX}" dev "${IFACE}"
      ip link set "${IFACE}" up
      echo "[entrypoint] ${IFACE} is up"
    } || echo "[entrypoint] WARNING: could not bring up ${IFACE}; remote router access will be unavailable. Check NET_ADMIN and the host wireguard module." >&2
  fi
fi

exec "$@"
