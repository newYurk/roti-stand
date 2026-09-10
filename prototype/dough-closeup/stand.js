"use strict";
(async () => {
  const PIN = "306ef13881702ceee9d4edbb69bb748f402dc5f0";
  const PATH = "prototype/dough-closeup/index.html";
  const urls = [
    "https://cdn.jsdelivr.net/gh/newYurk/roti-stand@" + PIN + "/" + PATH,
    "https://raw.githubusercontent.com/newYurk/roti-stand/" + PIN + "/" + PATH
  ];
  let html = null, err = null;
  for (const url of urls) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(url + " → " + r.status);
      html = await r.text();
      break;
    } catch (e) { err = e; }
  }
  if (!html) {
    console.error(err);
    const live = document.getElementById("live");
    if (live) live.textContent = "не скачался стенд";
    return;
  }
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) {
    const live = document.getElementById("live");
    if (live) live.textContent = "в сборке нет скрипта";
    return;
  }
  let js = m[1].replace("let tossOk = 0, tossTry = 0;и", "let tossOk = 0, tossTry = 0;");
  const s = document.createElement("script");
  s.text = js;
  document.body.appendChild(s);
})();
