#!/usr/bin/env bash
# ==============================================================================
# MASHUPKGRID ISP — read-only health report for the production server.
#
#   sudo bash /opt/mashuphost/infrastructure/scripts/diagnose.sh
#
# Prints what is needed to debug the platform without logging in: deploy state, containers,
# recent errors, firewall and ports, WireGuard, RADIUS, routers, and the last M-Pesa payments.
# It changes nothing. Secrets are never printed: passwords, keys and tokens show only whether
# they are set, and phone numbers are masked. Paste the whole output back to whoever is helping.
# ==============================================================================

set -uo pipefail
TARGET_DIR="${1:-/opt/mashuphost}"
cd "$TARGET_DIR" 2>/dev/null || { echo "No $TARGET_DIR — pass the install folder as the first argument."; exit 1; }
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.production)

section() { printf '\n==================== %s ====================\n' "$1"; }
run() { "$@" 2>&1 || true; }

# One setting from .env.production, without sourcing the file (it holds secrets).
env_value() { grep -E "^$1=" .env.production 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

sql() {
  "${COMPOSE[@]}" exec -T postgres psql -U "$(env_value POSTGRES_USER)" -d "$(env_value POSTGRES_DB)" \
    -X -P pager=off -c "$1" 2>&1 || true
}

section "When and where"
date -u
echo "host: $(hostname)  uptime:$(uptime -p 2>/dev/null)"
echo "disk: $(df -h / | awk 'NR==2 {print $3" used of "$2" ("$5")"}')   memory: $(free -h | awk '/Mem:/ {print $3" used of "$2}')"

section "Deployed code"
run git log -1 --format='running: %h %s (%cr)'
git fetch -q origin main 2>/dev/null && run git log -1 origin/main --format='github main: %h %s (%cr)'
echo "--- last auto-deploy log lines"
run tail -n 15 auto-deploy.log

section "Containers"
run "${COMPOSE[@]}" ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
echo "--- migrations (last lines of the migrate job)"
run "${COMPOSE[@]}" logs --no-color --tail 8 migrate

section "Settings (secrets show only set / not set)"
SHOW="NODE_ENV APP_API_PUBLIC_URL APP_PORTAL_URL ROUTER_API_BASE_URL RADIUS_SERVER_HOST ENABLE_EMBEDDED_RADIUS_SERVER RADIUS_AUTH_PORT RADIUS_ACCT_PORT ENABLE_WIREGUARD_REMOTE_ACCESS WIREGUARD_INTERFACE WIREGUARD_SUBNET_CIDR WIREGUARD_SERVER_ENDPOINT WIREGUARD_LISTEN_PORT ENABLE_WINBOX_RELAY WINBOX_RELAY_PORT_RANGE ROUTER_MANAGEMENT_SOURCE TRUST_PROXY SANITY_PROJECT_ID SANITY_DATASET"
SECRET="MPESA_CALLBACK_TOKEN MPESA_CONSUMER_KEY MPESA_CONSUMER_SECRET MPESA_PASSKEY WIREGUARD_SERVER_PUBLIC_KEY WIREGUARD_SERVER_PRIVATE_KEY ENCRYPTION_KEY JWT_SECRET SANITY_READ_TOKEN SANITY_REVALIDATE_SECRET"
for k in $SHOW; do printf '%-34s %s\n' "$k" "$(env_value "$k" || true)"; done
for k in $SECRET; do printf '%-34s %s\n' "$k" "$([ -n "$(env_value "$k")" ] && echo set || echo 'NOT SET')"; done

section "Firewall and ports"
run sudo ufw status verbose
echo "--- listening (443 web, 1812/1813 RADIUS, 51820 WireGuard, 20000+ WinBox relay)"
run ss -lntup | grep -E ':(80|443|1812|1813|51820|4000|3000|200[0-9][0-9]|201[0-9][0-9])\b' | awk '{print $1, $5}' | sort -u
echo "--- Azure: also allow these INBOUND in the VM's Network Security Group:"
echo "    TCP 80,443 · UDP 1812,1813 (RADIUS) · UDP 51820 (WireGuard) · TCP 20000-20199 (WinBox)"

section "Public endpoints (from this server)"
for url in "$(env_value APP_API_PUBLIC_URL)/health" "$(env_value APP_PORTAL_URL)" "http://127.0.0.1:4000/health" "http://127.0.0.1:3000"; do
  [ -n "${url%%/health}" ] || continue
  printf '%-55s %s\n' "$url" "$(curl -s -o /dev/null -m 10 -w '%{http_code} in %{time_total}s' "$url" 2>&1)"
done

section "WireGuard (remote management)"
run "${COMPOSE[@]}" exec -T api sh -c 'wg show 2>/dev/null | grep -E "^(interface|peer|  latest handshake|  transfer|  allowed ips|  listening port)" | sed -E "s/^(peer: ).*/\1<hidden>/" || echo "wg not running in the api container"'

section "Recent errors — api (RADIUS runs in the worker)"
run "${COMPOSE[@]}" logs --no-color --since 3h api | grep -iE 'error|fail|exception|refused|timeout|429' | grep -v 'statusCode\":200' | tail -n 40
section "Recent errors — worker"
run "${COMPOSE[@]}" logs --no-color --since 3h worker | grep -iE 'error|fail|exception|refused|timeout' | tail -n 40
section "RADIUS activity — worker (last 3 h)"
run "${COMPOSE[@]}" logs --no-color --since 3h worker | grep -i '\[radius\]' | tail -n 25
section "Recent errors — web"
run "${COMPOSE[@]}" logs --no-color --since 3h web | grep -iE 'error|fail|exception' | tail -n 20

section "Routers"
sql "SELECT t.slug AS isp, r.name, r.status, r.host, r.\"vpnIp\",
            to_char(r.\"lastSeenAt\" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Nairobi','DD Mon HH24:MI:SS') AS last_seen_eat,
            r.\"cpuLoadPercent\" AS cpu, r.\"temperatureC\" AS temp, r.\"activeUsers\" AS users,
            r.\"routerOsVersion\" AS ros, r.\"boardName\" AS board, left(r.\"lastError\", 70) AS last_error
     FROM routers r JOIN tenants t ON t.id = r.\"tenantId\"
     WHERE r.\"deletedAt\" IS NULL ORDER BY r.\"lastSeenAt\" DESC NULLS LAST LIMIT 20;"
echo "--- RADIUS clients (routers allowed to ask RADIUS; source address must match the router's public IP)"
sql "SELECT n.nasname, n.shortname, r.name AS router FROM nas n LEFT JOIN routers r ON r.id = n.\"routerId\" ORDER BY n.id DESC LIMIT 20;"

section "M-Pesa: last 15 purchases"
sql "SELECT to_char(s.\"createdAt\" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Nairobi','DD Mon HH24:MI:SS') AS at_eat, t.slug AS isp,
            regexp_replace(s.phone, '^(\\d{5})\\d+(\\d{3})$', '\\1****\\2') AS phone,
            s.\"amountMinor\"/100 AS ksh, s.status, s.\"resultCode\" AS code, left(s.\"resultDesc\", 45) AS result,
            s.\"hotspotVoucherCode\" IS NOT NULL AS voucher, s.\"collectedBy\" AS via
     FROM mpesa_stk_requests s JOIN tenants t ON t.id = s.\"tenantId\"
     ORDER BY s.\"createdAt\" DESC LIMIT 15;"
echo "--- M-Pesa callbacks received (last 15). None at all = Safaricom can't reach the callback URL."
sql "SELECT to_char(\"receivedAt\" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Nairobi','DD Mon HH24:MI:SS') AS at_eat, \"eventType\", status,
            left(coalesce(\"errorMessage\", ''), 60) AS error, \"sourceIp\"
     FROM payment_webhook_events WHERE provider = 'MPESA' ORDER BY \"receivedAt\" DESC LIMIT 15;"
echo "--- M-Pesa settings per ISP (no secrets)"
sql "SELECT t.slug AS isp, t.\"collectionMode\", c.provider, c.environment, c.\"isActive\", c.shortcode, c.\"shortcodeType\"
     FROM payment_provider_configs c JOIN tenants t ON t.id = c.\"tenantId\" WHERE c.provider = 'MPESA';"

section "Hotspot vouchers and sessions"
sql "SELECT count(*) FILTER (WHERE \"createdAt\" > now() - interval '24 hours') AS vouchers_24h,
            count(*) FILTER (WHERE \"activatedAt\" IS NOT NULL AND \"createdAt\" > now() - interval '24 hours') AS used_24h
     FROM hotspot_vouchers;"
sql "SELECT count(*) AS radius_sessions_24h, count(*) FILTER (WHERE acctstoptime IS NULL) AS open_now
     FROM radacct WHERE acctstarttime > now() - interval '24 hours';"

section "Done"
echo "Send this whole output. Nothing on the server was changed."
