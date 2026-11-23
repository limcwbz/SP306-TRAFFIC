'use strict';
// ARTESP 공개 자료(SAT 일별 계수) 공통 모듈 — 엑셀·메일·HTML·단독 집계(volume.js)가 함께 쓴다.
//  - 내려받기/파싱/이상치 판정/집계, 우리 TomTom 구간과의 위치 관계(구간 안=파란색), 메일·엑셀 표 만들기
//  - 자료: https://dadosabertos.artesp.sp.gov.br/dataset/volume-de-trafego  ("Contagem SAT's por dia em 연도", CSV)
//  - 환경변수: VOLUME_CSV 이미 받은 CSV 경로(쉼표 구분). 지정하면 내려받지 않음
// 주의: 공개 자료는 며칠 늦게 올라온다. 값은 "계측점 한 곳을 하루에 지나간 차량 대수"이며 구간 전체의 대수가 아니다.
const fs = require('fs');
const path = require('path');

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'volume_config.json'), 'utf8'));
const PKG_URL = 'https://dadosabertos.artesp.sp.gov.br/api/3/action/package_show?id=volume-de-trafego';
const UA = 'Mozilla/5.0 (compatible; sp306-volume/1.0)';
const FACTOR = Number(CFG.outlierFactor || 5);
const MOTO_SHARE = Number(CFG.motoShareSuspect || 0.7), MOTO_MIN_TOTAL = Number(CFG.motoMinTotal || 20000);
const MARGIN = Number(CFG.marginKm == null ? 5 : CFG.marginKm);
// 「TomTom 속도 집계 구간」 강조색 — 혼잡 단계(원활 초록·서행 노랑·지체 주황·정체 빨강·통제 보라·정보없음 회색)와 겹치지 않는 파란색
const HILITE = { excel: 'FF9EC5F4', excelHead: 'FF1F5FA8', html: '#b7d3f6', htmlBorder: '#2a78d6' };
const log = m => console.log(`${new Date().toISOString()} ${m}`);

/* ---------- 내려받기 ---------- */
async function getText(url, label) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(280000) });
  if (!res.ok) throw new Error(`${label} 다운로드 실패: HTTP ${res.status}`);
  const t = await res.text();
  log(`${label}: ${(t.length / 1048576).toFixed(1)} MB`);
  return t;
}
function yearsToLoad() {
  if (Array.isArray(CFG.years)) return CFG.years;
  const d = new Date(Date.now() - 3 * 3600000), y = d.getUTCFullYear(); // 브라질 현지(UTC−3) 기준 연도
  return d.getUTCMonth() === 0 ? [y - 1, y] : [y]; // 1월에는 12월 자료를 위해 작년 파일도
}
async function loadCsvTexts() {
  if (process.env.VOLUME_CSV) return process.env.VOLUME_CSV.split(',').map(f => ({ name: path.basename(f.trim()), text: fs.readFileSync(f.trim(), 'utf8') }));
  const pkg = JSON.parse(await getText(PKG_URL, '통행량 데이터셋 정보'));
  if (!pkg.success) throw new Error('ARTESP 데이터셋 정보를 읽지 못했습니다');
  const out = [];
  for (const y of yearsToLoad()) {
    const r = pkg.result.resources.find(x => /SAT/i.test(x.name) && new RegExp(`por dia\\s+em\\s+${y}\\b`, 'i').test(x.name));
    if (!r) { log(`"${y}년 SAT 일별" 자료를 찾지 못해 건너뜀`); continue; }
    out.push({ name: r.name, text: await getText(r.url, r.name) });
  }
  if (!out.length) throw new Error('SAT 일별 자료를 하나도 찾지 못했습니다 (ARTESP 가 자료 이름을 바꿨을 수 있음)');
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
  const ix = {};
  for (const k of ['DATA', 'CONCESSIONARIA', 'RODOVIA', 'KM', 'COMPLEMENTO', 'SENTIDO', 'MARGINAL', 'QTD_MOTO', 'QTD_PASSEIO', 'QTD_COMERCIAL']) {
    ix[k] = head.indexOf(k);
    if (ix[k] < 0) throw new Error(`CSV 에 "${k}" 열이 없습니다 (자료 형식이 바뀐 듯). 현재 열: ${head.join(',')}`);
  }
  const rows = []; let bad = 0;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = parseLine(lines[i]), R = CFG.roads[c[ix.RODOVIA]];
    if (!R || R.noData) continue;
    const km = +c[ix.KM], comp = +c[ix.COMPLEMENTO], moto = +c[ix.QTD_MOTO], pass = +c[ix.QTD_PASSEIO], com = +c[ix.QTD_COMERCIAL];
    if (![km, comp, moto, pass, com].every(Number.isFinite) || !/^\d{4}-\d{2}-\d{2}$/.test(c[ix.DATA])) { bad++; continue; }
    rows.push({ date: c[ix.DATA], conc: c[ix.CONCESSIONARIA], rod: c[ix.RODOVIA], kmv: km + comp / 1000, kmL: `${km}+${String(comp).padStart(3, '0')}`, dir: c[ix.SENTIDO], marg: c[ix.MARGINAL] === 'SIM', moto, pass, com, total: moto + pass + com });
  }
  return { rows, bad };
}

