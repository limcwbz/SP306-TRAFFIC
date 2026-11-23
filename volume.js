'use strict';
// ARTESP 공개 자료(SAT 일별 계수)에서 SP-308 / SP-330 계측점별 통행량(차량 대수)을 집계해 "단독 엑셀"로 만든다.
//   (일일 보고 메일·엑셀에 들어가는 통행량 표는 같은 모듈 volume_core.js 를 쓴다.)
//   - 실행: node volume.js        - 환경변수: VOLUME_OUT 결과 폴더(기본 ./out), VOLUME_CSV 이미 받은 CSV 경로(쉼표 구분)
// 주의: 공개 자료는 며칠 늦게 올라온다. SP-306 은 이 자료에 없다.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const V = require('./volume_core');

const OUT = process.env.VOLUME_OUT || path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const { CFG, FACTOR, MOTO_SHARE, MOTO_MIN_TOTAL, HILITE } = V;
const r0 = v => (v == null ? null : Math.round(v));
const pct = (a, b) => (a && b != null ? Math.round(b / a * 1000) / 10 : null);
const zoneLabel = p => (p.zone === 'inside' ? `TomTom 구간 안${p.segIdx >= 0 ? '(구간 ' + (p.segIdx + 1) + ')' : ''}` : p.zone === 'near' ? `인접(구간 밖 ${p.dist.toFixed(1)}km)` : `구간 밖 ${p.dist.toFixed(0)}km`);

const HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F6B4F' } };
const BLUE = { type: 'pattern', pattern: 'solid', fgColor: { argb: HILITE.excel } };
const thin = { style: 'thin', color: { argb: 'FFD0D4D8' } }, BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const FILL = { 이상치: 'FFEF8B86', zero: 'FFF6E08A' };
const flagFill = f => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: f.startsWith('0') ? FILL.zero : FILL.이상치 } });
function header(ws, row, widths) {
  ws.getRow(row).eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = HEAD; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = BORDER; });
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}
const centerRow = (row, inside) => row.eachCell({ includeEmpty: true }, c => { c.border = BORDER; c.alignment = { horizontal: 'center' }; if (inside) { c.fill = BLUE; c.font = { bold: true, color: { argb: 'FF0B2A4A' } }; } });

