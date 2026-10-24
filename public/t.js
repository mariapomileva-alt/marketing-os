/* Marketing OS visit counter. No cookies, no personal data: sends the page, the referrer and our own link tags.
   <script defer src="https://YOUR-MARKETING-OS/t.js" data-site="SITE_KEY" data-pt="APP_STORE_PROVIDER_TOKEN"></script> */
(function () {
  var s = document.currentScript;
  if (!s) return;
  var key = s.getAttribute("data-site");
  if (!key) return;
  var api = new URL("/api/t", s.src).toString();
  var pt = s.getAttribute("data-pt");
  var q = new URLSearchParams(location.search);
  // Your own visits: open the site once with ?mos_ignore=1 (or =0 to undo) and this browser is no longer counted.
  try {
    if (q.get("mos_ignore") === "1") localStorage.setItem("mos_ignore", "1");
    if (q.get("mos_ignore") === "0") localStorage.removeItem("mos_ignore");
    if (localStorage.getItem("mos_ignore") === "1") return;
  } catch (e) {}
  var landing = { r: document.referrer || "", us: q.get("utm_source"), um: q.get("utm_medium"), uc: q.get("utm_campaign"), ut: q.get("utm_content"), lp: location.pathname };
  // The first page of this visit decides the source (kept for this tab only, cleared when it closes).
  try {
    var saved = sessionStorage.getItem("mos_landing");
    var sameSite = landing.r && new URL(landing.r).host === location.host;
    if (saved && (sameSite || !landing.r) && !landing.us) { landing = JSON.parse(saved); if (!landing.lp) landing.lp = location.pathname; }
    else sessionStorage.setItem("mos_landing", JSON.stringify(landing));
  } catch (e) {}
  function send(kind) {
    var body = JSON.stringify({ k: key, kind: kind, p: location.pathname, lp: landing.lp, r: landing.r, us: landing.us, um: landing.um, uc: landing.uc, ut: landing.ut });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(api, new Blob([body], { type: "text/plain" }))) return;
    } catch (e) {}
    fetch(api, { method: "POST", body: body, keepalive: true, headers: { "content-type": "text/plain" } }).catch(function () {});
  }
  send("pageview");
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href*="apps.apple.com"]') : null;
    if (!a) return;
    if (pt) {
      try {
        var u = new URL(a.href);
        var host = landing.r ? new URL(landing.r).hostname.replace(/^www\./, "").split(".")[0] : "";
        var ct = ("web_" + (landing.us || host || "direct")).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 40);
        if (!u.searchParams.get("ct")) { u.searchParams.set("pt", pt); u.searchParams.set("ct", ct); u.searchParams.set("mt", "8"); a.href = u.toString(); }
      } catch (err) {}
    }
    send("app_store_click");
  }, true);
})();
