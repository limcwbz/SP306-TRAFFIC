'use strict';
// ARTESP 공개 자료(SAT 일별 계수)에서 SP-308 / SP-330 계측점별 통행량(차량 대수)을 집계해 엑셀로 만든다.
//   - 자료: https://dadosabertos.artesp.sp.gov.br/dataset/volume-de-trafego  ("Contagem SAT's por dia em 연도", CSV)
//   - 실행: node volume.js
//   - 환경변수: VOLUME_OUT  결과 폴더(기본 ./out)   VOLUME_CSV  이미 받은 CSV 경로(여러 개는 쉼표). 지정하면 내려받지 않음
// 주의: 공개 자료는 며칠 늦게 올라오므로 "어제까지"가 아니라 자료에 있는 마지막 날까지만 집계된다. SP-306 은 이 자료에 없다.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'volume_config.json'), 'utf8'));
const OUT = process.env.VOLUME_OUT || path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const PKG_URL = 'https://dadosabertos.artesp.sp.gov.br/api/3/action/package_show?id=volume-de-trafego';
const UA = 'Mozilla/5.0 (compatible; sp306-volume/1.0)';
const FACTOR = Number(CFG.outlierFactor || 5);
const MOTO_SHARE = Number(CFG.motoShareSuspect || 0.7), MOTO_MIN_TOTAL = Number(CFG.motoMinTotal || 20000); // 오토바이 비율이 이 이상이고 합계가 이 이상이면 센서 오기록 의심
const pad = n => String(n).padStart(2, '0');
const log = m => console.log(`${new Date().toISOString()} ${m}`);

/* ---------- 내려받기 ---------- */
async function getText(url, label) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(280000) });
  if (!res.ok) throw new Error(`${label} 다운로드 실패: HTTP ${res.status}`);
  const t = await res.text();
  log(`${label}: ${(t.length / 1048576).toFixed(1)} MB`);
  return t;
}
async function loadCsvTexts() {
  if (process.env.VOLUME_CSV) return process.env.VOLUME_CSV.split(',').map(f => ({ name: path.basename(f), text: fs.readFileSync(f.trim(), 'utf8') }));
  const pkg = JSON.parse(await getText(PKG_URL, '데이터셋 정보'));
  if (!pkg.success) throw new Error('ARTESP 데이터셋 정보를 읽지 못했습니다');
  const out = [];
  for (const y of CFG.years) {
    const r = pkg.result.resources.find(x => /SAT/i.test(x.name) && new RegExp(`por dia\\s+em\\s+${y}\\b`, 'i').test(x.name));
    if (!r) throw new Error(`"${y}년 SAT 일별" 자료를 찾지 못했습니다 (ARTESP 가 자료 이름을 바꿨을 수 있음)`);
    out.push({ name: r.name, text: await getText(r.url, r.name) });
  }
  return out;
}

/* ---------- CSV ---------- */
function parseLine(l) {
  if (!l.includes('"')) return l.split(',');
  const o = []; let cur = '', q = false;
  for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(cur); cur = ''; } else cur += ch; }
  o.push(cur); return o;
}
function parseRows(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const head = parseLine(lines[0]).map(s => s.trim());
  const ix = {}; for (const k of ['DATA', 'CONCESSIONARIA', 'RODOVIA', 'KM', 'COMPLEMENTO', 'SENTIDO', 'MARGINAL', 'QTD_MOTO', 'QTD_PASSEIO', 'QTD_COMERCIAL']) {
    ix[k] = head.indexOf(k); if (ix[k] < 0) throw new Error(`CSV 에 "${k}" 열이 없습니다 (자료 형식이 바뀐 듯). 현재 열: ${head.join(',')}`);
  }
  const rows = []; let bad = 0;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = parseLine(lines[i]); if (!CFG.roads[c[ix.RODOVIA]]) continue;
    const km = +c[ix.KM], comp = +c[ix.COMPLEMENTO], moto = +c[ix.QTD_MOTO], pass = +c[ix.QTD_PASSEIO], com = +c[ix.QTD_COMERCIAL];
    if (![km, comp, moto, pass, com].every(Number.isFinite) || !/^\d{4}-\d{2}-\d{2}$/.test(c[ix.DATA])) { bad++; continue; }
    const kmv = km + comp / 1000, R = CFG.roads[c[ix.RODOVIA]];
    if ((R.kmMin != null && kmv < R.kmMin) || (R.kmMax != null && kmv > R.kmMax)) continue;
    rows.push({ date: c[ix.DATA], conc: c[ix.CONCESSIONARIA], rod: c[ix.RODOVIA], kmv, kmL: `${km}+${String(comp).padStart(3, '0')}`, dir: c[ix.SENTIDO], marg: c[ix.MARGINAL] === 'SIM', moto, pass, com, total: moto + pass + com });
  }
  return { rows, bad };
}

