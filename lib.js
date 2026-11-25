'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const HOME = process.env.SP306_HOME || ROOT; // 테스트 시 별도 폴더 지정 가능
const DIRS = { data: path.join(HOME, 'data'), out: path.join(HOME, 'out'), logs: path.join(HOME, 'logs') };
const STATE_FILE = path.join(HOME, 'state.json');
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

// 설정: 비밀 값(API 키, 메일 계정, 수신자)은 코드에 두지 않고 환경변수(GitHub Secrets)로만 받는다. 공개 가능한 값만 기본값으로 둔다.
const cfg = {
  apiKey: process.env.TOMTOM_API_KEY || '',
  recipient: process.env.MAIL_TO || '',
  startDate: process.env.SP306_START_DATE || '2026-11-17',
  endDate: process.env.SP306_END_DATE || '2027-12-31',
  sendTimeKST: process.env.SP306_SEND_KST || '08:00',
  aggregationLeadMinutes: Number(process.env.SP306_LEAD_MIN || 60),
};
// SP-306: segments.json 은 5 km 단위 4구간이지만 3번(5 km)·4번(4.3 km)은 합쳐 구간 3(10.0–19.3 km, 실제 약 9.3 km)으로 쓴다.
const SEGMENTS_RAW = JSON.parse(fs.readFileSync(path.join(ROOT, 'segments.json'), 'utf8'));
const SEGMENTS = SEGMENTS_RAW.length === 4
  ? [SEGMENTS_RAW[0], SEGMENTS_RAW[1], { ...SEGMENTS_RAW[2], to: SEGMENTS_RAW[3].to, len: +(SEGMENTS_RAW[2].len + SEGMENTS_RAW[3].len).toFixed(2), path: SEGMENTS_RAW[2].path.concat(SEGMENTS_RAW[3].path.slice(1)), end: SEGMENTS_RAW[3].end }]
  : SEGMENTS_RAW;
const TZ = 'America/Sao_Paulo';
const pad = n => String(n).padStart(2, '0');