async function buildWorkbook(points, meta, view, outFile) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'SP306-TRAFFIC volume'; wb.created = new Date();
  V.addVolumeSheet(wb, view, '일일 통행량(ARTESP)');

  /* 요약(전체 계측점) */
  const s1 = wb.addWorksheet('요약(지점·방향별)', { views: [{ state: 'frozen', xSplit: 5, ySplit: 3 }] });
  s1.mergeCells('A1:U1'); s1.getCell('A1').value = `ARTESP 공개 자료 기준 통행량(차량 대수/일) · 자료 기간 ${meta.first} ~ ${meta.last} · 이상치·0대 날짜는 평균에서 제외 · 파란색 = TomTom 속도 집계 구간 안`;
  s1.getCell('A1').font = { bold: true, size: 13 }; s1.addRow([]);
  s1.addRow(['도로', '운영사', '지점 km', '방향', '구분', 'TomTom 구간 대비', '기록 일수', '유효 일수', '0대 일수', '이상치 일수', '일평균(대)', '오토바이', '승용', '상용', '상용 비율(%)', '평일 평균', '주말 평균', '중앙값(대)', '마지막 일자', '신뢰도', '비고']);
  header(s1, 3, [8, 22, 11, 9, 8, 20, 9, 9, 9, 10, 12, 10, 10, 10, 10, 11, 11, 11, 12, 10, 34]);
  points.forEach(p => {
    const note = p.ok === 0 ? '유효 데이터 없음' : p.trust === '신뢰 낮음' ? '유효 일수가 절반 미만 — 평균을 믿기 어려움' : p.odd ? `의심 ${p.odd}일 제외됨` : '';
    const row = s1.addRow([p.rod, p.conc, p.kmL, p.dir, p.marg ? '마지널(측도)' : '본선', zoneLabel(p), p.days, p.ok, p.zero, p.odd, r0(p.avgTot), r0(p.avgMoto), r0(p.avgPass), r0(p.avgCom), pct(p.avgTot, p.avgCom), r0(p.avgWd), r0(p.avgWe), p.median, p.last, p.trust, note]);
    centerRow(row, p.zone === 'inside');
    if (p.trust === '신뢰 낮음') { row.getCell(20).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL.이상치 } }; row.getCell(21).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL.이상치 } }; }
    [11, 12, 13, 14, 16, 17, 18].forEach(i => { row.getCell(i).numFmt = '#,##0'; });
  });
  s1.autoFilter = { from: 'A3', to: 'U3' };

  /* 지점별(양방향 합, 본선) */
  const s2 = wb.addWorksheet('지점별(양방향 합·본선)', { views: [{ state: 'frozen', ySplit: 3 }] });
  s2.mergeCells('A1:I1'); s2.getCell('A1').value = '같은 지점의 두 방향 일평균을 합한 값(본선만, 신뢰도 "양호"인 방향만). 한쪽만 유효하면 "한쪽만"으로 표시'; s2.getCell('A1').font = { bold: true, size: 13 };
  s2.addRow([]); s2.addRow(['도로', '운영사', '지점 km', 'TomTom 구간 대비', '방향 수', '일평균 합(대)', '평일 평균 합', '주말 평균 합', '비고']);
  header(s2, 3, [8, 22, 11, 20, 9, 14, 14, 14, 20]);
  const grp = new Map();
  points.filter(p => !p.marg).forEach(p => { const g = `${p.rod}|${p.conc}|${p.kmL}`; (grp.get(g) || grp.set(g, []).get(g)).push(p); });
  [...grp.values()].sort((a, b) => a[0].rod.localeCompare(b[0].rod) || a[0].kmv - b[0].kmv).forEach(a => {
    const v = a.filter(p => p.avgTot != null && p.trust === '양호'), low = a.filter(p => p.trust !== '양호').length, sum = f => (v.length ? v.reduce((s, p) => s + (p[f] || 0), 0) : null);
    const row = s2.addRow([a[0].rod, a[0].conc, a[0].kmL, zoneLabel(a[0]), v.length, r0(sum('avgTot')), r0(sum('avgWd')), r0(sum('avgWe')), low ? '신뢰 낮은 방향 제외' : v.length < 2 ? '한쪽만' : '']);
    centerRow(row, a[0].zone === 'inside'); [6, 7, 8].forEach(i => { row.getCell(i).numFmt = '#,##0'; });
  });

  /* 최근 14일 */
  const s3 = wb.addWorksheet('최근14일', { views: [{ state: 'frozen', xSplit: 5, ySplit: 3 }] });
  const dates = []; { const end = new Date(meta.last + 'T12:00:00Z'); for (let i = 13; i >= 0; i--) { const d = new Date(end); d.setUTCDate(d.getUTCDate() - i); dates.push(d.toISOString().slice(0, 10)); } }
  s3.mergeCells('A1:S1'); s3.getCell('A1').value = '최근 14일 일 통행량(대) — 노랑: 0대(결측 의심), 빨강: 이상치(평균에서 제외된 값), 파란 라벨: TomTom 속도 집계 구간 안. 빈 칸은 자료 없음'; s3.getCell('A1').font = { bold: true, size: 13 };
  s3.addRow([]); s3.addRow(['도로', '운영사', '지점 km', '방향', '구분', ...dates.map(d => d.slice(5))]);
  header(s3, 3, [8, 22, 11, 9, 8, ...dates.map(() => 9)]);
  points.forEach(p => {
    const row = s3.addRow([p.rod, p.conc, p.kmL, p.dir, p.marg ? '마지널' : '본선', ...dates.map(d => (p.byDate.has(d) ? p.byDate.get(d).total : null))]);
    row.eachCell(c => { c.border = BORDER; c.alignment = { horizontal: 'center' }; });
    if (p.zone === 'inside') for (let i = 1; i <= 5; i++) { row.getCell(i).fill = BLUE; row.getCell(i).font = { bold: true, color: { argb: 'FF0B2A4A' } }; }
    dates.forEach((d, i) => { const r = p.byDate.get(d); if (r && r.flag !== '정상') row.getCell(6 + i).fill = flagFill(r.flag); row.getCell(6 + i).numFmt = '#,##0'; });
  });

  /* 일별 상세 */
  const s4 = wb.addWorksheet('일별 상세', { views: [{ state: 'frozen', ySplit: 1 }] });
  s4.addRow(['날짜', '도로', '운영사', '지점 km', '방향', '구분', '오토바이', '승용', '상용', '합계(대)', '판정']);
  header(s4, 1, [12, 8, 22, 11, 9, 9, 10, 10, 10, 12, 16]);
  for (const p of points) for (const r of p.list) {
    const row = s4.addRow([r.date, r.rod, r.conc, r.kmL, r.dir, r.marg ? '마지널' : '본선', r.moto, r.pass, r.com, r.total, r.flag]);
    if (r.flag !== '정상') row.getCell(11).fill = flagFill(r.flag);
  }
  s4.autoFilter = { from: 'A1', to: 'K1' };

  /* 설명 */
  const s5 = wb.addWorksheet('설명'); s5.getColumn(1).width = 150;
  [
    ['이 파일은 무엇인가', true],
    [`ARTESP(상파울루주 교통규제청) 공개 자료 "Contagem SAT's por dia"(자동 교통량 계수기의 일별 차량 대수)에서 SP-308, SP-330 계측점만 골라 집계한 것입니다.`],
    [`집계한 자료: ${meta.names.join(' · ')} (자료 마지막 일자 ${meta.last}). 파일 생성: ${meta.at}`],
    ['출처: https://dadosabertos.artesp.sp.gov.br/dataset/volume-de-trafego (Creative Commons Attribution)'],
    ['', false],
    ['읽는 방법', true],
    ['• 값은 "계측점 한 곳을 하루에 지나간 차량 대수"입니다. 구간(km 범위) 전체의 대수가 아니며, 계측점과 계측점 사이는 알 수 없습니다.'],
    ['• 방향(NORTE/SUL)은 자료에 적힌 그대로입니다. 마지널(측도)은 본선과 따로 셉니다. 차종은 오토바이·승용·상용(트럭/버스 등) 3가지입니다.'],
    [`• 파란색 = TomTom 15분 속도를 집계하는 우리 구간 안에 있는 계측점. 구간 위치는 ARTESP 사고 기록(km·좌표)으로 추정한 도로 km 범위이며 오차가 있을 수 있습니다(구간 경계 0.5 km 이내는 "경계 근처"로 표시).`],
    [`• 이상치: 같은 지점·방향의 중앙값의 ${FACTOR}배를 넘는 날, 0대인 날(센서 결측 의심)은 평균·평일/주말 평균에서 제외하고 일별 상세에는 색으로 남겼습니다.`],
    [`• 오토바이 편중: 하루 합계가 ${MOTO_MIN_TOTAL.toLocaleString()}대를 넘는데 오토바이가 ${Math.round(MOTO_SHARE * 100)}% 이상이면 센서가 차종을 잘못 기록한 것으로 보고 제외합니다.`],
    [`• 신뢰도 "신뢰 낮음": 유효 일수가 기록 일수의 절반 미만인 지점·방향. 평균이 남아 있어도 믿기 어렵습니다.`],
    ['', false],
    ['한계', true],
    ['• SP-306 은 이 자료에 없습니다(어떤 표기로도 발견되지 않음). SP-306 은 관할 기관에 직접 자료를 요청해야 합니다.'],
    ['• 계측점은 약 12~15 km 간격이라 우리 구간(2 km 단위)을 나눌 수 없습니다. 같은 구간이라도 계측점 하나의 값일 뿐입니다.'],
    [`• 공개 자료는 며칠 늦게 올라옵니다. 실시간이나 "어제" 값이 아니라 자료에 있는 마지막 일자까지입니다.${meta.partialDay ? ` 자료의 마지막 일자 ${meta.partialDay}는 하루가 다 모이지 않은 값(같은 요일 평균의 60% 미만)이라 제외했습니다.` : ''}`],
    ['• 시간 단위(시간별) 자료는 압축 파일(.rar, 수십~백 MB)로 따로 있으며 이 집계에는 포함하지 않았습니다.'],
  ].forEach(([t, b]) => { const c = s5.addRow([t]).getCell(1); c.alignment = { wrapText: true, vertical: 'top' }; if (b) c.font = { bold: true, size: 12 }; });

  await wb.xlsx.writeFile(outFile);
}

