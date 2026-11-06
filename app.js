(function () {
  "use strict";
  var CFG = window.APP_CONFIG || {};
  var API = CFG.API_URL || "";
  var NCLS = CFG.CLASSES || 8;
  var ITEMS = [["nb", "노트북"], ["ad", "어댑터"], ["cb", "케이블"]];
  var CONDS = ["", "정상", "파손", "부품누락", "분실"];
  var CLS_STORE = "g3nb_cls";

  // 비밀번호는 메모리에만 둡니다. 새로고침하거나 창을 닫으면 다시 입력해야 합니다.
  var rows = new Map(), cls = 1, filter = "all", key = "", timer = null, lastSync = null;
  var pending = 0, queue = Promise.resolve();

  function $(id) { return document.getElementById(id); }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function status(t, err) { var s = $("status"); s.textContent = t || ""; s.className = "status" + (err ? " err" : ""); s.hidden = !t; }
  function today() { var d = new Date(); return (d.getMonth() + 1) + "/" + d.getDate(); }
  function errText(e) { return (e && (e.message || e.error)) || String(e); }

  // 예전 버전이 브라우저에 남긴 비밀번호 삭제
  try { localStorage.removeItem("g3nb_key"); sessionStorage.removeItem("g3nb_key"); } catch (e) { }

  function api(body) {
    body.key = key;
    // text/plain 으로 보내면 Apps Script 에서 CORS 사전 요청 없이 받을 수 있습니다.
    return fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), redirect: "follow" })
      .then(function (r) {
        if (!r.ok) throw { error: "http_" + r.status, message: "HTTP " + r.status };
        return r.text().then(function (t) {
          try { return JSON.parse(t); }
          catch (e) {
            var m = t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
            throw { error: "not_json", message: m || "응답 형식 오류" };
          }
        });
      })
      .then(function (j) { if (!j.ok) throw j; return j; });
  }

  function isDone(r) { return !!(r.nb && r.ad && r.cb); }
  function stateOf(r) { return isDone(r) ? "done" : ((r.nb || r.ad || r.cb) ? "partial" : "none"); }
  function stats(list) {
    var s = { n: list.length, done: 0, partial: 0, none: 0 };
    list.forEach(function (r) { s[stateOf(r)]++; });
    return s;
  }
  function byClass(c) { return Array.from(rows.values()).filter(function (r) { return r.cls === c; }).sort(function (a, b) { return a.no - b.no; }); }
  function pctOf(s) { return s.n ? Math.round(s.done / s.n * 100) : null; }

  function renderSummary() {
    var html = "", T = { n: 0, done: 0, partial: 0, none: 0 };
    for (var c = 1; c <= NCLS; c++) {
      var s = stats(byClass(c)); for (var k in T) T[k] += s[k];
      var p = pctOf(s);
      html += '<tr data-c="' + c + '"><td class="l"><strong>' + c + '반</strong></td><td>' + s.n + '</td><td>' + s.done + '</td><td>' + s.partial + '</td><td>' + s.none +
        '</td><td><div class="pct"><div class="bar"><i style="width:' + (p || 0) + '%"></i></div>' + (p === null ? "-" : p + "%") + '</div></td></tr>';
    }
    var tp = pctOf(T);
    html += '<tr class="total"><td class="l">합계</td><td>' + T.n + '</td><td>' + T.done + '</td><td>' + T.partial + '</td><td>' + T.none + '</td><td>' + (tp === null ? "-" : tp + "%") + '</td></tr>';
    $("sumBody").innerHTML = html;
    $("kRent").textContent = T.n;
    $("synced").textContent = lastSync ? ("마지막 동기화 " + lastSync.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })) : "";
  }
  function renderTabs() {
    var h = "";
    for (var c = 1; c <= NCLS; c++) {
      var s = stats(byClass(c));
      h += '<button type="button" data-c="' + c + '" aria-pressed="' + (c === cls) + '">' + c + '반<small>' + s.done + '/' + s.n + '</small></button>';
    }
    $("tabs").innerHTML = h;
    var on = $("tabs").querySelector('[aria-pressed="true"]');
    if (on && on.scrollIntoView && $("tabs").scrollWidth > $("tabs").clientWidth) on.scrollIntoView({ block: "nearest", inline: "center" });
  }
  function rowHtml(r) {
    var done = isDone(r);
    var chips = ITEMS.map(function (it) { return '<button type="button" class="chip" data-act="item" data-k="' + it[0] + '" aria-pressed="' + !!r[it[0]] + '">' + (r[it[0]] ? "✓ " : "") + it[1] + '</button>'; }).join("") +
      '<button type="button" class="chip all" data-act="all" aria-pressed="' + done + '">' + (done ? "✓ 3종 반납 완료" : "3종 한 번에 체크") + '</button>';
    var conds = CONDS.map(function (v) { return '<option value="' + v + '"' + (r.cond === v ? " selected" : "") + '>' + (v || "기기 상태") + '</option>'; }).join("");
    return '<li class="row ' + stateOf(r) + '" data-id="' + esc(r.id) + '"><span class="no">' + r.no + '</span>' +
      '<span class="who"><strong>' + esc(r.name) + '</strong><span class="sid">' + esc(r.id) + '</span>' + (r.note ? '<span class="note">' + esc(r.note) + '</span>' : "") + '</span>' +
      '<span class="chips" role="group" aria-label="' + esc(r.name) + ' 반납 품목">' + chips + '</span>' +
      '<div class="extra"><select id="cond-' + esc(r.id) + '" data-act="cond" class="' + (r.cond && r.cond !== "정상" ? "bad" : "") + '" aria-label="기기 상태">' + conds + '</select>' +
      '<input id="memo-' + esc(r.id) + '" data-act="memo" maxlength="200" enterkeyhint="done" placeholder="메모 (예: 12/5 반납 예정)" value="' + esc(r.memo) + '">' +
      '<span class="stamp">' + (r.returnedAt ? "반납 " + esc(r.returnedAt) : "") + '</span></div></li>';
  }
  function renderList() {
    var list = byClass(cls), s = stats(list);
    $("clsTitle").textContent = "3학년 " + cls + "반";
    $("clsMeta").textContent = "대상 " + s.n + "명 · 완전 반납 " + s.done + " · 일부 반납 " + s.partial + " · 미반납 " + s.none;
    var shown = list.filter(function (r) { return filter === "all" || (filter === "done" ? isDone(r) : !isDone(r)); });
    var a = document.activeElement, keep = (a && a.dataset && a.dataset.act === "memo") ? { id: a.id, v: a.value, s: a.selectionStart } : null;
    $("list").innerHTML = shown.length ? shown.map(rowHtml).join("") : '<li class="empty">이 조건에 해당하는 학생이 없습니다.</li>';
    if (keep) { var el = $(keep.id); if (el) { el.value = keep.v; el.focus(); try { el.setSelectionRange(keep.s, keep.s); } catch (e) { } } }
    var left = list.filter(function (r) { return !isDone(r); }).length;
    $("bulkBtn").disabled = !left;
    $("bulkBtn").textContent = left ? "이 반 미반납 " + left + "명 3종 반납 처리" : "이 반 전원 반납 완료";
  }
  function renderAll() {
    renderSummary(); renderTabs(); renderList();
    Array.prototype.forEach.call($("filters").querySelectorAll("[data-f]"), function (b) { b.setAttribute("aria-pressed", b.dataset.f === filter); });
  }
  function showMain(on) { ["sumPanel", "tabs", "classPanel"].forEach(function (id) { $(id).hidden = !on; }); }

  function load(first) {
    if (pending) return Promise.resolve(); // 저장 중에는 화면을 덮어쓰지 않음
    return api({ action: "list" }).then(function (j) {
      if (pending) return;
      rows = new Map(j.rows.map(function (r) { return [r.id, r]; }));
      lastSync = new Date();
      $("login").hidden = true; showMain(true); status("");
      renderAll();
    }).catch(function (e) {
      if (e && e.error === "wrong_passcode") { logout("비밀번호가 맞지 않습니다. 다시 입력해 주세요."); return; }
      if (e && e.error === "no_passcode") { status("Apps Script에 PASSCODE 스크립트 속성이 설정되지 않았습니다.", true); return; }
      status((first ? "명단을 불러오지 못했습니다." : "자동 동기화에 실패했습니다.") + " (원인: " + errText(e) + ")", true);
      if (first) { $("login").hidden = false; }
    });
  }

  function patchFor(r, p) {
    var after = Object.assign({}, r, p);
    p.returnedAt = isDone(after) ? (r.returnedAt || today()) : "";
    return p;
  }
  function save(id, patch) {
    var r = rows.get(id); if (!r) return;
    Object.assign(r, patch); renderAll();
    pending++;
    queue = queue.then(function () {
      return api({ action: "update", id: id, patch: patch }).then(function (j) { rows.set(id, j.row); })
        .catch(function (e) { status("저장하지 못했습니다. (원인: " + errText(e) + ")", true); });
    }).then(function () { pending--; if (!pending) { lastSync = new Date(); renderAll(); } });
  }
  // 반 전체 일괄 반납: 서버에 bulk 기능이 있으면 한 번에, 없으면 한 명씩 순서대로 저장
  function bulkDone(ids) {
    var patch = { nb: true, ad: true, cb: true, returnedAt: today() };
    ids.forEach(function (id) { var r = rows.get(id); Object.assign(r, { nb: true, ad: true, cb: true, returnedAt: r.returnedAt || patch.returnedAt }); });
    renderAll();
    pending++;
    $("bulkBtn").disabled = true;
    status(ids.length + "명 저장 중입니다…");
    queue = queue.then(function () {
      return api({ action: "bulk", ids: ids, patch: patch }).then(function (j) {
        (j.rows || []).forEach(function (r) { rows.set(r.id, r); });
        status("");
      }).catch(function (e) {
        if (!(e && e.error === "unknown_action")) throw e;
        var i = 0;
        return ids.reduce(function (p, id) {
          return p.then(function () {
            return api({ action: "update", id: id, patch: patch }).then(function (j) { rows.set(id, j.row); status("저장 중… " + (++i) + " / " + ids.length); });
          });
        }, Promise.resolve()).then(function () { status(""); });
      }).catch(function (e) { status("일부를 저장하지 못했습니다. (원인: " + errText(e) + ") 새로고침 후 확인해 주세요.", true); });
    }).then(function () { pending--; if (!pending) { lastSync = new Date(); renderAll(); } });
  }

  function start() {
    if (timer) clearInterval(timer);
    status("명단을 불러오는 중입니다…");
    load(true);
    timer = setInterval(function () { if (!document.hidden) load(false); }, (CFG.REFRESH_SECONDS || 20) * 1000);
  }
  function logout(msg) {
    if (timer) clearInterval(timer);
    key = ""; rows = new Map();
    showMain(false); $("login").hidden = false; status(""); $("bulkConfirm").hidden = true;
    var m = $("loginMsg"); if (msg) { m.textContent = msg; m.className = "hint err"; }
    $("pass").value = ""; $("pass").focus();
  }

  // 이벤트
  $("login").addEventListener("submit", function (e) {
    e.preventDefault(); key = $("pass").value.trim(); if (!key) return;
    $("pass").blur(); start();
  });
  $("logout").addEventListener("click", function () { logout(); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && key) load(false); });
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("button"); if (!t) return;
    if (t.closest("#tabs")) { cls = +t.dataset.c; filter = "all"; $("bulkConfirm").hidden = true; ls(CLS_STORE, String(cls)); renderAll(); return; }
    if (t.dataset.f) { filter = t.dataset.f; renderAll(); return; }
    var row = t.closest("li.row"); if (!row) return; var id = row.dataset.id, r = rows.get(id);
    if (t.dataset.act === "item") {
      var p = {}; p[t.dataset.k] = !r[t.dataset.k];
      save(id, patchFor(r, p));
    } else if (t.dataset.act === "all") {
      var v = !isDone(r);
      save(id, patchFor(r, { nb: v, ad: v, cb: v }));
    }
  });
  $("bulkBtn").addEventListener("click", function () {
    var left = byClass(cls).filter(function (r) { return !isDone(r); });
    if (!left.length) return;
    $("bulkMsg").textContent = cls + "반 미반납 " + left.length + "명을 노트북·어댑터·케이블 모두 반납으로 처리할까요?";
    $("bulkConfirm").hidden = false;
  });
  $("bulkNo").addEventListener("click", function () { $("bulkConfirm").hidden = true; });
  $("bulkYes").addEventListener("click", function () {
    $("bulkConfirm").hidden = true;
    var ids = byClass(cls).filter(function (r) { return !isDone(r); }).map(function (r) { return r.id; });
    if (ids.length) bulkDone(ids);
  });
  $("sumBody").addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-c]"); if (!tr) return;
    cls = +tr.dataset.c; filter = "all"; renderAll(); $("classPanel").scrollIntoView({ block: "start" });
  });
  document.addEventListener("change", function (e) {
    var t = e.target, row = t.closest && t.closest("li.row"); if (!row) return;
    if (t.dataset.act === "cond") save(row.dataset.id, { cond: t.value });
    if (t.dataset.act === "memo") save(row.dataset.id, { memo: t.value.slice(0, 200) });
  });
  $("dlBtn").addEventListener("click", function () {
    var lines = [["반", "번호", "학번", "성명", "비고(명렬표)", "노트북", "어댑터", "케이블", "반납일", "기기 상태", "메모"]];
    for (var c = 1; c <= NCLS; c++) byClass(c).forEach(function (r) { lines.push([c, r.no, r.id, r.name, r.note || "", r.nb ? "○" : "", r.ad ? "○" : "", r.cb ? "○" : "", r.returnedAt || "", r.cond || "", r.memo || ""]); });
    var csv = "﻿" + lines.map(function (l) { return l.map(function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","); }).join("\r\n");
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "고3_노트북_회수현황_" + today().replace("/", "월") + "일.csv"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  // 업체 회수 확인서 인쇄: 1쪽 반별 수량 요약 + 서명란, 이어서 반마다 1쪽 상세
  function O(b) { return b ? "○" : ""; }
  function buildPrint() {
    var d = new Date(), ds = d.getFullYear() + ". " + (d.getMonth() + 1) + ". " + d.getDate() + ".";
    var T = { n: 0, nb: 0, ad: 0, cb: 0, done: 0 }, sumRows = "", pages = "";
    for (var c = 1; c <= NCLS; c++) {
      var list = byClass(c);
      var k = { n: list.length, nb: 0, ad: 0, cb: 0, done: 0 };
      list.forEach(function (r) { if (r.nb) k.nb++; if (r.ad) k.ad++; if (r.cb) k.cb++; if (isDone(r)) k.done++; });
      for (var x in T) T[x] += k[x];
      sumRows += "<tr><td>" + c + "반</td><td>" + k.n + "</td><td>" + k.nb + "</td><td>" + k.ad + "</td><td>" + k.cb + "</td><td>" + k.done + "</td><td>" + (k.n - k.done) + "</td></tr>";
      pages += '<section class="pp"><h2>3학년 ' + c + '반 회수 내역</h2><p class="pm">대상 ' + k.n + '대 · 3종 완전 회수 ' + k.done + '대 · 미회수 ' + (k.n - k.done) + '대 · 출력일 ' + ds + '</p>' +
        '<table><thead><tr><th>번호</th><th>학번</th><th>성명</th><th>노트북</th><th>어댑터</th><th>케이블</th><th>기기 상태</th><th>메모</th></tr></thead><tbody>' +
        list.map(function (r) { return '<tr class="' + (isDone(r) ? "" : "miss") + '"><td>' + r.no + "</td><td>" + esc(r.id) + "</td><td>" + esc(r.name) + "</td><td>" + O(r.nb) + "</td><td>" + O(r.ad) + "</td><td>" + O(r.cb) + "</td><td>" + esc(r.cond) + '</td><td class="l">' + esc(r.memo) + "</td></tr>"; }).join("") +
        "</tbody></table></section>";
    }
    var head = '<section class="pp"><h1>졸업 고3 노트북 회수 확인서</h1>' +
      '<table class="meta"><tr><th>학교</th><td>조선대학교부속고등학교</td><th>회수일</th><td>' + ds + '</td></tr>' +
      '<tr><th>회수 장소</th><td></td><th>필수 반납 품목</th><td>노트북 · 어댑터 · 케이블</td></tr></table>' +
      '<table><thead><tr><th>반</th><th>대상 수량</th><th>노트북 회수</th><th>어댑터 회수</th><th>케이블 회수</th><th>3종 완전 회수</th><th>미회수</th></tr></thead><tbody>' + sumRows +
      '<tr class="tot"><td>합계</td><td>' + T.n + "</td><td>" + T.nb + "</td><td>" + T.ad + "</td><td>" + T.cb + "</td><td>" + T.done + "</td><td>" + (T.n - T.done) + "</td></tr></tbody></table>" +
      '<p class="pm">위 수량의 노트북(어댑터·케이블 포함)을 인계·인수하였음을 확인합니다.</p>' +
      '<table class="sign"><tr><th>학교 담당자</th><td>소속/직급:</td><td>성명:</td><td>(서명)</td></tr>' +
      '<tr><th>회수 업체 담당자</th><td>업체명:</td><td>성명:</td><td>(서명)</td></tr></table></section>';
    $("print").innerHTML = head + pages;
  }
  $("printBtn").addEventListener("click", function () { buildPrint(); window.print(); });

  // 시작
  var c0 = +ls(CLS_STORE); if (c0 >= 1 && c0 <= NCLS) cls = c0;
  if (!API) { status("아직 저장소(Apps Script) 주소가 연결되지 않았습니다. config.js 의 API_URL 을 설정해 주세요.", true); return; }
  status(""); $("login").hidden = false;
})();