/* ---------- time (브라질 시간 기준) ---------- */
function brt(date = (process.env.SP306_FAKE_NOW ? new Date(process.env.SP306_FAKE_NOW) : new Date())) { // FAKE_NOW: 테스트 전용
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const g = t => parts.find(p => p.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hh: +g('hour'), mm: +g('minute') };
}
function addDays(ymd, n) {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function slotOf(b) { return `${pad(b.hh)}:${pad(Math.floor(b.mm / 15) * 15)}`; }
function allSlots() {
  const s = [];
  for (let h = 0; h < 24; h++) for (const m of [0, 15, 30, 45]) s.push(`${pad(h)}:${pad(m)}`);
  return s;
}
// 브라질 날짜+슬롯 → 한국 시간 라벨 (브라질은 서머타임 없음: UTC-3)
function kstLabel(ymd, slot) {
  const [y, mo, d] = ymd.split('-').map(Number), [h, mi] = slot.split(':').map(Number);
  const utc = new Date(Date.UTC(y, mo - 1, d, h + 3, mi));
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(utc);
  const g = t => p.find(x => x.type === t).value;
  return `${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`;
}

/* ---------- geometry ---------- */
const rad = x => x * Math.PI / 180;
function hav(a, b) {
  const R = 6371, dl = rad(b[0] - a[0]), dn = rad(b[1] - a[1]);
  const h = Math.sin(dl / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function pointAt(p, frac) {
  const cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + hav(p[i - 1], p[i]));
  const target = cum[cum.length - 1] * frac;
  const i = cum.findIndex(x => x >= target);
  if (i <= 0) return p[0];
  const t = (target - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
  return [p[i - 1][0] + t * (p[i][0] - p[i - 1][0]), p[i - 1][1] + t * (p[i][1] - p[i - 1][1])];
}
const M_LAT = 111320;
function bearing(a, b) { // 0=북, 90=동
  const dy = (b[0] - a[0]) * M_LAT, dx = (b[1] - a[1]) * M_LAT * Math.cos(rad(a[0]));
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
}
function offsetPoint(p, brg, m) {
  const b = rad(brg);
  return [p[0] + (m * Math.cos(b)) / M_LAT, p[1] + (m * Math.sin(b)) / (M_LAT * Math.cos(rad(p[0])))];
}
// 방향 정의 — 하행: SP-304 분기점 → SP-308 분기점. 브라질은 우측통행이므로 하행 차로는 하행 진행방향의 오른쪽(+90°), 상행 차로는 왼쪽(-90°)
const DIRECTIONS = [
  { key: 'down', label: '하행', desc: 'SP-304 → SP-308 방면', side: 90, reverse: false },
  { key: 'up', label: '상행', desc: 'SP-308 → SP-304 방면', side: -90, reverse: true },
];
// SP-330 (Anhanguera) — 진행방향이 남/북이라 「남행/북행」으로 부른다. sp330.json 은 gen_sp330.js 로 생성
const SP330 = JSON.parse(fs.readFileSync(path.join(ROOT, 'sp330.json'), 'utf8'));
const SEGMENTS330 = SP330.segments; // 교차점에서 남쪽 4 km 를 2 km × 2
// SP-308 (Rodovia do Açúcar): 23.017687°S 47.437383°W ~ 23.075715°S 47.403223°W 약 7.4 km 를 2 km 단위로 분할 (gen_roads.js)
const SP308 = JSON.parse(fs.readFileSync(path.join(ROOT, 'sp308.json'), 'utf8'));
const SEGMENTS308 = SP308.segments;
const DIRECTIONS308 = [
  { key: 'down', label: '남동행', desc: '남동쪽 방면(시작→끝)', reverse: false, side: 90 },
  { key: 'up', label: '북서행', desc: '북서쪽 방면(끝→시작)', reverse: false, side: 90 },
];
const DIRECTIONS330 = [
  { key: 'down', label: '남행', desc: '남쪽 방면', reverse: false, side: 90 },
  { key: 'up', label: '북행', desc: '북쪽 방면', reverse: false, side: 90 },
];
// 구간 중앙 지점과 그 지점의 도로 진행 방위(하행 기준)
// (1 km 단위 상세는 TomTom 세그먼트가 5 km 구간과 같아 구분되지 않으므로 수집·집계에서 제외함)
SEGMENTS.forEach(s => { s.sample = { p: pointAt(s.path, 0.5), brg: bearing(pointAt(s.path, 0.45), pointAt(s.path, 0.55)) }; });
// 수집·집계 단위 (15분 슬롯, 하행/상행, 브라질 현지 시간)
const GROUPS = [
  { key: 'segs', road: 'SP-306', unit: '5~10km', list: SEGMENTS, dirs: DIRECTIONS, label: i => `구간 ${i + 1}`, sheet: 'SP306 5~10km' },
  // SP-330: 구간마다 남행/북행 조회 지점과 진행 방위를 따로 가진다 (sample.down / sample.up). 방위는 이미 진행방향 기준이므로 reverse 없음
  { key: 'sp330', road: 'SP-330', unit: '2km', list: SEGMENTS330, dirs: DIRECTIONS330, label: i => `구간 ${i + 1}`, sheet: 'SP330 2km', perDirSample: true },
  { key: 'sp308', road: 'SP-308', unit: '2km', list: SEGMENTS308, dirs: DIRECTIONS308, label: i => `구간 ${i + 1}`, sheet: 'SP308 2km', perDirSample: true },
];

/* ---------- classification ---------- */
const LEVEL_NAMES = ['정보 없음', '원활', '서행', '지체', '정체', '통제'];
// 기준: thresholds.json (없거나 잘못되면 80/60/40). HTML 화면의 「기준 설정」에서 바꾼 값을 내보내 이 파일로 저장하면 엑셀·메일에도 적용된다.
function loadThresholds() {
  const d = { smooth: 80, slow: 60, delay: 40 };
  try {
    const t = JSON.parse(fs.readFileSync(path.join(ROOT, 'thresholds.json'), 'utf8'));
    const v = { smooth: +t.smooth, slow: +t.slow, delay: +t.delay };
    if (v.smooth <= 100 && v.smooth > v.slow && v.slow > v.delay && v.delay > 0) return v;
    console.error('thresholds.json 값이 올바르지 않아 기본값(80/60/40)을 씁니다.');
  } catch (e) {}
  return d;
}
const TH = loadThresholds();
function classify(cur, ff, closed) {
  if (closed) return 5;
  if (cur == null || !ff) return 0;
  const r = cur / ff * 100;
  return r >= TH.smooth ? 1 : r >= TH.slow ? 2 : r >= TH.delay ? 3 : 4;
}

/* ---------- state / log / data ---------- */
function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return { sent: {}, skipped: {} }; }
}
function writeState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }
function log(msg) {
  const line = `${new Date().toISOString()} [BRT ${brt().date} ${pad(brt().hh)}:${pad(brt().mm)}] ${msg}\n`;
  try { fs.appendFileSync(path.join(DIRS.logs, 'tick.log'), line); } catch (e) {}
  console.log(line.trim());
}
const dataFile = ymd => path.join(DIRS.data, ymd + '.jsonl');
function readDay(ymd) {
  const map = new Map();
  let txt = '';
  try { txt = fs.readFileSync(dataFile(ymd), 'utf8'); } catch (e) { return map; }
  for (const ln of txt.split('\n')) {
    if (!ln.trim()) continue;
    try { const o = JSON.parse(ln); if (o.segs && o.segs.length === 4) o.segs = [o.segs[0], o.segs[1], { down: o.segs[2].down || o.segs[3].down, up: o.segs[2].up || o.segs[3].up }]; map.set(o.slot, o); } catch (e) {}
  }
  return map;
}

