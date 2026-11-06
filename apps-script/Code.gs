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
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad_request' }); }

  var pass = PropertiesService.getScriptProperties().getProperty('PASSCODE');
  if (!pass) return out_({ ok: false, error: 'no_passcode' });
  if (String(req.key || '') !== pass) { Utilities.sleep(1200); return out_({ ok: false, error: 'wrong_passcode' }); }

  if (req.action === 'list') return out_({ ok: true, rows: readAll_(), ts: new Date().toISOString() });
  if (req.action === 'update') return update_(req);
  return out_({ ok: false, error: 'unknown_action' });
}

function doGet() {
  return out_({ ok: true, service: 'g3-laptop-return' });
}

function sheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
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

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