/* ---------- 집계 ---------- */
const isWeekend = d => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return w === 0 || w === 6; };
const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const keyOf = r => `${r.rod}|${r.conc}|${r.kmL}|${r.dir}|${r.marg ? 'M' : 'P'}`;

function aggregate(rows) {
  const byKey = new Map();
  for (const r of rows) (byKey.get(keyOf(r)) || byKey.set(keyOf(r), new Map()).get(keyOf(r))).set(r.date, r); // 같은 날짜가 중복이면 마지막 값
  const points = [];
  for (const [k, dm] of byKey) {
    const list = [...dm.values()].sort((a, b) => a.date.localeCompare(b.date));
    const pos = list.map(r => r.total).filter(v => v > 0).sort((a, b) => a - b);
    const median = pos.length ? pos[Math.floor(pos.length / 2)] : 0;
    list.forEach(r => {
      r.flag = r.total === 0 ? '0대(결측 의심)'
        : (median > 0 && r.total > median * FACTOR) ? '이상치'
        : (r.total > MOTO_MIN_TOTAL && r.moto / r.total > MOTO_SHARE) ? '오토바이 편중(센서 의심)'
        : '정상';
    });
    const ok = list.filter(r => r.flag === '정상'), f = list[0];
    points.push({
      k, rod: f.rod, conc: f.conc, kmv: f.kmv, kmL: f.kmL, dir: f.dir, marg: f.marg, list, median,
      days: list.length, ok: ok.length, zero: list.filter(r => r.flag.startsWith('0')).length, odd: list.filter(r => r.flag !== '정상' && !r.flag.startsWith('0')).length,
      trust: ok.length >= list.length * 0.5 ? '양호' : '신뢰 낮음',
      avgTot: avg(ok.map(r => r.total)), avgMoto: avg(ok.map(r => r.moto)), avgPass: avg(ok.map(r => r.pass)), avgCom: avg(ok.map(r => r.com)),
      avgWd: avg(ok.filter(r => !isWeekend(r.date)).map(r => r.total)), avgWe: avg(ok.filter(r => isWeekend(r.date)).map(r => r.total)),
      last: list[list.length - 1].date,
    });
  }
  return points.sort((a, b) => a.rod.localeCompare(b.rod) || a.kmv - b.kmv || a.dir.localeCompare(b.dir) || a.marg - b.marg);
}
const r0 = v => (v == null ? null : Math.round(v));
const pct = (a, b) => (a && b != null ? Math.round(b / a * 1000) / 10 : null);

/* ---------- 엑셀 ---------- */
const HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F6B4F' } };
const thin = { style: 'thin', color: { argb: 'FFD0D4D8' } }, BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const FILL = { 이상치: 'FFEF8B86', zero: 'FFF6E08A' };
function header(ws, row, widths) {
  ws.getRow(row).eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = HEAD; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = BORDER; });
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

