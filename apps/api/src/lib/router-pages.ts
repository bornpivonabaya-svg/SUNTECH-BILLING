/** Pages the MikroTik router serves from its hotspot folder, downloaded from the API. */
import { ALOGIN_PAGE_MARKER } from "@mashupkgrid/radius";
import { env } from "@mashupkgrid/config";

/**
 * Where the window goes once the phone is online. Normally the page the customer first asked for
 * ($(link-redirect)), but on a phone's own sign-in window that is the connectivity check it
 * opened with (Android's generate_204, Apple's hotspot-detect, Windows' connecttest…). A 204
 * answer loads nothing, so the window sat on this page and Android never closed it. Those checks
 * go to a real page instead: loading one is what makes the phone re-test and close the window.
 */
const ONLINE_LANDING_URL = "http://www.google.com/";
const CONNECTIVITY_CHECK = /generate_?204|gen_204|hotspot-detect|captive|connecttest|connectivity|ncsi|success\.txt|library\/test|kindle-wifi|nmcheck|mobile\/status\.php/i;

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
<!-- ${ALOGIN_PAGE_MARKER} -->
<html>
<head>
  <meta charset="utf-8">
  <title>You're online — ${name}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <noscript><meta http-equiv="refresh" content="3; url=${ONLINE_LANDING_URL}"></noscript>
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
    <p class="hint">You can close this window and use the internet as normal. If it stays open, tap &#10005; or &larr; at the top.<br>Unaweza kufunga dirisha hili na kuendelea kutumia intaneti. Likibaki wazi, gusa &#10005; au &larr; juu.</p>
    <a class="btn" id="go" href="${ONLINE_LANDING_URL}">Continue / Endelea</a>
    <p class="brand">${name}</p>
  </div>
  <script>
    (function () {
      var to = "${ONLINE_LANDING_URL}";
      try {
        var r = decodeURIComponent("$(link-redirect-esc)");
        if (/^https?:/i.test(r) && !${CONNECTIVITY_CHECK.toString()}.test(r)) to = r;
      } catch (e) {}
      document.getElementById("go").href = to;
      setTimeout(function () { window.location.replace(to); }, 3000);
    })();
  </script>
</body>
</html>
`;
}

/**
 * hotspot/login.html: sends the phone on to the ISP's hosted sign-in page, with the router's
 * $(…) values it needs to log the phone in afterwards. RouterOS fills those in when it serves the
 * file, so they stay literal here. "mkg-portal" marks it as the platform's page, and its exact
 * size (loginPageSize) is how a router checks it still has this page (see portalRepair).
 */
export function buildLoginPage(portalBase: string, tenantSlug: string): string {
  const target =
    `${portalBase}/hotspot/${tenantSlug}` +
    `?mac=$(mac)&ip=$(ip)&link-login-only=$(link-login-only-esc)&link-orig=$(link-orig-esc)&error=$(error-esc)`;
  return `<!DOCTYPE html>
<!-- mkg-portal -->
<html>
<head>
  <meta charset="utf-8">
  <title>Connecting to Wi-Fi…</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #090d16;
      color: #fff;
      text-align: center;
    }
    .box { max-width: 320px; padding: 24px; }
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid rgba(255,255,255,0.15);
      border-top-color: #38bdf8;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 16px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .title { font-size: 16px; font-weight: 700; margin: 0 0 8px; color: #f8fafc; }
    .sub { font-size: 12px; color: #94a3b8; margin: 0; }
  </style>
</head>
<body>
  <div class="box">
    <div class="spinner"></div>
    <p class="title" id="statusTitle">Connecting…</p>
    <p class="sub" id="statusMsg">Directing you to your Wi-Fi portal</p>
    <form name="login" method="post" action="$(link-login-only)" style="display:none;">
      <input type="hidden" name="username" id="formUser" value="$(username)">
      <input type="hidden" name="password" id="formPass" value="$(password)">
      <input type="hidden" name="dst" value="$(link-orig)">
    </form>
  </div>
  <script>
    (function() {
      try {
        var s = window.location.search || '';
        var h = window.location.hash || '';
        var query = s.indexOf('?') !== -1 ? s.substring(1) : (h.indexOf('?') !== -1 ? h.substring(h.indexOf('?') + 1) : '');
        var params = {};
        if (query) {
          var pairs = query.split('&');
          for (var i = 0; i < pairs.length; i++) {
            var idx = pairs[i].indexOf('=');
            if (idx > 0) {
              params[decodeURIComponent(pairs[i].substring(0, idx))] = decodeURIComponent(pairs[i].substring(idx + 1));
            }
          }
        }
        var u = params['username'] || params['user'] || params['code'];
        var p = params['password'] || params['pass'] || u;
        if (u) {
          document.getElementById('statusTitle').innerText = 'Activating Internet…';
          document.getElementById('statusMsg').innerText = 'Authenticating your Wi-Fi access code with the router…';
          document.getElementById('formUser').value = u;
          document.getElementById('formPass').value = p;
          document.forms['login'].submit();
          return;
        }
      } catch (e) {}
      // No credentials in URL — redirect to the hosted captive portal
      window.location.replace("${target}");
    })();
  </script>
  <noscript>
    <meta http-equiv="refresh" content="0;url=${target}">
  </noscript>
</body>
</html>`;
}

/** Bytes a router's copy of a page must have: what the router downloads and stores. */
export function pageSize(html: string): number {
  return Buffer.byteLength(html, "utf8");
}

/** Where the sign-in page sends phones: the web app's captive portal. */
export function loginPortalBase(): string {
  return (env as { APP_PORTAL_URL?: string }).APP_PORTAL_URL || "https://captive.suntechke.com";
}

/** Exact byte sizes of the two pages an ISP's routers download, so the router's report can spot a
 *  missing, cut-short or stock MikroTik page by size alone (see portalRepair in @mashupkgrid/radius). */
export function portalPageSizes(tenantSlug: string, tenantName: string): { login: number; alogin: number } {
  return {
    login: pageSize(buildLoginPage(loginPortalBase(), tenantSlug)),
    alogin: pageSize(buildAloginPage(tenantName)),
  };
}
