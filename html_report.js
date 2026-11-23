'use strict';
// 메일 첨부용 독립형 HTML 보고서. 보고 대상 하루(브라질 00:00~23:59)의 GitHub 수집 기록(15분 슬롯)을 파일 안에 그대로 넣어,
// 인터넷·API 키·서버 없이 더블클릭만으로 열린다. (브라우저 화면의 「실시간 조회」 같은 기능은 없다 — 이 문서는 "그날의 기록"이다)
//   - 구성: 상단 요약 → 도로별(도식도 · 구간별 하루 요약 · 시간대별 평균 속도 표 · 15분 속도 추이 그래프 · ARTESP 일 통행량) → 혼잡 기준 → 도로 세그먼트 기준
//   - 그래프는 마우스를 올리면 15분 슬롯별 값이 보이고(첨부 HTML 안의 스크립트), 스크립트가 막혀도 표와 그림은 그대로 보인다.
const { GROUPS, LEVEL_NAMES, classify, TH, SEGMENT_NOTE, pointAt } = require('./lib');
const V = require('./volume_core');

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rad = x => x * Math.PI / 180;
const pad = n => String(n).padStart(2, '0');
const fmtKm = v => (Number.isInteger(v) ? String(v) : (+v).toFixed(1));
const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const slotMin = s => +s.slice(0, 2) * 60 + +s.slice(3);
const GAP_MIN = 40;
const ROAD_NOTE = { segs: '구간 1·2는 5 km, 구간 3은 10 km급(5 km 3·4번 합침, 실제 약 9.3 km) · SP-304 분기점 → SP-308 분기점', sp330: 'SP-133 교차점에서 남쪽으로 4 km · 2 km 구간 2개', sp308: '23.0177°S 47.4374°W → 23.0757°S 47.4032°W · 약 7.4 km · 2 km 단위 구간' };
const VID = { segs: 'SP306', sp330: 'SP330', sp308: 'SP308' };

/* ---------- 데이터 정리 (win: loadWindow 결과) ---------- */
function roadData(g, win) {
  const slots = win.filter(e => e.rec).map(e => ({ slot: e.slot, t: slotMin(e.slot), segs: (e.rec[g.key] || []) }));
  const segs = g.list.map((s, i) => ({
    i, seg: s,
    dirs: g.dirs.map(dir => {
      const pts = slots.map(sl => { const d = sl.segs[i] && sl.segs[i][dir.key]; return d ? { t: sl.t, slot: sl.slot, cur: d.cur, ff: d.ff, closed: d.closed, delay: d.delay } : null; }).filter(Boolean);
      const min = pts.length ? pts.reduce((a, b) => (b.cur < a.cur ? b : a)) : null;
      const mean = pts.length ? avg(pts.map(p => p.cur)) : null, ff = pts.length ? avg(pts.map(p => p.ff)) : null;
      const byH = Array.from({ length: 24 }, (_, h) => { const x = pts.filter(p => Math.floor(p.t / 60) === h); return x.length ? { cur: avg(x.map(p => p.cur)), ff: avg(x.map(p => p.ff)), closed: x.some(p => p.closed), n: x.length } : null; });
      return { dir, pts, n: pts.length, mean, ff, min, lv: pts.length ? classify(mean, ff, false) : 0, jam: pts.filter(p => classify(p.cur, p.ff, p.closed) === 4).length, slow: pts.filter(p => classify(p.cur, p.ff, p.closed) >= 3).length, byH };
    }),
  }));
  return { g, segs, nSlots: slots.length };
}