/* ---------- 일일 보고 기간: 한국 발송 시각 기준 → 브라질 시간 직전 24시간 ----------
   발송 시각(기본 한국 08:00) − 집계 마감 여유(기본 60분) = 집계 마감(한국 07:00 = 브라질 19:00).
   보고 기간 = [마감 − 24시간, 마감) → 기본값은 브라질 전날 19:00 ~ 당일 19:00 (96슬롯, 빠지는 시간대 없음) */
const SEND_KST = cfg.sendTimeKST || '08:00';
const LEAD_MIN = cfg.aggregationLeadMinutes == null ? 60 : cfg.aggregationLeadMinutes;
const SLOT_MS = 15 * 60000;
/* 보고 기간 = 브라질 달력 하루 00:00 ~ 23:59. 발송 시각 − 집계 마감 여유(cutoff)까지 이미 끝난 "가장 최근의 브라질 하루"를 쓴다.
   예) 한국 11-19 08:00 발송 → 마감 한도 = 한국 07:00 = 브라질 11-18 19:00 → 이미 끝난 가장 최근 하루 = 브라질 11-17 (00:00~23:59)
   (브라질 11-18은 한국 08:00 시점에 아직 끝나지 않았으므로 담을 수 없음) */
function makeWindow(K) { // K: 발송일(한국 날짜 YYYY-MM-DD) — 상태 파일의 키로도 사용
  const [y, mo, d] = K.split('-').map(Number), [hh, mm] = SEND_KST.split(':').map(Number);
  const send = Date.UTC(y, mo - 1, d, hh - 9, mm); // 한국 시간 = UTC+9
  const cutoff = send - LEAD_MIN * 60000;
  const day = addDays(brt(new Date(cutoff)).date, -1);
  const [dy, dm, dd] = day.split('-').map(Number);
  const start = Date.UTC(dy, dm - 1, dd, 3), end = start + 24 * 3600000; // 브라질 00:00 = UTC 03:00 (현재 서머타임 없음)
  const slots = [];
  for (let t = start; t < end; t += SLOT_MS) slots.push({ date: day, slot: slotOf(brt(new Date(t))) });
  return { K, day, send, cutoff, start, end, slots };
}
function allReports() { // 수집 기간(브라질 startDate ~ endDate) 안의 하루를 담는 모든 보고
  const out = [];
  for (let K = cfg.startDate; K <= addDays(cfg.endDate, 4); K = addDays(K, 1)) { const w = makeWindow(K); if (w.day >= cfg.startDate && w.day <= cfg.endDate) out.push(w); }
  return out;
}
function fmtWin(w) { return `${w.day} 00:00 ~ 23:59`; }
function loadWindow(w) { // 슬롯별 수집 기록 (날짜가 두 개에 걸칠 수 있음)
  const days = {};
  return w.slots.map(s => { const d = days[s.date] || (days[s.date] = readDay(s.date)); return { date: s.date, slot: s.slot, rec: d.get(s.slot) || null }; });
}

// 문구: 도로 세그먼트 기준 (TomTom 기준) — 엑셀 「요약」 시트, 메일, HTML 하단에 같은 문구를 쓴다 (2026-11-19 실측)
const SEGMENT_NOTE = {
  title: '[ 도로 세그먼트 기준 - TomTom 기준 ]',
  lines: [
    '1) SP-306 구간 하행 19.9km은 1개의 세그먼트로 구성, 상행 약 7.8km 구간이 1개 세그먼트임 (원활기준 하행 87km/h, 상행 65km/h)',
    '   (참고: SP-306 상행 구간 2·3은 약 23.6km 1개 세그먼트, 원활기준 86km/h)',
    '2) SP-330 구간 19km 1개의 세그먼트임 (원활기준 102km/h)',
    '3) SP-308 구간 26km 1개의 세그먼트임 (원활기준 92km/h)',
  ],
};
module.exports = { SEGMENT_NOTE, TH, SP330, SEGMENTS330, DIRECTIONS330, SP308, SEGMENTS308, DIRECTIONS308, SEND_KST, LEAD_MIN, makeWindow, allReports, fmtWin, loadWindow, ROOT, HOME, DIRS, cfg, SEGMENTS, GROUPS, DIRECTIONS, TZ, pad, brt, addDays, slotOf, allSlots, hav, pointAt, bearing, offsetPoint, LEVEL_NAMES, classify, readState, writeState, log, dataFile, readDay };
