'use strict';
// TomTom 15분 속도 로그(data 브랜치의 data/날짜.jsonl)를 기간별 엑셀로 내보낸다.
//   - 일일 보고 엑셀(daily-report)과 달리 "하루 단위 보고"가 아니라, 지정한 기간(브라질 날짜)의 15분 기록을 한 파일에 모은다.
//   - 환경변수:
//       SP306_HOME  로그가 있는 폴더 (기본 = 이 폴더; GitHub Actions 에서는 data 브랜치를 체크아웃한 store 폴더)
//       EXPORT_FROM / EXPORT_TO  브라질 날짜(YYYY-MM-DD). 비우면 수집 기록이 있는 처음~마지막 날짜 전체
//       EXPORT_OUT  결과 폴더 (기본 ./out)
//   - 시트: 15분 기록(도로·구간·방향별 세로 형식) / 일별 요약 / 수집 현황 / 설명
//   - 값은 수집된 15분 슬롯의 첫 조회값이며, 수집이 안 된 슬롯은 행이 없다(수집 현황 시트에서 빈 슬롯 수 확인).
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const L = require('./lib');
const { GROUPS, LEVEL_NAMES, classify, TH, DIRS, addDays, allSlots, readDay } = L;

const OUT = process.env.EXPORT_OUT || path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const pad = n => String(n).padStart(2, '0');
const log = m => console.log(`${new Date().toISOString()} ${m}`);
const TZ_NOTE = '브라질 현지 시간(상파울루주 · America/Sao_Paulo · UTC−3) 기준';

/* ---------- 기간 결정 ---------- */
function availableDays() {
  let f = [];
  try { f = fs.readdirSync(DIRS.data); } catch (e) {}
  return f.filter(x => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(x)).map(x => x.slice(0, 10)).sort();
}
const days = availableDays();
if (!days.length) { console.error('ERR 수집 기록(data/날짜.jsonl)이 없습니다. SP306_HOME 이 data 브랜치를 가리키는지 확인하세요.'); process.exit(1); }
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
let from = process.env.EXPORT_FROM || days[0], to = process.env.EXPORT_TO || days[days.length - 1];
if (!validDate(from) || !validDate(to)) { console.error(`ERR 날짜 형식이 올바르지 않습니다 (from=${from}, to=${to}). YYYY-MM-DD 로 입력하세요.`); process.exit(1); }
if (from > to) { console.error(`ERR 시작일(${from})이 종료일(${to})보다 늦습니다.`); process.exit(1); }
if (from < days[0]) from = days[0];
if (to > days[days.length - 1]) to = days[days.length - 1];
const range = []; for (let d = from; d <= to; d = addDays(d, 1)) range.push(d);
log(`내보낼 기간(브라질 날짜): ${from} ~ ${to} (${range.length}일) | 로그가 있는 날 ${range.filter(d => days.includes(d)).length}일`);

/* ---------- 스타일 ---------- */
const HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F6B4F' } };
const thin = { style: 'thin', color: { argb: 'FFD0D4D8' } }, BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const FILL = { 0: 'FFE3E5E7', 1: 'FF9BD8B0', 2: 'FFF6E08A', 3: 'FFF4B183', 4: 'FFEF8B86', 5: 'FFC9A3DC' };
const fillOf = lv => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[lv] } });
function header(ws, row, widths) {
  ws.getRow(row).eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = HEAD; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = BORDER; });
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}
const rangeTxt = s => `${s.from.toFixed(1)}–${s.to.toFixed(1)} km`;
const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

/* ---------- 집계 ---------- */
// 상세 행: 슬롯 × 도로 × 구간 × 방향
const detail = [];                // {date, slot, road, seg, rng, dir, cur, ff, ratio, lv, delay, conf, closed}
const perDay = new Map();         // date -> {slots:Set, rows:[...]}
const slotCount = new Map();      // date -> 슬롯 수
for (const d of range) {
  const m = readDay(d); slotCount.set(d, m.size);
  for (const slot of allSlots()) {
    const rec = m.get(slot); if (!rec) continue;
    for (const g of GROUPS) for (const [i, s] of g.list.entries()) for (const dir of g.dirs) {
      const v = rec[g.key] && rec[g.key][i] && rec[g.key][i][dir.key]; if (!v) continue;
      const lv = classify(v.cur, v.ff, v.closed);
      detail.push({ date: d, slot, road: g.road, seg: i + 1, rng: rangeTxt(s), dir: dir.label, cur: v.cur, ff: v.ff, ratio: v.ff ? Math.round(v.cur / v.ff * 100) : null, lv, delay: v.delay, conf: v.conf, closed: v.closed ? 1 : 0, at: rec.at });
    }
  }
}
log(`15분 기록 행 ${detail.length.toLocaleString()}개 (수집된 슬롯 ${[...slotCount.values()].reduce((a, b) => a + b, 0)}칸)`);
if (!detail.length) { console.error('ERR 이 기간에 수집된 속도 기록이 없습니다.'); process.exit(1); }