/* ---------- 집계 ---------- */
const isWeekend = d => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return w === 0 || w === 6; };
const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const keyOf = r => `${r.rod}|${r.conc}|${r.kmL}|${r.dir}|${r.marg ? 'M' : 'P'}`;

// 우리 TomTom 구간과의 위치 관계: inside(구간 안) / near(구간 밖이지만 marginKm 이내) / far
function posOf(R, kmv) {
  const [lo, hi] = R.ourKm;
  if (kmv >= lo && kmv <= hi) {
    const segIdx = (R.segKm || []).findIndex(([a, b]) => kmv >= Math.min(a, b) && kmv <= Math.max(a, b));
    return { zone: 'inside', segIdx, dist: 0, edge: Math.min(kmv - lo, hi - kmv) < 0.5 }; // edge: 경계에서 0.5 km 이내(위치 추정 오차 때문에 구간 밖일 수도 있음)
  }
  const dist = kmv < lo ? lo - kmv : kmv - hi;
  return { zone: dist <= MARGIN ? 'near' : 'far', segIdx: -1, dist, edge: false };
}

// 자료의 마지막 날은 아직 하루가 다 모이지 않은 부분 값인 경우가 많다(2026-11 실측: 같은 요일 평균의 약 17%, 직전 날은 약 109%).
// 그래서 마지막 날의 값이 같은 요일 최근 평균의 60% 미만(중앙값 기준)이면 "미완료"로 보고 집계·보기에서 뺀다.
function dropPartialLastDay(rows) {
  if (!rows.length) return { rows, partial: null, ratio: null };
  const last = rows.reduce((m, r) => (r.date > m ? r.date : m), '');
  const wd = d => new Date(d + 'T12:00:00Z').getUTCDay();
  const by = new Map();
  for (const r of rows) { if (r.marg) continue; const k = keyOf(r); (by.get(k) || by.set(k, new Map()).get(k)).set(r.date, r.total); }
  const ratios = [];
  for (const m of by.values()) {
    const v = m.get(last); if (!(v > 0)) continue;
    const base = [...m.entries()].filter(([d, x]) => d < last && wd(d) === wd(last) && x > 0).sort((p, q) => p[0].localeCompare(q[0])).slice(-4).map(e => e[1]);
    if (base.length >= 2) ratios.push(v / (base.reduce((s, x) => s + x, 0) / base.length));
  }
  if (ratios.length < 20) return { rows, partial: null, ratio: null }; // 비교 지점이 적으면 판단하지 않는다
  ratios.sort((x, y) => x - y);
  const med = ratios[Math.floor(ratios.length / 2)];
  return med < 0.6 ? { rows: rows.filter(r => r.date !== last), partial: last, ratio: med } : { rows, partial: null, ratio: med };
}

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
    const ok = list.filter(r => r.flag === '정상'), f = list[0], R = CFG.roads[f.rod], where = posOf(R, f.kmv);
    points.push({
      k, rod: f.rod, conc: f.conc, kmv: f.kmv, kmL: f.kmL, dir: f.dir, marg: f.marg, list, byDate: dm, median,
      zone: where.zone, segIdx: where.segIdx, dist: where.dist, edge: where.edge,
      days: list.length, ok: ok.length, zero: list.filter(r => r.flag.startsWith('0')).length, odd: list.filter(r => r.flag !== '정상' && !r.flag.startsWith('0')).length,
      trust: ok.length >= list.length * 0.5 ? '양호' : '신뢰 낮음',
      avgTot: avg(ok.map(r => r.total)), avgMoto: avg(ok.map(r => r.moto)), avgPass: avg(ok.map(r => r.pass)), avgCom: avg(ok.map(r => r.com)),
      avgWd: avg(ok.filter(r => !isWeekend(r.date)).map(r => r.total)), avgWe: avg(ok.filter(r => isWeekend(r.date)).map(r => r.total)),
      last: list[list.length - 1].date,
    });
  }
  return points.sort((a, b) => a.rod.localeCompare(b.rod) || a.kmv - b.kmv || a.dir.localeCompare(b.dir) || a.marg - b.marg);
}

