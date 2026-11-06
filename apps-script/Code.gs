/**
 * 졸업 고3 노트북 회수 체크 — 저장용 Apps Script
 *
 * 이 코드는 「고3 노트북 회수 체크 (2026)」 구글 시트에 붙여 넣어 씁니다.
 * (시트 메뉴: 확장 프로그램 → Apps Script)
 *
 * 1) 왼쪽 ⚙ 프로젝트 설정 → 스크립트 속성 → 속성 추가
 *      속성: PASSCODE   값: 담임 선생님들과 공유할 비밀번호
 * 2) 배포 → 새 배포 → 유형: 웹 앱
 *      실행 사용자: 나 / 액세스 권한: 모든 사용자
 * 3) 발급된 웹 앱 URL(…/exec)을 화면 쪽 config.js 의 API_URL 에 넣습니다.
 *
 * 학생 명단은 이 시트에만 있고, GitHub 저장소에는 올라가지 않습니다.
 */

var SHEET_NAME = '명단';
// 시트 열 순서 (1부터): 학번 반 번호 성명 비고 대여여부 노트북 어댑터 케이블 반납일 기기상태 메모 수정시각
var COL = { id: 1, cls: 2, no: 3, name: 4, note: 5, rent: 6, nb: 7, ad: 8, cb: 9, returnedAt: 10, cond: 11, memo: 12, updatedAt: 13 };
var RENT = ['', '대여', '미대여', '확인필요'];
var CONDS = ['', '정상', '파손', '부품누락', '분실'];

function doPost(e) {
  try {
    return handle_(e);
  } catch (err) {
    return out_({ ok: false, error: 'server_error', message: String(err && err.message || err) });
  }
}

function handle_(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad_request' }); }

  var pass = PropertiesService.getScriptProperties().getProperty('PASSCODE');
  if (!pass) return out_({ ok: false, error: 'no_passcode' });
  if (String(req.key || '') !== pass) { Utilities.sleep(1200); return out_({ ok: false, error: 'wrong_passcode' }); }

  if (req.action === 'list') return out_({ ok: true, rows: readAll_(), ts: new Date().toISOString() });
  if (req.action === 'update') return update_(req);
  if (req.action === 'bulk') return bulk_(req);
  return out_({ ok: false, error: 'unknown_action' });
}

function doGet() {
  return out_({ ok: true, service: 'g3-laptop-return' });
}

function sheet_() {
  // 시트의 「확장 프로그램 → Apps Script」에서 만든 스크립트면 바로 연결됩니다.
  // script.google.com 에서 따로 만든 스크립트라면 스크립트 속성 SHEET_ID 에 시트 ID를 넣으세요.
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    var sid = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    if (!sid) throw new Error('시트에 연결되지 않은 스크립트입니다. 스크립트 속성 SHEET_ID 에 구글 시트 ID를 넣어 주세요.');
    ss = SpreadsheetApp.openById(sid);
  }
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('「' + SHEET_NAME + '」 탭을 찾을 수 없습니다. 시트 탭 이름을 확인해 주세요.');
  return sh;
}

function readAll_() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var v = sh.getRange(2, 1, last - 1, 13).getDisplayValues();
  return v.filter(function (r) { return r[0]; }).map(rowObj_);
}

function rowObj_(r) {
  return {
    id: String(r[0]), cls: Number(r[1]), no: Number(r[2]), name: r[3], note: r[4],
    rent: r[5], nb: r[6] === '○', ad: r[7] === '○', cb: r[8] === '○',
    returnedAt: r[9], cond: r[10], memo: r[11], updatedAt: r[12]
  };
}

function update_(req) {
  var id = String(req.id || '');
  var p = req.patch || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet_();
    var ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getDisplayValues();
    var idx = -1;
    for (var i = 0; i < ids.length; i++) if (ids[i][0] === id) { idx = i; break; }
    if (idx < 0) return out_({ ok: false, error: 'not_found' });
    var row = idx + 2;

    var range = sh.getRange(row, COL.rent, 1, 8); // F:M
    range.setNumberFormat('@');
    var cur = range.getDisplayValues()[0];
    var set = function (col, val) { cur[col - COL.rent] = val; };

    if ('rent' in p) { if (RENT.indexOf(p.rent) < 0) return out_({ ok: false, error: 'bad_value' }); set(COL.rent, p.rent); }
    ['nb', 'ad', 'cb'].forEach(function (k) { if (k in p) set(COL[k], p[k] ? '○' : ''); });
    if ('returnedAt' in p) set(COL.returnedAt, String(p.returnedAt || '').slice(0, 10));
    if ('cond' in p) { if (CONDS.indexOf(p.cond) < 0) return out_({ ok: false, error: 'bad_value' }); set(COL.cond, p.cond); }
    if ('memo' in p) set(COL.memo, String(p.memo || '').slice(0, 200));
    set(COL.updatedAt, Utilities.formatDate(new Date(), 'Asia/Seoul', 'MM-dd HH:mm'));

    range.setValues([cur]);
    var full = sh.getRange(row, 1, 1, 13).getDisplayValues()[0];
    return out_({ ok: true, row: rowObj_(full) });
  } finally {
    lock.releaseLock();
  }
}

// 여러 학생을 한 번에 반납 처리 (반 전체 일괄 체크). 노트북·어댑터·케이블·반납일만 바꿉니다.
function bulk_(req) {
  var ids = (req.ids || []).map(String);
  var p = req.patch || {};
  if (!ids.length || ids.length > 60) return out_({ ok: false, error: 'bad_value' });
  var want = {}; ids.forEach(function (id) { want[id] = true; });
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = sheet_();
    var n = sh.getLastRow() - 1;
    if (n < 1) return out_({ ok: false, error: 'not_found' });
    var all = sh.getRange(2, 1, n, 13).getDisplayValues();
    var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'MM-dd HH:mm');
    var changed = [];
    for (var i = 0; i < all.length; i++) {
      if (!want[all[i][0]]) continue;
      var r = all[i];
      ['nb', 'ad', 'cb'].forEach(function (k) { if (k in p) r[COL[k] - 1] = p[k] ? '○' : ''; });
      if ('returnedAt' in p && !r[COL.returnedAt - 1]) r[COL.returnedAt - 1] = String(p.returnedAt || '').slice(0, 10);
      r[COL.updatedAt - 1] = stamp;
      changed.push(i);
    }
    if (!changed.length) return out_({ ok: false, error: 'not_found' });
    var block = sh.getRange(2, COL.nb, n, 7); // G:M
    block.setNumberFormat('@');
    block.setValues(all.map(function (r) { return r.slice(COL.nb - 1, 13); }));
    return out_({ ok: true, rows: changed.map(function (i) { return rowObj_(all[i]); }) });
  } finally {
    lock.releaseLock();
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