function summaryCsv(points) {
  const q = v => (v == null ? '' : String(v).includes(',') ? `"${v}"` : v);
  const head = ['도로', '운영사', '지점km', '방향', '구분', 'TomTom구간', '기록일수', '유효일수', '0대일수', '이상치일수', '일평균', '오토바이', '승용', '상용', '평일평균', '주말평균', '마지막일자'];
  return '﻿' + [head, ...points.map(p => [p.rod, p.conc, p.kmL, p.dir, p.marg ? '마지널' : '본선', zoneLabel(p), p.days, p.ok, p.zero, p.odd, r0(p.avgTot), r0(p.avgMoto), r0(p.avgPass), r0(p.avgCom), r0(p.avgWd), r0(p.avgWe), p.last])].map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
}

(async () => {
  const { points, meta, view } = await V.load();
  const stamp = path.join(OUT, `traffic_volume_${meta.last}.xlsx`);
  await buildWorkbook(points, meta, view, stamp);
  fs.copyFileSync(stamp, path.join(OUT, 'traffic_volume_latest.xlsx'));
  fs.writeFileSync(path.join(OUT, 'summary_latest.csv'), summaryCsv(points), 'utf8');
  for (const rod of CFG.order.filter(r => !CFG.roads[r].noData)) {
    const a = points.filter(p => p.rod === rod);
    V.log(`${rod}: 계측점·방향 ${a.length}개 (TomTom 구간 안 ${a.filter(p => p.zone === 'inside').length}, 인접 ${a.filter(p => p.zone === 'near').length}), 유효 ${a.reduce((s, p) => s + p.ok, 0)}, 0대 ${a.reduce((s, p) => s + p.zero, 0)}, 이상치·편중 ${a.reduce((s, p) => s + p.odd, 0)}`);
  }
  V.log(`완료: ${stamp} (자료 ${meta.first} ~ ${meta.last})`);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