/* ---------- 보고용 보기(view): 우리 구간 안 + 인접 계측점, 최근 7일 ---------- */
function makeView(points, meta) {
  const end = new Date(meta.last + 'T12:00:00Z'), dates = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(end); d.setUTCDate(d.getUTCDate() - i); dates.push(d.toISOString().slice(0, 10)); }
  const roads = [];
  for (const id of CFG.order) {
    const R = CFG.roads[id]; if (!R) continue;
    if (R.noData) { roads.push({ id, display: R.display, noData: true, note: R.note, rows: [] }); continue; }
    const cutoff = new Date(end.getTime() - 14 * 86400000).toISOString().slice(0, 10);
    const rows = points.filter(p => p.rod === id && !p.marg && p.zone !== 'far' && p.last >= cutoff)
      .sort((a, b) => (a.zone === b.zone ? 0 : a.zone === 'inside' ? -1 : 1) || a.kmv - b.kmv || a.dir.localeCompare(b.dir))
      .map(p => {
        const vals = dates.map(d => { const r = p.byDate.get(d); return r ? { v: r.total, flag: r.flag } : null; });
        const okv = vals.filter(x => x && x.flag === '정상').map(x => x.v);
        return { zone: p.zone, edge: p.edge, segNo: p.segIdx >= 0 ? p.segIdx + 1 : null, dist: p.dist, conc: p.conc, kmL: p.kmL, kmv: p.kmv, satDir: p.dir, dirLabel: R.dirLabels[p.dir] || p.dir,
          vals, avg7: okv.length ? avg(okv) : null, avgAll: p.avgTot, avgWd: p.avgWd, avgWe: p.avgWe, days: p.days, ok: p.ok, trust: p.trust, last: p.last };
      });
    roads.push({ id, display: R.display, ourKm: R.ourKm, basis: R.basis, rows });
  }
  return { first: meta.first, last: meta.last, partialDay: meta.partialDay || null, dates, roads, margin: MARGIN, generatedAt: meta.at };
}

async function load() {
  const texts = await loadCsvTexts();
  let rows = [], bad = 0;
  for (const t of texts) { const r = parseRows(t.text); rows = rows.concat(r.rows); bad += r.bad; }
  if (!rows.length) throw new Error('조건에 맞는 계측점이 없습니다 (volume_config.json 의 도로 코드를 확인하세요).');
  if (bad) log(`형식이 맞지 않아 건너뛴 행: ${bad}`);
  const cut = dropPartialLastDay(rows); rows = cut.rows;
  const points = aggregate(rows), dates = rows.map(r => r.date).sort();
  const meta = { first: dates[0], last: dates[dates.length - 1], partialDay: cut.partial, names: texts.map(t => t.name), at: new Date().toISOString() };
  if (cut.partial) log(`자료의 마지막 일자 ${cut.partial} 는 같은 요일 평균의 ${Math.round(cut.ratio * 100)}% 로 하루가 다 모이지 않은 값이라 제외하고 ${meta.last} 까지 집계합니다.`);
  return { points, meta, view: makeView(points, meta) };
}

/* ---------- 메일 본문용 (텍스트 / HTML) ---------- */
const fmtN = v => (v == null ? '-' : Math.round(v).toLocaleString('en-US'));
const cellTxt = c => (c ? (c.flag === '정상' ? fmtN(c.v) : `${fmtN(c.v)} ⚠`) : '-');
const zoneTxt = x => (x.zone === 'inside' ? `TomTom 집계 구간 안${x.segNo ? '(구간 ' + x.segNo + ')' : ''}` : `인접 참고(구간 밖 ${x.dist.toFixed(1)} km)`);

function textBlock(view, id) {
  const r = view && view.roads.find(x => x.id === id); if (!r) return [];
  const L = [`[일일 통행량 · ARTESP 공개 자료 · ${r.display}]  (자료 마지막 일자 ${view.last})`];
  if (r.noData) { L.push('  ' + r.note, ''); return L; }
  if (!r.rows.length) { L.push('  우리 구간 부근에 계측점이 없습니다.', ''); return L; }
  r.rows.forEach(x => L.push(`  ${x.zone === 'inside' ? '■' : '□'} ${zoneTxt(x)} · km ${x.kmL} · ${x.dirLabel}: ${view.dates[6].slice(5)} ${cellTxt(x.vals[6])}대, 최근 7일 평균 ${fmtN(x.avg7)}대, 연 일평균 ${fmtN(x.avgAll)}대${x.trust !== '양호' ? ' (신뢰 낮음)' : ''}${x.edge ? ' · 구간 경계 근처(위치 오차 시 구간 밖일 수 있음)' : ''}`));
  L.push('  ■ = TomTom 속도를 집계하는 구간 안의 계측점(엑셀·메일 표에서는 파란색). ⚠ = 0대·이상치(평균에서 제외). 값은 계측점 한 곳의 하루 통과 대수입니다.' + (view.partialDay ? ` 자료의 마지막 일자 ${view.partialDay}는 하루가 다 모이지 않아 제외했습니다.` : ''), '');
  return L;
}