async function buildWorkbook(points, meta, outFile) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'SP306-TRAFFIC volume'; wb.created = new Date();

  /* 1) 요약 */
  const s1 = wb.addWorksheet('요약(지점·방향별)', { views: [{ state: 'frozen', xSplit: 5, ySplit: 3 }] });
  s1.mergeCells('A1:T1'); s1.getCell('A1').value = `ARTESP 공개 자료 기준 통행량(차량 대수/일) · 자료 기간 ${meta.first} ~ ${meta.last} · 이상치·0대 날짜는 평균에서 제외`;
  s1.getCell('A1').font = { bold: true, size: 13 };
  s1.addRow([]);
  s1.addRow(['도로', '운영사', '지점 km', '방향', '구분', '기록 일수', '유효 일수', '0대 일수', '이상치 일수', '일평균(대)', '오토바이', '승용', '상용', '상용 비율(%)', '평일 평균', '주말 평균', '중앙값(대)', '마지막 일자', '신뢰도', '비고']);
  header(s1, 3, [8, 22, 11, 9, 8, 9, 9, 9, 10, 12, 10, 10, 10, 10, 11, 11, 11, 12, 10, 34]);
  points.forEach(p => {
    const note = p.ok === 0 ? '유효 데이터 없음' : p.trust === '신뢰 낮음' ? '유효 일수가 절반 미만 — 평균을 믿기 어려움' : p.odd ? `의심 ${p.odd}일 제외됨` : '';
    const row = s1.addRow([p.rod, p.conc, p.kmL, p.dir, p.marg ? '마지널(측도)' : '본선', p.days, p.ok, p.zero, p.odd, r0(p.avgTot), r0(p.avgMoto), r0(p.avgPass), r0(p.avgCom), pct(p.avgTot, p.avgCom), r0(p.avgWd), r0(p.avgWe), p.median, p.last, p.trust, note]);
    row.eachCell(c => { c.border = BORDER; c.alignment = { horizontal: 'center' }; });
    if (p.trust === '신뢰 낮음') { row.getCell(19).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL.이상치 } }; row.getCell(20).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL.이상치 } }; }
    [10, 11, 12, 13, 15, 16, 17].forEach(i => { row.getCell(i).numFmt = '#,##0'; });
  });
  s1.autoFilter = { from: 'A3', to: 'T3' };

  /* 2) 지점별(양방향 합, 본선만) */
  const s2 = wb.addWorksheet('지점별(양방향 합·본선)', { views: [{ state: 'frozen', ySplit: 3 }] });
  s2.mergeCells('A1:H1'); s2.getCell('A1').value = '같은 지점의 두 방향 일평균을 합한 값(본선만, 신뢰도 "양호"인 방향만). 한쪽만 유효하면 "한쪽만"으로 표시'; s2.getCell('A1').font = { bold: true, size: 13 };
  s2.addRow([]); s2.addRow(['도로', '운영사', '지점 km', '방향 수', '일평균 합(대)', '평일 평균 합', '주말 평균 합', '비고']);
  header(s2, 3, [8, 22, 11, 9, 14, 14, 14, 18]);
  const grp = new Map();
  points.filter(p => !p.marg).forEach(p => { const g = `${p.rod}|${p.conc}|${p.kmL}`; (grp.get(g) || grp.set(g, []).get(g)).push(p); });
  [...grp.values()].sort((a, b) => a[0].rod.localeCompare(b[0].rod) || a[0].kmv - b[0].kmv).forEach(a => {
    const v = a.filter(p => p.avgTot != null && p.trust === '양호'), low = a.filter(p => p.trust !== '양호').length, sum = f => (v.length ? v.reduce((s, p) => s + (p[f] || 0), 0) : null);
    const row = s2.addRow([a[0].rod, a[0].conc, a[0].kmL, v.length, r0(sum('avgTot')), r0(sum('avgWd')), r0(sum('avgWe')), low ? '신뢰 낮은 방향 제외' : v.length < 2 ? '한쪽만' : '']);
    row.eachCell(c => { c.border = BORDER; c.alignment = { horizontal: 'center' }; });
    [5, 6, 7].forEach(i => { row.getCell(i).numFmt = '#,##0'; });
  });

  /* 3) 최근 14일 피벗 */
  const s3 = wb.addWorksheet('최근14일', { views: [{ state: 'frozen', xSplit: 5, ySplit: 3 }] });
  const dates = []; { const end = new Date(meta.last + 'T12:00:00Z'); for (let i = 13; i >= 0; i--) { const d = new Date(end); d.setUTCDate(d.getUTCDate() - i); dates.push(d.toISOString().slice(0, 10)); } }
  s3.mergeCells('A1:S1'); s3.getCell('A1').value = '최근 14일 일 통행량(대) — 노랑: 0대(결측 의심), 빨강: 이상치(평균에서 제외된 값). 빈 칸은 자료 없음'; s3.getCell('A1').font = { bold: true, size: 13 };
  s3.addRow([]); s3.addRow(['도로', '운영사', '지점 km', '방향', '구분', ...dates.map(d => d.slice(5))]);
  header(s3, 3, [8, 22, 11, 9, 8, ...dates.map(() => 9)]);
  points.forEach(p => {
    const m = new Map(p.list.map(r => [r.date, r]));
    const row = s3.addRow([p.rod, p.conc, p.kmL, p.dir, p.marg ? '마지널' : '본선', ...dates.map(d => (m.has(d) ? m.get(d).total : null))]);
    row.eachCell(c => { c.border = BORDER; c.alignment = { horizontal: 'center' }; });
    dates.forEach((d, i) => { const r = m.get(d); if (r && r.flag !== '정상') row.getCell(6 + i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: r.flag.startsWith('0') ? FILL.zero : FILL.이상치 } }; row.getCell(6 + i).numFmt = '#,##0'; });
  });

  /* 4) 일별 상세 */
  const s4 = wb.addWorksheet('일별 상세', { views: [{ state: 'frozen', ySplit: 1 }] });
  s4.addRow(['날짜', '도로', '운영사', '지점 km', '방향', '구분', '오토바이', '승용', '상용', '합계(대)', '판정']);
  header(s4, 1, [12, 8, 22, 11, 9, 9, 10, 10, 10, 12, 16]);
  for (const p of points) for (const r of p.list) {
    const row = s4.addRow([r.date, r.rod, r.conc, r.kmL, r.dir, r.marg ? '마지널' : '본선', r.moto, r.pass, r.com, r.total, r.flag]);
    if (r.flag !== '정상') row.getCell(11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: r.flag.startsWith('0') ? FILL.zero : FILL.이상치 } };
  }
  s4.autoFilter = { from: 'A1', to: 'K1' };

  /* 5) 설명 */
  const s5 = wb.addWorksheet('설명');
  s5.getColumn(1).width = 150;
  [
    ['이 파일은 무엇인가', true],
    [`ARTESP(상파울루주 교통규제청) 공개 자료 "Contagem SAT's por dia"(자동 교통량 계수기의 일별 차량 대수)에서 ${Object.values(CFG.roads).map(r => r.name).join(', ')} 계측점만 골라 집계한 것입니다.`],
    [`집계한 자료: ${meta.names.join(' · ')} (자료 마지막 일자 ${meta.last}). 파일 생성: ${meta.at}`],
    ['출처: https://dadosabertos.artesp.sp.gov.br/dataset/volume-de-trafego (Creative Commons Attribution)'],
    ['', false],
    ['읽는 방법', true],
    ['• 값은 "계측점 한 곳을 하루에 지나간 차량 대수"입니다. 구간(km 범위)의 대수가 아니며, 계측점과 계측점 사이는 알 수 없습니다.'],
    ['• 방향(NORTE/SUL/LESTE/OESTE)은 자료에 적힌 그대로입니다. 마지널(측도)은 본선과 따로 셉니다. 차종은 오토바이·승용·상용(트럭/버스 등) 3가지입니다.'],
    [`• 이상치: 같은 지점·방향의 중앙값의 ${FACTOR}배를 넘는 날, 0대인 날(센서 결측 의심)은 평균·평일/주말 평균에서 제외하고 일별 상세에는 색으로 남겼습니다. 기준은 volume_config.json 의 outlierFactor 로 바꿀 수 있습니다.`],
    [`• 오토바이 편중: 하루 합계가 ${MOTO_MIN_TOTAL.toLocaleString()}대를 넘는데 오토바이가 ${Math.round(MOTO_SHARE * 100)}% 이상이면 센서가 차종을 잘못 기록한 것으로 보고 제외합니다(예: SP-330 km 19+420 남행은 오토바이만 하루 약 50만 대로 기록됨).`],
    [`• 신뢰도 "신뢰 낮음": 유효 일수가 기록 일수의 절반 미만인 지점·방향. 평균이 남아 있어도 믿기 어렵습니다.`],
    [`• 이 방식은 명백히 큰 값/0만 걸러냅니다. 센서가 조금 틀린 값은 걸러지지 않으므로 원자료와 함께 확인하세요.`],
    ['', false],
    ['한계', true],
    ['• SP-306 은 이 자료에 없습니다(어떤 표기로도 발견되지 않음). SP-306 은 관할 기관에 직접 자료를 요청해야 합니다.'],
    ['• 우리가 모니터링하는 구간(SP-308 약 7.4km, SP-330 교차점 남쪽 4km)이 도로의 몇 km 인지는 아직 확인하지 않았습니다. 그래서 도로의 모든 계측점을 담았으며, volume_config.json 의 kmMin/kmMax 로 범위를 좁힐 수 있습니다.'],
    ['• 공개 자료는 며칠 늦게 올라옵니다. 실시간이나 "어제" 값이 아니라 자료에 있는 마지막 일자까지입니다.'],
    ['• 시간 단위(시간별) 자료는 압축 파일(.rar, 수십~백 MB)로 따로 있으며 이 집계에는 포함하지 않았습니다.'],
  ].forEach(([t, b]) => { const c = s5.addRow([t]).getCell(1); c.alignment = { wrapText: true, vertical: 'top' }; if (b) c.font = { bold: true, size: 12 }; });

  await wb.xlsx.writeFile(outFile);
}

