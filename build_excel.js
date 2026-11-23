'use strict';
// 보고 기간(브라질 달력 하루 00:00~23:59, 96슬롯)의 구간·방향별 교통상황 엑셀 생성 — 표 하단에 속도 추이 그래프 삽입
const path = require('path');
const ExcelJS = require('exceljs');
const { DIRS, GROUPS, LEVEL_NAMES, classify, TH, SEGMENT_NOTE } = require('./lib');

const TZ_NOTE = '브라질 현지 시간(상파울루주 · America/Sao_Paulo · UTC−3) 기준';
const FILL = { 0: 'FFE3E5E7', 1: 'FF9BD8B0', 2: 'FFF6E08A', 3: 'FFF4B183', 4: 'FFEF8B86', 5: 'FFC9A3DC' };
const thin = { style: 'thin', color: { argb: 'FFD0D4D8' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F6B4F' } };
const fillOf = lv => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[lv] } });
const getD = (e, g, i, key) => (e.rec && e.rec[g.key] && e.rec[g.key][i] ? e.rec[g.key][i][key] || null : null);
const range = s => `${s.from.toFixed(1)}–${s.to.toFixed(1)} km`;
const IMG_W = 880; // 엑셀에 표시할 그래프 폭(px)

function putChart(wb, ws, chart, zeroRow) {
  const id = wb.addImage({ buffer: chart.png, extension: 'png' });
  ws.addImage(id, { tl: { col: 0, row: zeroRow }, ext: { width: IMG_W, height: Math.round(IMG_W * chart.h / chart.w) } });
}
const CHART_ROWS = 18; // 그래프 하나가 차지하는 행 수(기본 행 높이 20px 기준)