function htmlBlock(view, id, esc) {
  const r = view && view.roads.find(x => x.id === id); if (!r) return '';
  const th = 'style="background:#2f6b4f;color:#fff;padding:4px 7px;text-align:center;font-size:12px;border:1px solid #d0d4d8"';
  const tdB = 'padding:4px 7px;text-align:center;font-size:12px;border:1px solid #d0d4d8';
  let h = `<p style="margin:12px 0 4px"><b>일일 통행량 · ARTESP 공개 자료 · ${esc(r.display)}</b> <span style="color:#667078;font-size:11.5px">(자료 마지막 일자 ${esc(view.last)})</span></p>`;
  if (r.noData) return h + `<p style="margin:2px 0;color:#667078;font-size:12.5px">${esc(r.note)}</p>`;
  if (!r.rows.length) return h + '<p style="margin:2px 0;color:#667078;font-size:12.5px">우리 구간 부근에 계측점이 없습니다.</p>';
  h += `<table style="border-collapse:collapse;font-family:'Malgun Gothic',sans-serif"><tr>${['구분', 'km', '방향', `${view.dates[6].slice(5)} 통행량(대)`, '최근 7일 평균', '연 일평균', '신뢰도'].map(t => `<th ${th}>${t}</th>`).join('')}</tr>`;
  r.rows.forEach(x => {
    const inside = x.zone === 'inside', bg = inside ? `background:${HILITE.html};` : '', bl = inside ? `border-left:4px solid ${HILITE.htmlBorder};` : '', fw = inside ? 'font-weight:600;' : '';
    h += `<tr><td style="${tdB};${bg}${bl}${fw}">${esc(zoneTxt(x))}${x.edge ? '<br><span style="font-weight:400;font-size:11px;color:#52514e">경계 근처</span>' : ''}</td>`
      + [x.kmL, x.dirLabel, cellTxt(x.vals[6]), fmtN(x.avg7), fmtN(x.avgAll), x.trust].map(v => `<td style="${tdB};${bg}${fw}">${esc(v)}</td>`).join('') + '</tr>';
  });
  return h + `</table><p style="margin:3px 0 0;font-size:11px;color:#667078"><span style="display:inline-block;width:11px;height:11px;background:${HILITE.html};border-left:3px solid ${HILITE.htmlBorder};vertical-align:middle"></span> 파란색 = TomTom 속도를 집계하는 구간 안의 계측점 · ⚠ = 0대·이상치(평균에서 제외) · 값은 계측점 한 곳의 하루 통과 대수 · 구간 위치는 사고 기록으로 추정한 값${view.partialDay ? ` · 자료의 마지막 일자 ${esc(view.partialDay)}는 하루가 다 모이지 않아 제외` : ''}</p>`;
}

/* ---------- 엑셀 시트 ---------- */
const HEADFILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F6B4F' } };
const thin = { style: 'thin', color: { argb: 'FFD0D4D8' } }, BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const BLUEFILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: HILITE.excel } };