/* ---------- 도식도 (SVG, CSS 변수로 색) ---------- */
function mapSvg(R) {
  const L = R.g.list, all = L.flatMap(s => s.path);
  const kx = Math.cos(rad(all.reduce((a, p) => a + p[0], 0) / all.length));
  const Pj = p => [p[1] * kx, -p[0]];
  const xs = all.map(p => Pj(p)[0]), ys = all.map(p => Pj(p)[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const W = 420, sc = Math.min((W - 170) / (maxx - minx || 1), 320 / (maxy - miny || 1)), H = (maxy - miny) * sc + 100;
  const X = p => 85 + (Pj(p)[0] - minx) * sc, Y = p => 50 + (Pj(p)[1] - miny) * sc, OFF = 6;
  const lane = (s, side) => { const pts = s.path.map(p => [X(p), Y(p)]); return pts.map((q, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; return [q[0] + side * OFF * (-dy), q[1] + side * OFF * dx]; }); };
  let o = `<svg viewBox="0 0 ${W} ${H.toFixed(0)}" role="img" aria-label="${esc(R.g.road)} 구간별 도식도">`;
  L.forEach(s => { o += `<polyline points="${s.path.map(p => X(p).toFixed(1) + ',' + Y(p).toFixed(1)).join(' ')}" fill="none" stroke="var(--road)" stroke-width="20" stroke-linecap="butt" stroke-linejoin="round" opacity=".55"/>`; });
  R.g.dirs.forEach((d, di) => L.forEach((s, i) => { const lv = R.segs[i].dirs[di].lv; o += `<polyline points="${lane(s, di === 0 ? 1 : -1).map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ')}" fill="none" stroke="var(--c${lv})" stroke-width="7" stroke-linecap="butt" stroke-linejoin="round"/>`; }));
  L.forEach((s, i) => { const m = pointAt(s.path, 0.5), x = X(m) + 30, y = Y(m); o += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" fill="var(--panel)" stroke="var(--ink)" stroke-width="1.5"/><text x="${x.toFixed(1)}" y="${(y + 4.5).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--ink)">${i + 1}</text>`; });
  const a = L[0].path[0], b = L[L.length - 1].path.slice(-1)[0];
  o += `<g font-size="11.5" fill="var(--ink)" font-weight="600"><circle cx="${X(a).toFixed(1)}" cy="${Y(a).toFixed(1)}" r="5" fill="var(--ink)"/><text text-anchor="end" x="${(X(a) - 12).toFixed(1)}" y="${(Y(a) + 4).toFixed(1)}">시작</text><circle cx="${X(b).toFixed(1)}" cy="${Y(b).toFixed(1)}" r="5" fill="var(--ink)"/><text x="${(X(b) + 12).toFixed(1)}" y="${(Y(b) + 16).toFixed(1)}">끝</text></g></svg>`;
  return o;
}

/* ---------- 15분 속도 추이 그래프 (SVG; 값은 data-* 로 넣어 마우스 오버에서 읽는다) ---------- */
function trendSvg(R, di, idx) {
  const CW = 960, CH = 280, CL = 50, CR = 18, CT = 14, CB = 40, pw = CW - CL - CR, ph = CH - CT - CB, X = t => CL + t / 1440 * pw;
  const series = R.segs.map(S => S.dirs[di].pts);
  const nums = series.flat().map(p => p.cur);
  const dir = R.g.dirs[di];
  if (!nums.length) return `<div class="empty">${esc(dir.label)} — 이 날짜에 수집된 기록이 없습니다.</div>`;
  const yMax = Math.max(100, Math.ceil(Math.max(...nums) / 20) * 20), Y = v => CT + ph * (1 - v / yMax);
  let g = `<svg class="tr" viewBox="0 0 ${CW} ${CH}" role="img" aria-label="${esc(R.g.road)} ${esc(dir.label)} 15분 속도 추이"><text class="tk" x="${CL}" y="${CT - 3}">km/h</text>`;
  for (let v = 0; v <= yMax; v += 20) g += `<line class="${v === 0 ? 'ax' : 'gl'}" x1="${CL}" x2="${CW - CR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="tk" x="${CL - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`;
  for (let h = 0; h <= 24; h += 3) g += `<line class="ax" x1="${X(h * 60).toFixed(1)}" x2="${X(h * 60).toFixed(1)}" y1="${CT + ph}" y2="${CT + ph + 4}"/><text class="tk" x="${X(h * 60).toFixed(1)}" y="${CT + ph + 17}" text-anchor="middle">${pad(h)}:00</text>`;
  g += `<text class="tk" x="${CL + pw / 2}" y="${CH - 6}" text-anchor="middle">브라질 현지 시각 (BRT, UTC−3) · 15분 슬롯</text>`;
  const dots = series.every(s => s.length <= 24);
  for (let k = series.length - 1; k >= 0; k--) {
    let run = [], last = null;
    const flush = () => { if (run.length >= 2) g += `<polyline points="${run.map(p => X(p.t).toFixed(1) + ',' + Y(p.cur).toFixed(1)).join(' ')}" fill="none" stroke="var(--s${k + 1})" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`; if (run.length === 1 || dots) run.forEach(p => { g += `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.cur).toFixed(1)}" r="4" fill="var(--s${k + 1})" stroke="var(--panel)" stroke-width="2"/>`; }); run = []; };
    for (const p of series[k]) { if (last != null && p.t - last > GAP_MIN) flush(); run.push(p); last = p.t; }
    flush();
  }
  const m = series.flatMap((s, k) => s.map(p => ({ ...p, k }))).reduce((a, b) => (!a || b.cur < a.cur ? b : a), null);
  const mx = X(m.t), my = Y(m.cur), below = my + 26 < CT + ph - 2, tx = Math.max(CL + 70, Math.min(CW - CR - 70, mx));
  g += `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="5" fill="var(--s${m.k + 1})" stroke="var(--panel)" stroke-width="2"/><text x="${tx.toFixed(1)}" y="${(below ? my + 22 : my - 11).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="600" fill="var(--ink)" stroke="var(--panel)" stroke-width="3" paint-order="stroke">최저 ${Math.round(m.cur)} km/h · ${m.slot}</text>`;
  g += `<line class="cross" y1="${CT}" y2="${CT + ph}"/><rect class="hit" x="${CL}" y="${CT}" width="${pw}" height="${ph}" fill="transparent"/></svg><div class="tip"></div>`;
  // 마우스 오버용 데이터: 슬롯 시각 → 구간별 속도
  const byT = new Map();
  series.forEach((s, k) => s.forEach(p => { if (!byT.has(p.t)) byT.set(p.t, { t: p.t, slot: p.slot, v: Array(series.length).fill(null) }); byT.get(p.t).v[k] = Math.round(p.cur); }));
  const data = [...byT.values()].sort((a, b) => a.t - b.t);
  return `<div class="chartbox" data-label="${esc(dir.label)}" data-n="${series.length}" data-pts='${JSON.stringify(data)}'>${g}</div>`;
}

/* ---------- 한 도로 섹션 ---------- */
function roadSection(R, vol) {
  const g = R.g, id = VID[g.key];
  const got = R.nSlots, pctGot = Math.round(got / 96 * 100);
  let h = `<section class="road" id="road-${esc(g.key)}"><h2>${esc(g.road)} <small>${esc(ROAD_NOTE[g.key] || '')}</small></h2>`;
  h += `<div class="cols"><div class="panel map"><h3>구간 도식도 <small>(진행방향 오른쪽 선: ${esc(g.dirs[0].label)} · 왼쪽 선: ${esc(g.dirs[1].label)} · 하루 평균 속도 기준 색)</small></h3>${mapSvg(R)}</div>`;
  h += `<div class="panel"><h3>구간별 하루 요약 <small>(수집 ${got}/96칸, ${pctGot}%)</small></h3><div class="segl">`;
  R.segs.forEach(S => {
    h += `<div class="seg"><div class="seg-h"><span class="no">${S.i + 1}</span><b>${fmtKm(S.seg.from)} – ${fmtKm(S.seg.to)} km</b><small>(${fmtKm(+S.seg.len.toFixed(1))} km)</small></div><div class="dirs">`;
    S.dirs.forEach(D => {
      h += `<div class="dir lv${D.lv}"><div class="dn"><b>${esc(D.dir.label)}</b><span>${esc(D.dir.desc)}</span></div>`;
      h += D.n ? `<div class="sp">${Math.round(D.mean)}<small>km/h 평균</small></div><div class="lv">${LEVEL_NAMES[D.lv]}</div><div class="d">최저 ${Math.round(D.min.cur)} km/h (${D.min.slot}) · 정체 ${D.jam}회 · 자유흐름 ${Math.round(D.ff)} km/h · 수집 ${D.n}칸</div>` : `<div class="sp">–</div><div class="lv">정보 없음</div><div class="d">이 날 수집된 값이 없습니다</div>`;
      h += `</div>`;
    });
    h += `</div></div>`;
  });
  h += `</div></div></div>`;
  // 시간대별 평균 속도 표
  h += `<div class="panel"><h3>시간대별 평균 속도 (km/h) <small>· 브라질 현지 시각 0~23시 · 회색 칸 = 수집된 값 없음</small></h3><div class="tscroll"><table class="hm"><thead><tr><th></th>${Array.from({ length: 24 }, (_, x) => `<th>${pad(x)}</th>`).join('')}</tr></thead><tbody>`;
  g.dirs.forEach((dir, di) => {
    h += `<tr><th class="grp" colspan="25">${esc(dir.label)} · ${esc(dir.desc)}</th></tr>`;
    R.segs.forEach(S => { h += `<tr><th class="rl">구간 ${S.i + 1} <span>${fmtKm(S.seg.from)}–${fmtKm(S.seg.to)}km</span></th>`; S.dirs[di].byH.forEach((c, x) => { if (!c) h += `<td title="${pad(x)}시: 수집된 값 없음"></td>`; else { const lv = classify(c.cur, c.ff, c.closed); h += `<td class="l${lv}" title="${pad(x)}시 평균 ${Math.round(c.cur)} km/h · 자유흐름 대비 ${Math.round(c.cur / c.ff * 100)}% · 수집 ${c.n}칸">${Math.round(c.cur)}</td>`; } }); h += `</tr>`; });
  });
  h += `</tbody></table></div></div>`;
  // 추이 그래프
  h += `<div class="panel"><h3>구간별 15분 속도 추이 <small>(그래프 위에 마우스를 올리면 슬롯별 값 · 수집이 ${GAP_MIN}분 넘게 비면 선을 끊음)</small></h3><div class="tl">${R.segs.map(S => `<span style="--k:var(--s${S.i + 1})"><i></i>구간 ${S.i + 1} (${fmtKm(S.seg.from)}–${fmtKm(S.seg.to)} km)</span>`).join('')}</div>`;
  g.dirs.forEach((dir, di) => { h += `<div class="chart"><h4>${esc(dir.label)} <small>${esc(dir.desc)}</small></h4>${trendSvg(R, di)}</div>`; });
  h += `</div>`;
  // 통행량
  h += `<div class="panel volp">${V.htmlBlock(vol, id, esc).replace(/<p style="margin:12px 0 4px">/, '<h3 style="margin:0 0 8px">').replace(/<\/b> <span style="color:#667078;font-size:11.5px">/, '</b> <small>').replace(/<\/span><\/p>/, '</small></h3>') || '<div class="empty">통행량 정보를 불러오지 못했습니다.</div>'}</div>`;
  return h + `</section>`;
}

/* ---------- 문서 전체 ---------- */
function buildHtmlReport(win, w, label, vol, info) {
  const roads = GROUPS.map(g => roadData(g, win));
  const total = win.length, got = win.filter(e => e.rec).length;
  const css = `
:root{--bg:#f4f5f2;--panel:#fff;--ink:#1c2226;--mute:#667078;--line:#e1e4df;--accent:#2f6b4f;--accent-ink:#fff;--c0:#b9bfc4;--c1:#2e9e5b;--c2:#e0b21a;--c3:#e8742a;--c4:#c9302c;--c5:#6b2d8a;--road:#cfd4d8;--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--vol:#b7d3f6;--vol-bd:#2a78d6;--vol-ink:#0b2a4a}
@media (prefers-color-scheme:dark){:root{--bg:#121618;--panel:#1b2124;--ink:#e7eaeb;--mute:#95a0a7;--line:#2c3539;--accent:#6fc79c;--accent-ink:#0b1f16;--c0:#59646b;--c1:#43c077;--c2:#e6c13f;--c3:#f08a45;--c4:#ee5a54;--c5:#b97ad6;--road:#3a444a;--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--vol:#1c3a5e;--vol-bd:#5aa2f0;--vol-ink:#dbe9fb}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,"Segoe UI","Malgun Gothic","Noto Sans KR",sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:18px 16px 48px}
h1{font-size:clamp(20px,3vw,27px);margin:0 0 4px}.sub{color:var(--mute);margin:0 0 12px;font-size:13px}
.tzbar{background:var(--accent);color:var(--accent-ink);border-radius:12px;padding:10px 16px;margin-bottom:14px;font-size:13px}.tzbar b{font-size:14px}
.note{padding:9px 13px;border-radius:10px;background:color-mix(in srgb,var(--c2) 14%,transparent);border-left:4px solid var(--c2);font-size:12.5px;margin-bottom:14px}
nav{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}nav a{padding:6px 14px;border:1px solid var(--line);border-radius:99px;background:var(--panel);color:var(--ink);text-decoration:none;font-weight:600;font-size:13px}
section.road{margin-bottom:28px}section.road>h2{font-size:21px;margin:18px 0 8px;padding-bottom:6px;border-bottom:2px solid var(--accent)}section.road>h2 small{font-weight:400;color:var(--mute);font-size:12.5px;margin-left:8px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:13px 15px;margin-bottom:14px}.panel h3{font-size:15.5px;margin:0 0 8px}.panel h3 small,.panel h4 small{font-weight:400;color:var(--mute);font-size:12px}
.cols{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.3fr);gap:14px;align-items:start}@media(max-width:800px){.cols{grid-template-columns:1fr}}
.cols .panel{margin-bottom:0}.map svg{width:100%;max-height:360px;height:auto;display:block}
.segl{display:flex;flex-direction:column;gap:9px}.seg{border:1px solid var(--line);border-radius:12px;padding:9px 11px}.seg-h{display:flex;align-items:center;gap:9px;margin-bottom:7px}.seg-h small{color:var(--mute)}
.no{min-width:28px;height:28px;border-radius:9px;display:grid;place-items:center;font-weight:700;font-size:13px;color:var(--panel);background:var(--ink)}
.dirs{display:grid;grid-template-columns:1fr 1fr;gap:8px}@media(max-width:520px){.dirs{grid-template-columns:1fr}}
.dir{border-radius:10px;padding:7px 10px;background:color-mix(in srgb,var(--lc,var(--c0)) 13%,transparent);border-left:5px solid var(--lc,var(--c0))}.dir .dn{font-size:12px;color:var(--mute);display:flex;justify-content:space-between;gap:6px}.dir .dn b{color:var(--ink)}
.dir .sp{font-size:22px;font-weight:700;line-height:1.15}.dir .sp small{font-size:11px;font-weight:400;color:var(--mute);margin-left:3px}.dir .lv{font-weight:700;color:var(--lc,var(--mute));font-size:13px}.dir .d{font-size:11.5px;color:var(--mute)}
.lv0{--lc:var(--c0)}.lv1{--lc:var(--c1)}.lv2{--lc:var(--c2)}.lv3{--lc:var(--c3)}.lv4{--lc:var(--c4)}.lv5{--lc:var(--c5)}
.tscroll{overflow-x:auto}table.hm{border-collapse:separate;border-spacing:2px;width:100%;min-width:640px;font-size:11px}table.hm th{font-weight:500;color:var(--mute);padding:2px 0;text-align:center}table.hm th.rl{text-align:left;padding-right:8px;white-space:nowrap;color:var(--ink);font-weight:600}table.hm th.rl span{font-weight:400;color:var(--mute)}table.hm th.grp{text-align:left;color:var(--accent);font-size:12.5px;padding:8px 0 2px}
table.hm td{height:28px;border-radius:5px;text-align:center;background:var(--line);color:var(--mute);font-weight:600}table.hm td.l0{background:var(--c0);color:#fff}table.hm td.l1{background:var(--c1);color:#fff}table.hm td.l2{background:var(--c2);color:#2b2300}table.hm td.l3{background:var(--c3);color:#fff}table.hm td.l4{background:var(--c4);color:#fff}table.hm td.l5{background:var(--c5);color:#fff}
.tl{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12.5px;color:var(--mute);margin:2px 0 8px}.tl span,.tip div{display:inline-flex;align-items:center;gap:6px}.tl i{display:inline-block;width:18px;height:0;border-top:2px solid var(--k)}
.chart h4{font-size:14px;margin:10px 0 4px}.chartbox{position:relative;overflow-x:auto}.chartbox svg{display:block;width:100%;min-width:520px;height:auto}
.gl{stroke:var(--line);stroke-width:1}.ax{stroke:var(--road);stroke-width:1}.tk{fill:var(--mute);font-size:11px}.cross{stroke:var(--mute);stroke-width:1;opacity:0}
.tip{position:absolute;pointer-events:none;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,.16);padding:7px 10px;font-size:12px;white-space:nowrap;display:none;z-index:3}.tip b{display:block;margin-bottom:3px}.tip div{display:flex}.tip i{display:inline-block;width:10px;height:0;border-top:2px solid var(--k)}.tip em{margin-left:auto;padding-left:14px;font-style:normal;font-weight:600}
.empty{color:var(--mute);font-size:13px;padding:14px 4px}
.volp table{border-collapse:collapse;width:100%;font-size:12px}
.th{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0}.th span{padding:4px 11px;border-radius:99px;color:#fff;font-weight:700;font-size:12px}
footer{font-size:12.5px;color:var(--mute);line-height:1.7;margin-top:18px}footer ul{padding-left:18px;margin:6px 0}
@media print{body{background:#fff}.chartbox,.tscroll{overflow:visible}nav{display:none}.panel{break-inside:avoid}}`;
  const script = `
document.querySelectorAll('.chartbox').forEach(function(box){
  var pts; try{ pts=JSON.parse(box.getAttribute('data-pts')); }catch(e){ return; }
  var svg=box.querySelector('svg'), tip=box.querySelector('.tip'), cross=box.querySelector('.cross'); if(!svg||!tip||!cross) return;
  var CW=960, CL=50, CR=18, pw=CW-CL-CR, label=box.getAttribute('data-label');
  function show(ev){
    var r=svg.getBoundingClientRect(), t=((ev.clientX-r.left)/r.width*CW-CL)/pw*1440, near=null, bd=1e9;
    pts.forEach(function(p){ var d=Math.abs(p.t-t); if(d<bd){bd=d;near=p;} });
    if(!near||bd>20){ tip.style.display='none'; cross.style.opacity=0; return; }
    var x=CL+near.t/1440*pw; cross.setAttribute('x1',x); cross.setAttribute('x2',x); cross.style.opacity=1;
    var h='<b>'+near.slot+' BRT · '+label+'</b>';
    near.v.forEach(function(v,k){ h+='<div style="--k:var(--s'+(k+1)+')"><i></i>구간 '+(k+1)+'<em>'+(v==null?'–':v+' km/h')+'</em></div>'; });
    tip.innerHTML=h; tip.style.display='block';
    var b=box.getBoundingClientRect(), left=ev.clientX-b.left+box.scrollLeft+14;
    tip.style.left=(left+tip.offsetWidth>box.scrollWidth?left-tip.offsetWidth-28:left)+'px'; tip.style.top='8px';
  }
  svg.addEventListener('pointermove',show); svg.addEventListener('pointerdown',show);
  svg.addEventListener('pointerleave',function(){ tip.style.display='none'; cross.style.opacity=0; });
});`;
  const lvColors = ['#b9bfc4', '#2e9e5b', '#e0b21a', '#e8742a', '#c9302c', '#6b2d8a'];
  const body = `
<div class="wrap">
<h1>🚗 SP-306 · SP-330 · SP-308 구간별 교통상황 일일 보고</h1>
<p class="sub">브라질 상파울루주 · 보고 대상 <b>${esc(w.day)} 00:00 ~ 23:59</b> (브라질 현지 시간)</p>
<div class="tzbar"><b>🕒 시간 기준: 브라질 현지 시간 (상파울루주 · America/Sao_Paulo · UTC−3, BRT)</b><br>이 문서의 모든 시각은 대한민국 시간이 아니라 브라질 현지 시간입니다 (브라질 시각 = 한국 시각 − 12시간). 속도 값은 GitHub 가 15분마다 수집한 TomTom 기록 ${got}/${total}칸(${Math.round(got / total * 100)}%)입니다.</div>
${got < total * 0.5 ? `<div class="note"><b>⚠ 수집이 ${Math.round(got / total * 100)}%뿐입니다.</b> GitHub 무료 스케줄이 15분 주기를 지키지 못해 이 날은 ${total - got}칸이 비어 있습니다. 평균·최저·그래프는 수집된 칸만으로 계산한 값이며, 비어 있는 시간대의 상황은 알 수 없습니다.</div>` : ''}
<nav>${roads.map(R => `<a href="#road-${esc(R.g.key)}">${esc(R.g.road)}</a>`).join('')}<a href="#basis">기준·한계</a></nav>
${roads.map(R => roadSection(R, vol)).join('\n')}
<section id="basis"><div class="panel"><h3>혼잡 단계 기준</h3><p style="margin:0 0 6px;font-size:13px;color:var(--mute)">현재 속도 ÷ 자유 흐름 속도(%) — 원활 ≥ ${TH.smooth}% · 서행 ${TH.slow}~${TH.smooth}% · 지체 ${TH.delay}~${TH.slow}% · 정체 &lt; ${TH.delay}% · 도로 폐쇄가 보고되면 통제</p><div class="th">${['정보 없음', '원활', '서행', '지체', '정체', '통제'].map((n, i) => `<span style="background:${lvColors[i]};${i === 2 ? 'color:#2b2300' : ''}">${n}</span>`).join('')}</div></div>
<div class="panel"><h3>${esc(SEGMENT_NOTE.title)}</h3>${SEGMENT_NOTE.lines.map(l => `<p style="margin:3px 0;font-size:13px">${esc(l)}</p>`).join('')}</div>
<footer><ul>
<li><b>구간 위치</b>: SP-306 은 SP-304 분기점 기준 거리, SP-330 은 SP-133 교차점에서 남쪽 거리, SP-308 은 지정 시작점 기준 거리입니다(OSRM 도로 선형을 자른 값).</li>
<li><b>방향 구분</b>: 각 방향 차로 쪽 약 10 m 벗어난 지점을 조회하고, 응답 도로의 진행 방위가 기대한 방향과 같은지 검증한 값만 씁니다.</li>
<li><b>측정 한계</b>: TomTom 은 수 km~26 km 의 도로 세그먼트 단위로 속도를 주므로, 같은 세그먼트에 속한 구간은 값이 같게 나옵니다.</li>
<li><b>데이터 출처</b>: 속도 = TomTom Traffic Flow (GitHub Actions 수집), 일일 통행량 = ARTESP 공개 자료(SAT). 이 파일은 보고서 생성 시점의 기록을 담은 정적 문서이며, 새로 고쳐도 갱신되지 않습니다. 15분 단위 전체 값은 함께 첨부된 엑셀에 있습니다.</li>
</ul></footer></section>
</div>`;
  return `<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SP-306·SP-330·SP-308 교통상황 ${esc(w.day)} (브라질 현지 시간)</title><style>${css}</style></head><body>${body}<script>${script}</script></body></html>`;
}

module.exports = { buildHtmlReport };