function addDirSheet(wb, win, label, g, dir, charts) {
  const ws = wb.addWorksheet(`${g.sheet} 15분(${dir.label})`, { views: [{ state: 'frozen', xSplit: 2, ySplit: 3 }] });
  const lastCol = 2 + g.list.length * 2;
  ws.mergeCells(1, 1, 1, lastCol);
  ws.getCell(1, 1).value = `${g.road} ${g.unit.replace("km", " km")} 구간 · ${dir.label} (${dir.desc}) · ${label} · ${TZ_NOTE}`;
  ws.getCell(1, 1).font = { bold: true, size: 13 };
  ws.mergeCells(2, 1, 3, 1); ws.mergeCells(2, 2, 3, 2);
  ws.getCell(2, 1).value = '브라질 날짜'; ws.getCell(2, 2).value = '브라질 시각\n(BRT, UTC−3)';
  g.list.forEach((s, i) => {
    const c = 3 + i * 2;
    ws.mergeCells(2, c, 2, c + 1);
    ws.getCell(2, c).value = `${g.label(i)} (${range(s)})`;
    ws.getCell(3, c).value = '속도 km/h'; ws.getCell(3, c + 1).value = '혼잡도';
  });
  for (let r = 2; r <= 3; r++) for (let c = 1; c <= lastCol; c++) {
    const cell = ws.getCell(r, c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = HEAD_FILL; cell.border = BORDER;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }
  ws.getRow(2).height = 32;
  win.forEach((e, ri) => {
    const r = 4 + ri;
    ws.getCell(r, 1).value = e.date; ws.getCell(r, 2).value = e.slot;
    g.list.forEach((_, i) => {
      const d = getD(e, g, i, dir.key), c = 3 + i * 2;
      const lv = d ? classify(d.cur, d.ff, d.closed) : 0;
      const sp = ws.getCell(r, c), lc = ws.getCell(r, c + 1);
      sp.value = d ? d.cur : null; sp.numFmt = '0.0';
      lc.value = d ? LEVEL_NAMES[lv] : '기록 없음';
      sp.fill = fillOf(lv); lc.fill = fillOf(lv);
    });
    for (let c = 1; c <= lastCol; c++) { const cell = ws.getCell(r, c); cell.border = BORDER; cell.alignment = { horizontal: 'center' }; }
  });
  ws.getColumn(1).width = 13; ws.getColumn(2).width = 15;
  for (let c = 3; c <= lastCol; c++) ws.getColumn(c).width = 12;
  const lr = 4 + win.length + 1;
  ws.getCell(lr, 1).value = '범례'; ws.getCell(lr, 1).font = { bold: true };
  [1, 2, 3, 4, 5, 0].forEach((lv, k) => {
    const cell = ws.getCell(lr, 2 + k);
    cell.value = LEVEL_NAMES[lv]; cell.fill = fillOf(lv); cell.alignment = { horizontal: 'center' }; cell.border = BORDER;
  });
  ws.getCell(lr + 1, 1).value = `모든 시각은 ${TZ_NOTE}입니다. 슬롯은 해당 15분의 첫 조회값이며, 혼잡도는 현재 속도 ÷ 자유 흐름 속도 (원활 ≥${TH.smooth}%, 서행 ${TH.slow}–${TH.smooth}%, 지체 ${TH.delay}–${TH.slow}%, 정체 <${TH.delay}%) 기준입니다.`;
  // 표 하단: 속도 추이 그래프
  ws.getCell(lr + 3, 1).value = '▼ 구간별 속도 추이 (위 표의 속도를 그래프로 표시)'; ws.getCell(lr + 3, 1).font = { bold: true };
  if (charts) putChart(wb, ws, charts[`${g.key}:${dir.key}`], lr + 3); // 0-기준 행 번호 = 엑셀 (lr+4)행
}

async function buildExcel(win, label, outFile, charts, vol, dash) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SP-306 monitor'; wb.created = new Date();
  const slots = win;

  if (dash) {
    // 맨 앞 시트: HTML 화면처럼 도로 도식도 → 구간 카드 → 시간대별 평균 속도 표를 도로별 한 장씩 위에서 아래로
    const wd0 = wb.addWorksheet('요약장표', { views: [{ showGridLines: false }] });
    wd0.getColumn(1).width = 2;
    wd0.mergeCells('B1:T1'); wd0.getCell('B1').value = `SP-306 · SP-330 · SP-308 일일 요약장표 · ${label} · ${TZ_NOTE}`; wd0.getCell('B1').font = { bold: true, size: 14 };
    wd0.mergeCells('B2:T2'); wd0.getCell('B2').value = '아래 그림은 HTML 화면과 같은 구성(도로 그림 → 구간별 요약 → 시간대별 평균 속도)입니다. 값은 그날 수집된 15분 슬롯의 평균·최저이며, 회색 칸은 수집된 값이 없는 시간입니다.';
    wd0.getCell('B2').font = { size: 10, color: { argb: 'FF667078' } };
    let rowPx = 40; const ROW = 20; // 기본 행 높이 20px 가정 (아래 putAt 에서 행 번호로 환산)
    for (const key of Object.keys(dash)) {
      const d = dash[key], id = wb.addImage({ buffer: d.png, extension: 'png' });
      const scale = 1280 / d.w, wpx = Math.round(d.w * scale), hpx = Math.round(d.h * scale);
      wd0.addImage(id, { tl: { col: 1, row: Math.ceil(rowPx / ROW) }, ext: { width: wpx, height: hpx } });
      rowPx += hpx + 30;
    }
  }
  for (const g of GROUPS) for (const dir of g.dirs) addDirSheet(wb, win, label, g, dir, charts);

  /* 상세 (세로) */
  const wd = wb.addWorksheet('상세', { views: [{ state: 'frozen', ySplit: 1 }] });
  wd.columns = [
    { header: '날짜(브라질)', key: 'd', width: 13 }, { header: '시각(브라질 BRT)', key: 'slot', width: 16 }, { header: '도로', key: 'road', width: 9 }, { header: '단위', key: 'unit', width: 7 },
    { header: '방향', key: 'dir', width: 8 }, { header: '구간', key: 'seg', width: 10 }, { header: '시작 km', key: 'from', width: 9 }, { header: '끝 km', key: 'to', width: 9 },
    { header: '현재 속도 km/h', key: 'cur', width: 15 }, { header: '자유흐름 km/h', key: 'ff', width: 15 }, { header: '속도 비율 %', key: 'ratio', width: 12 },
    { header: '혼잡도', key: 'lv', width: 10 }, { header: '지연(초)', key: 'delay', width: 10 }, { header: '신뢰도', key: 'conf', width: 9 }, { header: '통제', key: 'closed', width: 8 },
  ];
  wd.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; wd.getRow(1).fill = HEAD_FILL;
  for (const e of slots) for (const g of GROUPS) for (const [i, s] of g.list.entries()) for (const dir of g.dirs) {
    const d = getD(e, g, i, dir.key); if (!d) continue;
    wd.addRow({ d: e.date, slot: e.slot, road: g.road, unit: g.unit, dir: dir.label, seg: g.label(i).replace('구간 ', ''), from: s.from, to: s.to, cur: d.cur, ff: d.ff,
      ratio: d.ff ? Math.round(d.cur / d.ff * 100) : null, lv: LEVEL_NAMES[classify(d.cur, d.ff, d.closed)], delay: d.delay, conf: d.conf, closed: d.closed ? '예' : '아니오' });
  }
  wd.autoFilter = { from: 'A1', to: 'O1' };

  /* 요약 + 표 하단 그래프 4종 */
  const wsum = wb.addWorksheet('요약');
  wsum.columns = [{ width: 9 }, { width: 7 }, { width: 9 }, { width: 8 }, { width: 18 }, { width: 12 }, { width: 12 }, { width: 20 }, { width: 14 }, { width: 14 }, { width: 12 }];
  wsum.mergeCells('A1:K1'); wsum.getCell('A1').value = `${label} 구간·방향별 요약 · ${TZ_NOTE}`; wsum.getCell('A1').font = { bold: true, size: 13 };
  ['도로', '단위', '구간', '방향', '범위', '평균 속도', '최저 속도', '최저 속도 시각(BRT)', '정체 횟수(15분)', '지체 이상 횟수', '수집 슬롯'].forEach((h, c) => {
    const cell = wsum.getCell(3, c + 1); cell.value = h; cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = HEAD_FILL;
    cell.alignment = { horizontal: 'center', wrapText: true }; cell.border = BORDER;
  });
  const summary = [];
  let r = 4;
  for (const g of GROUPS) g.list.forEach((s, i) => g.dirs.forEach(dir => {
    const rows = [];
    for (const e of slots) { const d = getD(e, g, i, dir.key); if (d) rows.push({ e, d, lv: classify(d.cur, d.ff, d.closed) }); }
    const avg = rows.length ? rows.reduce((a, b) => a + b.d.cur, 0) / rows.length : null;
    const min = rows.length ? rows.reduce((a, b) => (b.d.cur < a.d.cur ? b : a)) : null;
    const minAt = min ? min.e.slot : null;
    const jam = rows.filter(x => x.lv === 4).length, slow = rows.filter(x => x.lv >= 3).length;
    summary.push({ road: g.road, unit: g.unit, label: g.label(i), dir: dir.label, from: s.from, to: s.to, avg, min: min && min.d.cur, minAt, jam, n: rows.length });
    [g.road, g.unit, g.label(i).replace('구간 ', ''), dir.label, range(s), avg == null ? '-' : Math.round(avg * 10) / 10, min ? min.d.cur : '-', minAt || '-', jam, slow, `${rows.length} / ${slots.length}`]
      .forEach((v, c) => { const cell = wsum.getCell(r, c + 1); cell.value = v; cell.border = BORDER; cell.alignment = { horizontal: 'center' }; });
    r++;
  }));
  wsum.getCell(r + 1, 1).value = '※ 기록 없음 = 해당 15분에 수집 프로그램이 실행되지 않았거나(PC 종료·절전 등), 조회·방향 검증에 실패한 경우입니다.';
  wsum.getCell(r + 3, 1).value = '▼ 구간별 속도 추이 (위 표의 속도를 그래프로 표시)'; wsum.getCell(r + 3, 1).font = { bold: true };
  if (charts) {
    let zr = r + 3; // 0-기준 행 번호 = 엑셀 (r+4)행부터
    for (const g of GROUPS) for (const dir of g.dirs) { putChart(wb, wsum, charts[`${g.key}:${dir.key}`], zr); zr += CHART_ROWS; }
    r = zr; // 그래프들 아래부터 이어서 쓴다
  } else { r += 2; }
  // 요약 시트 맨 하단: 도로 세그먼트 기준
  wsum.getCell(r + 1, 1).value = SEGMENT_NOTE.title; wsum.getCell(r + 1, 1).font = { bold: true };
  SEGMENT_NOTE.lines.forEach((ln, k) => { wsum.getCell(r + 2 + k, 1).value = ln; });

  if (vol) require('./volume_core').addVolumeSheet(wb, vol, '일일 통행량(ARTESP)');

  await wb.xlsx.writeFile(outFile);
  return { file: outFile, slotCount: slots.filter(e => e.rec).length, total: slots.length, summary };
}

module.exports = { buildExcel };
if (require.main === module) { // 사용법: node build_excel.js <발송일(한국 날짜) YYYY-MM-DD>
  const K = process.argv[2];
  if (!K) { console.error('usage: node build_excel.js YYYY-MM-DD(발송일)'); process.exit(1); }
  const { makeWindow, loadWindow, fmtWin } = require('./lib');
  const { buildCharts } = require('./chart');
  const w = makeWindow(K), label = fmtWin(w), win = loadWindow(w);
  buildExcel(win, label, path.join(DIRS.out, `SP306_traffic_BRT_${w.day}.xlsx`), buildCharts(win)).then(r => console.log(w.day, r.slotCount + '/' + r.total));
}
