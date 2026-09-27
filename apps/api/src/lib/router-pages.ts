/** Pages the MikroTik router serves from its hotspot folder, downloaded from the API. */

/** Escapes a tenant name for HTML, and drops "$(" so a name can't smuggle in a router variable. */
function escapeForRouterPage(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\$\(/g, "$ (");
}

export function buildAloginPage(tenantName: string): string {
  const name = escapeForRouterPage(tenantName);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>You're online — ${name}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="3; url=$(link-redirect)">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #090d16; color: #f8fafc; text-align: center; }
    .box { max-width: 340px; padding: 28px 24px; }
    .tick { width: 64px; height: 64px; border-radius: 50%; background: #10b981; color: #fff; font-size: 36px; line-height: 64px; margin: 0 auto 18px; }
    h1 { font-size: 22px; margin: 0 0 6px; }
    .sw { font-size: 14px; color: #a7f3d0; margin: 0 0 18px; }
    .time { font-size: 14px; color: #cbd5e1; margin: 0 0 22px; }
    .time b { color: #fff; }
    .hint { font-size: 13px; color: #94a3b8; line-height: 1.5; margin: 0 0 22px; }
    a.btn { display: inline-block; background: #0ea5e9; color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 12px 22px; border-radius: 10px; }
    .brand { margin-top: 26px; font-size: 12px; color: #64748b; }
  </style>
</head>
<body>
  <div class="box">
    <div class="tick">&#10003;</div>
    <h1>You're online</h1>
    <p class="sw">Umeunganishwa na intaneti</p>
    $(if session-time-left)<p class="time">Time left / Muda uliobaki: <b>$(session-time-left)</b></p>$(endif)
    <p class="hint">You can close this window and use the internet as normal.<br>Unaweza kufunga dirisha hili na kuendelea kutumia intaneti.</p>
    <a class="btn" href="$(link-redirect)">Continue / Endelea</a>
    <p class="brand">${name}</p>
  </div>
</body>
</html>
`;
}