function summaryCsv(points) {
  const q = v => (v == null ? '' : String(v).includes(',') ? `"${v}"` : v);
  const head = ['도로', '운영사', '지점km', '방향', '구분', '기록일수', '유효일수', '0대일수', '이상치일수', '일평균', '오토바이', '승용', '상용', '평일평균', '주말평균', '마지막일자'];
  return '﻿' + [head, ...points.map(p => [p.rod, p.conc, p.kmL, p.dir, p.marg ? '마지널' : '본선', p.days, p.ok, p.zero, p.odd, r0(p.avgTot), r0(p.avgMoto), r0(p.avgPass), r0(p.avgCom), r0(p.avgWd), r0(p.avgWe), p.last])].map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
}

(async () => {
  const texts = await loadCsvTexts();
  let rows = [], bad = 0;
  for (const t of texts) { const r = parseRows(t.text); rows = rows.concat(r.rows); bad += r.bad; }
  if (!rows.length) throw new Error('조건에 맞는 계측점이 없습니다 (volume_config.json 의 도로 코드/km 범위를 확인하세요).');
  if (bad) log(`형식이 맞지 않아 건너뛴 행: ${bad}`);
  const points = aggregate(rows);
  const dates = rows.map(r => r.date).sort(), meta = { first: dates[0], last: dates[dates.length - 1], names: texts.map(t => t.name), at: new Date().toISOString() };
  const stamp = path.join(OUT, `traffic_volume_${meta.last}.xlsx`);
  await buildWorkbook(points, meta, stamp);
  fs.copyFileSync(stamp, path.join(OUT, 'traffic_volume_latest.xlsx'));
  fs.writeFileSync(path.join(OUT, 'summary_latest.csv'), summaryCsv(points), 'utf8');
  for (const rod of Object.keys(CFG.roads)) {
    const a = points.filter(p => p.rod === rod);
    log(`${rod}: 계측점·방향 ${a.length}개, 자료 ${a.reduce((s, p) => s + p.days, 0)}행, 유효 ${a.reduce((s, p) => s + p.ok, 0)}, 0대 ${a.reduce((s, p) => s + p.zero, 0)}, 이상치 ${a.reduce((s, p) => s + p.odd, 0)}`);
  }
  log(`완료: ${stamp} (자료 ${meta.first} ~ ${meta.last})`);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