/* ---------- 엑셀 ---------- */
async function build(outFile) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'SP306-TRAFFIC speed-export'; wb.created = new Date();

  /* 1) 15분 기록 */
  const s1 = wb.addWorksheet('15분 기록', { views: [{ state: 'frozen', ySplit: 3 }] });
  s1.mergeCells('A1:N1');
  s1.getCell('A1').value = `TomTom 15분 속도 기록 · 브라질 ${from} ~ ${to} · ${TZ_NOTE} · 슬롯의 첫 조회값(수집되지 않은 슬롯은 행이 없음)`;
  s1.getCell('A1').font = { bold: true, size: 13 };
  s1.addRow([]);
  s1.addRow(['날짜(브라질)', '시각(브라질 BRT)', '도로', '구간', '범위', '방향', '현재 속도 km/h', '자유흐름 km/h', '속도 비율 %', '혼잡도', '지연(초)', '신뢰도', '통제', '수집 시각(UTC)']);
  header(s1, 3, [13, 15, 9, 7, 16, 9, 14, 14, 11, 10, 10, 9, 7, 22]);
  for (const r of detail) {
    const row = s1.addRow([r.date, r.slot, r.road, r.seg, r.rng, r.dir, r.cur, r.ff, r.ratio, LEVEL_NAMES[r.lv], r.delay, r.conf, r.closed ? '예' : '아니오', r.at]);
    row.getCell(10).fill = fillOf(r.lv);
    row.eachCell(c => { c.border = BORDER; c.alignment = { horizontal: 'center' }; });
  }
  s1.autoFilter = { from: 'A3', to: 'N3' };

  /* 2) 일별 요약 (도로·구간·방향별 하루 평균/최저/정체 횟수) */
  const s2 = wb.addWorksheet('일별 요약', { views: [{ state: 'frozen', ySplit: 3 }] });
  s2.mergeCells('A1:L1'); s2.getCell('A1').value = `도로·구간·방향별 일별 요약 · 브라질 ${from} ~ ${to} · ${TZ_NOTE}`; s2.getCell('A1').font = { bold: true, size: 13 };
  s2.addRow([]);
  s2.addRow(['날짜(브라질)', '도로', '구간', '범위', '방향', '평균 속도', '최저 속도', '최저 속도 시각', '정체 횟수', '지체 이상 횟수', '수집 슬롯', '혼잡도(평균 기준)']);
  header(s2, 3, [13, 9, 7, 16, 9, 11, 11, 15, 10, 13, 11, 14]);
  const key = r => `${r.date}|${r.road}|${r.seg}|${r.dir}`;
  const grp = new Map(); for (const r of detail) (grp.get(key(r)) || grp.set(key(r), []).get(key(r))).push(r);
  for (const a of grp.values()) {
    const f = a[0], min = a.reduce((x, y) => (y.cur < x.cur ? y : x));
    const mean = avg(a.map(x => x.cur)), ff = avg(a.map(x => x.ff)), lv = classify(mean, ff, a.some(x => x.closed));
    const row = s2.addRow([f.date, f.road, f.seg, f.rng, f.dir, Math.round(mean * 10) / 10, min.cur, min.slot, a.filter(x => x.lv === 4).length, a.filter(x => x.lv >= 3).length, `${a.length}`, LEVEL_NAMES[lv]]);
    row.getCell(12).fill = fillOf(lv); row.eachCell(c => { c.border = BORDER; c.alignment = { horizontal: 'center' }; });
  }
  s2.autoFilter = { from: 'A3', to: 'L3' };

  /* 3) 수집 현황: 날짜별로 96칸 중 몇 칸이 수집됐는지, 시간(0~23)별 */
  const s3 = wb.addWorksheet('수집 현황', { views: [{ state: 'frozen', xSplit: 3, ySplit: 3 }] });
  s3.mergeCells('A1:AB1'); s3.getCell('A1').value = '날짜별 수집 현황 — 하루 96칸(15분) 중 수집된 칸 수와, 시간(브라질 0~23시)별 수집 칸 수(최대 4)'; s3.getCell('A1').font = { bold: true, size: 13 };
  s3.addRow([]);
  s3.addRow(['날짜(브라질)', '수집 칸', '수집률', ...Array.from({ length: 24 }, (_, h) => pad(h) + '시')]);
  header(s3, 3, [13, 9, 9, ...Array.from({ length: 24 }, () => 6)]);
  for (const d of range) {
    const m = readDay(d), by = Array(24).fill(0);
    for (const slot of m.keys()) by[+slot.slice(0, 2)]++;
    const row = s3.addRow([d, m.size, Math.round(m.size / 96 * 1000) / 10 + '%', ...by]);
    row.eachCell(c => { c.border = BORDER; c.alignment = { horizontal: 'center' }; });
    by.forEach((n, h) => { const c = row.getCell(4 + h); c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: n === 0 ? 'FFE3E5E7' : n >= 4 ? 'FF9BD8B0' : n >= 2 ? 'FFF6E08A' : 'FFF4B183' } }; });
  }
  const total = range.reduce((a, d) => a + slotCount.get(d), 0), cap = range.length * 96;
  const t = s3.addRow(['합계', total, Math.round(total / cap * 1000) / 10 + '%']); t.font = { bold: true };
  s3.addRow([]);
  s3.addRow(['※ 색: 회색 = 0칸, 주황 = 1칸, 노랑 = 2~3칸, 초록 = 4칸(15분 간격이 모두 수집된 시간). GitHub 무료 스케줄이 15분 주기를 지키지 못하면 이 표에 빈 칸이 많아집니다.']);

  /* 4) 설명 */
  const s4 = wb.addWorksheet('설명'); s4.getColumn(1).width = 150;
  [
    ['이 파일은 무엇인가', true],
    [`TomTom Traffic Flow 로 15분마다 조회한 구간별·방향별 속도 로그(data 브랜치 data/날짜.jsonl)를 ${from} ~ ${to} (브라질 날짜) 기간 엑셀로 옮긴 것입니다. 시각은 모두 ${TZ_NOTE}입니다.`],
    [`혼잡도: 현재 속도 ÷ 자유 흐름 속도 — 원활 ≥ ${TH.smooth}%, 서행 ${TH.slow}~${TH.smooth}%, 지체 ${TH.delay}~${TH.slow}%, 정체 < ${TH.delay}%, 도로 폐쇄 보고 시 통제. 기준은 thresholds.json 으로 바꿀 수 있습니다.`],
    ['', false],
    ['읽는 방법과 한계', true],
    ['• 각 행은 "그 15분 슬롯에서 첫 번째로 성공한 조회" 한 건입니다. 수집이 없었던 슬롯은 행이 없습니다(「수집 현황」 시트 참고).'],
    ['• 방향은 구간 중앙에서 각 차로 쪽 약 10 m 벗어난 지점을 조회하고 응답 도로의 진행 방위를 검증한 값입니다. SP-306 하행 = SP-304→SP-308 방면, SP-330 남행 = 남쪽 방면, SP-308 남동행 = 시작→끝 방면.'],
    ['• TomTom 은 도로 세그먼트(수 km~26 km) 단위로 속도를 주므로, 같은 세그먼트에 속한 여러 구간은 값이 같게 나옵니다. SP-330·SP-308 은 현재 구간 모두 같은 세그먼트(약 18~26 km)입니다.'],
    ['• GitHub 무료 스케줄은 15분 주기를 지키지 못해 수집이 시간당 1~2건에 그칠 수 있습니다. 이 경우 「수집 현황」 시트에서 빈 시간대를 확인하세요.'],
    ['• 일일 통행량(차량 대수)은 이 파일에 없습니다(ARTESP 공개 자료, volume 워크플로).'],
  ].forEach(([tx, b]) => { const c = s4.addRow([tx]).getCell(1); c.alignment = { wrapText: true, vertical: 'top' }; if (b) c.font = { bold: true, size: 12 }; });

  await wb.xlsx.writeFile(outFile);
  return { rows: detail.length, total, cap };
}

(async () => {
  const name = `traffic_speed_${from}_to_${to}.xlsx`, file = path.join(OUT, name);
  const r = await build(file);
  fs.copyFileSync(file, path.join(OUT, 'traffic_speed_latest.xlsx'));
  log(`완료: ${file} | 15분 기록 ${r.rows.toLocaleString()}행 | 수집 ${r.total}/${r.cap}칸 (${(r.total / r.cap * 100).toFixed(1)}%)`);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
