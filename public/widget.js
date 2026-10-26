// Embeddable chat widget: <script src="/widget.js" data-tenant="org_..." defer></script>
// Renders a floating launcher + panel talking to POST /api/chat.
(function () {
  var script = document.currentScript;
  var tenantId = script && script.dataset ? script.dataset.tenant : null;
  if (!tenantId) return;
  var origin = script && script.src ? new URL(script.src).origin : window.location.origin;

  var style = document.createElement("style");
  style.textContent =
    "#af-launcher{position:fixed;right:20px;bottom:20px;z-index:99999;width:56px;height:56px;border-radius:50%;border:0;background:oklch(.535 .205 294);color:#fff;font-size:24px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25)}" +
    "#af-panel{position:fixed;right:20px;bottom:88px;z-index:99999;width:min(380px,calc(100vw - 32px));height:520px;border-radius:14px;overflow:hidden;border:1px solid oklch(.535 .205 294);background:#fff;display:none;flex-direction:column;box-shadow:0 18px 50px rgba(0,0,0,.28);font-family:Arial,sans-serif}" +
    "#af-panel.open{display:flex}" +
    "#af-head{padding:12px 14px;background:oklch(.945 .033 295);font-weight:600;font-size:14px;border-bottom:1px solid #e6e1ef}" +
    "#af-body{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#fbf9f6}" +
    ".af-msg{max-width:85%;padding:9px 12px;border-radius:12px;font-size:14px;line-height:1.45;white-space:pre-wrap}" +
    ".af-msg.lead{align-self:flex-end;background:oklch(.535 .205 294);color:#fff;border-bottom-right-radius:4px}" +
    ".af-msg.agent{align-self:flex-start;background:#eee9f7;border-bottom-left-radius:4px}" +
    ".af-src{display:block;margin-top:5px;font-size:10px;opacity:.65}" +
    "#af-foot{display:flex;gap:6px;padding:9px;border-top:1px solid #e6e1ef}" +
    "#af-input{flex:1;border:1px solid #d9d2e6;border-radius:8px;padding:9px;font:inherit;font-size:14px}" +
    "#af-send{border:0;background:oklch(.535 .205 294);color:#fff;border-radius:8px;padding:0 14px;font-weight:600;cursor:pointer}";
  document.head.appendChild(style);

  var panel = document.createElement("div");
  panel.id = "af-panel";
  panel.innerHTML =
    '<div id="af-head">Admissions assistant · replies instantly</div>' +
    '<div id="af-body"></div>' +
    '<div id="af-foot">' +
    '<input id="af-input" placeholder="Ask about fees, dates, courses…" autocomplete="off" />' +
    '<button id="af-send">Send</button>' +
    "</div>";
  var launcher = document.createElement("button");
  launcher.id = "af-launcher";
  launcher.setAttribute("aria-label", "Open admissions chat");
  launcher.textContent = "💬";
  document.body.appendChild(panel);
  document.body.appendChild(launcher);

  var body = panel.querySelector("#af-body");
  var input = panel.querySelector("#af-input");
  var sendBtn = panel.querySelector("#af-send");
  var convId = null;
  var greeted = false;

  function add(role, content, sources) {
    var div = document.createElement("div");
    div.className = "af-msg " + role;
    div.textContent = content;
    if (sources && sources.length) {
      var s = document.createElement("span");
      s.className = "af-src";
      s.textContent = "Sources: " + sources.join(", ");
      div.appendChild(s);
    }
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  function send(text) {
    var content = (text != null ? text : input.value).trim();
    if (!content) return;
    input.value = "";
    add("lead", content);
    add("agent", "…");
    fetch(origin + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: tenantId, text: content, channel: "web_widget", conversationId: convId || undefined }),
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (r) {
        if (body.lastChild) body.removeChild(body.lastChild);
        if (r.ok) {
          convId = r.data.conversationId;
          add("agent", r.data.reply, r.data.sources);
        } else {
          add("agent", "Sorry, something went wrong. Please try again.");
        }
      })
      .catch(function () {
        if (body.lastChild) body.removeChild(body.lastChild);
        add("agent", "Network error — please try again.");
      });
  }

  launcher.onclick = function () {
    panel.classList.toggle("open");
    if (panel.classList.contains("open") && !greeted) {
      greeted = true;
      add("agent", "Hi! I can answer questions about admissions, fees, and dates right away. What would you like to know?");
      input.focus();
    }
  };
  sendBtn.onclick = function () { send(); };
  input.onkeydown = function (e) { if (e.key === "Enter") send(); };
})();