function addVolumeSheet(wb, view, name) {
  const ws = wb.addWorksheet(name || '일일 통행량(ARTESP)', { views: [{ state: 'frozen', ySplit: 3 }] });
  const widths = [24, 9, 20, 11, 8, 14, ...view.dates.map(() => 10), 12, 12, 11, 11, 10, 34];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const nCol = widths.length;
  ws.mergeCells(1, 1, 1, nCol);
  ws.getCell(1, 1).value = `일일 통행량(차량 대수) · ARTESP 공개 자료 · 자료 마지막 일자 ${view.last} · 값 = 계측점 한 곳의 하루 통과 대수`;
  ws.getCell(1, 1).font = { bold: true, size: 13 };
  ws.mergeCells(2, 1, 2, nCol);
  const leg = ws.getCell(2, 1);
  leg.value = '■ 파란색 행 = TomTom 15분 속도를 집계하는 구간 안의 ARTESP 계측점 (구간 위치는 사고 기록으로 추정한 값이라 오차가 있을 수 있음) · 흰색 행 = 구간 밖 인접 참고 · ⚠ = 0대 또는 이상치(평균에서 제외)';
  leg.fill = BLUEFILL; leg.font = { bold: true, color: { argb: 'FF0B2A4A' } }; leg.alignment = { wrapText: true, vertical: 'middle' };
  ws.getRow(2).height = 30;
  let r = 4;
  for (const R of view.roads) {
    ws.mergeCells(r, 1, r, nCol);
    const t = ws.getCell(r, 1); t.value = `${R.display}${R.ourKm ? ` · 우리 구간 추정 도로 km ${R.ourKm[0]}~${R.ourKm[1]}` : ''}`; t.font = { bold: true, size: 12, color: { argb: 'FF2F6B4F' } };
    r++;
    if (R.noData || !R.rows.length) { ws.mergeCells(r, 1, r, nCol); ws.getCell(r, 1).value = R.noData ? R.note : '우리 구간 부근에 ARTESP 계측점이 없습니다.'; ws.getCell(r, 1).font = { italic: true, color: { argb: 'FF667078' } }; r += 2; continue; }
    const head = ws.getRow(r);
    head.values = ['구분', 'TomTom 구간', '운영사', '지점 km', 'SAT 방향', '우리 방향명', ...view.dates.map(d => d.slice(5)), '최근 7일 평균', '연 일평균(대)', '평일 평균', '주말 평균', '신뢰도', '비고'];
    head.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = HEADFILL; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = BORDER; });
    r++;
    for (const x of R.rows) {
      const inside = x.zone === 'inside';
      const note = [x.edge ? '구간 경계 근처 — 위치 오차 시 구간 밖일 수 있음' : '', x.trust !== '양호' ? '유효 일수 절반 미만 — 평균을 믿기 어려움' : ''].filter(Boolean).join(' / ');
      const row = ws.getRow(r);
      row.values = [inside ? `TomTom 집계 구간 안` : `인접 참고(구간 밖 ${x.dist.toFixed(1)} km)`, x.segNo ? `구간 ${x.segNo}` : '-', x.conc, x.kmL, x.satDir, x.dirLabel,
        ...x.vals.map(c => (c ? (c.flag === '정상' ? c.v : `${Math.round(c.v).toLocaleString('en-US')} ⚠`) : null)),
        x.avg7 == null ? null : Math.round(x.avg7), x.avgAll == null ? null : Math.round(x.avgAll), x.avgWd == null ? null : Math.round(x.avgWd), x.avgWe == null ? null : Math.round(x.avgWe), x.trust, note];
      row.eachCell({ includeEmpty: true }, (c, n) => {
        c.border = BORDER; c.alignment = { horizontal: n === nCol ? 'left' : 'center', vertical: 'middle', wrapText: n === nCol };
        if (inside) { c.fill = BLUEFILL; c.font = { bold: true, color: { argb: 'FF0B2A4A' } }; }
        if (typeof c.value === 'number') c.numFmt = '#,##0';
        if (typeof c.value === 'string' && c.value.endsWith('⚠')) c.font = { ...(c.font || {}), italic: true, color: { argb: 'FF667078' } };
      });
      r++;
    }
    if (R.basis) { ws.mergeCells(r, 1, r, nCol); ws.getCell(r, 1).value = `※ 구간 위치: ${R.basis}`; ws.getCell(r, 1).font = { size: 10, color: { argb: 'FF667078' } }; r++; }
    r++;
  }
  ws.mergeCells(r, 1, r, nCol);
  ws.getCell(r, 1).value = '※ ARTESP 공개 자료는 며칠 늦게 올라와 보고 대상일의 값이 없을 수 있습니다(위 열은 자료의 마지막 7일' + (view.partialDay ? `, 자료의 마지막 일자 ${view.partialDay}는 하루가 다 모이지 않아 제외` : '') + '). 계측점은 약 12~15 km 간격이라 우리 구간별로 나눌 수 없고, SP-306 은 자료에 없습니다. 이상치·센서 오기록 판정은 기준값 방식이라 완전하지 않습니다.';
  ws.getCell(r, 1).alignment = { wrapText: true, vertical: 'top' }; ws.getRow(r).height = 32; ws.getCell(r, 1).font = { size: 10, color: { argb: 'FF667078' } };
  return ws;
}

module.exports = { CFG, HILITE, FACTOR, MOTO_SHARE, MOTO_MIN_TOTAL, load, loadCsvTexts, parseRows, aggregate, makeView, posOf, textBlock, htmlBlock, addVolumeSheet, fmtN, log, avg };
