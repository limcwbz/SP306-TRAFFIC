'use strict';
// 일일 요약장표: HTML 화면처럼 위에서부터 [도로 도식도(혼잡 색)] → [구간별 하루 요약 카드] → [시간대별 평균 속도 표] 를 도로별 한 장의 이미지로 만든다.
//  - 엑셀 「요약장표」 시트와 메일 본문 맨 위에 같은 그림을 쓴다. (SVG → PNG, 한글 폰트는 chart.js 와 같은 방식)
//  - 값은 보고 대상 하루(브라질 00:00~23:59)의 15분 슬롯 기록이다. "현재 속도"가 아니라 그날의 평균/최저 기준이다.
const { Resvg } = require('@resvg/resvg-js');
const { GROUPS, LEVEL_NAMES, classify, TH, pointAt } = require('./lib');

const INK = '#1c2226', MUTE = '#667078', LINE = '#e1e4df', PANEL = '#ffffff', BG = '#f4f5f2', ACCENT = '#2f6b4f', ROAD = '#cfd4d8';
// 혼잡 단계 색 (HTML 과 같은 계열): 0 정보없음, 1 원활, 2 서행, 3 지체, 4 정체, 5 통제
const LV = ['#b9bfc4', '#2e9e5b', '#e0b21a', '#e8742a', '#c9302c', '#6b2d8a'];
const LVTXT = ['#ffffff', '#ffffff', '#2b2300', '#ffffff', '#ffffff', '#ffffff'];
const FONT = "'Noto Sans CJK KR','Noto Sans KR','Malgun Gothic','Segoe UI',sans-serif";
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rad = x => x * Math.PI / 180;
const W = 1100;

const getD = (e, g, i, key) => (e.rec && e.rec[g.key] && e.rec[g.key][i] ? e.rec[g.key][i][key] || null : null);
const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

// 도로 한 개(g)의 하루 요약: 구간×방향별 평균/최저/정체 횟수 + 시간(0~23)별 평균 속도
function summarizeRoad(g, win) {
  const segs = g.list.map((s, i) => ({
    seg: s, i, dirs: g.dirs.map(dir => {
      const rows = []; // {e, d}
      for (const e of win) { const d = getD(e, g, i, dir.key); if (d) rows.push({ e, d }); }
      const lvOf = r => classify(r.d.cur, r.d.ff, r.d.closed);
      const lvAvg = rows.length ? classify(avg(rows.map(r => r.d.cur)), avg(rows.map(r => r.d.ff)), rows.some(r => r.d.closed) && false) : 0; // 평균 속도 기준 단계
      const min = rows.length ? rows.reduce((a, b) => (b.d.cur < a.d.cur ? b : a)) : null;
      const byH = Array.from({ length: 24 }, (_, h) => {
        const x = rows.filter(r => +r.e.slot.slice(0, 2) === h);
        return x.length ? { cur: avg(x.map(r => r.d.cur)), ff: avg(x.map(r => r.d.ff)), closed: x.some(r => r.d.closed), n: x.length } : null;
      });
      return { dir, n: rows.length, avg: avg(rows.map(r => r.d.cur)), ff: avg(rows.map(r => r.d.ff)), min: min && min.d.cur, minAt: min && min.e.slot, jam: rows.filter(r => lvOf(r) === 4).length, lv: lvAvg, byH };
    }),
  }));
  return segs;
}

/* ---------- 도식도 (HTML renderMap 과 같은 방식: 도로선 + 방향별 두 차로 + 구간 번호) ---------- */
function mapSvg(g, sum, x0, y0, boxW, boxH) {
  const L = g.list, all = L.flatMap(s => s.path);
  const kx = Math.cos(rad(all.reduce((a, p) => a + p[0], 0) / all.length));
  const Pj = p => [p[1] * kx, -p[0]];
  const xs = all.map(p => Pj(p)[0]), ys = all.map(p => Pj(p)[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const padL = 70, padR = 70, padT = 30, padB = 34;
  const sc = Math.min((boxW - padL - padR) / (maxx - minx || 1), (boxH - padT - padB) / (maxy - miny || 1));
  const offx = x0 + padL + ((boxW - padL - padR) - (maxx - minx) * sc) / 2, offy = y0 + padT + ((boxH - padT - padB) - (maxy - miny) * sc) / 2;
  const X = p => offx + (Pj(p)[0] - minx) * sc, Y = p => offy + (Pj(p)[1] - miny) * sc;
  const OFF = 5;
  const lane = (s, side) => {
    const pts = s.path.map(p => [X(p), Y(p)]);
    return pts.map((q, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; return [q[0] + side * OFF * (-dy), q[1] + side * OFF * dx]; });
  };
  let o = '';
  L.forEach(s => { o += `<polyline points="${s.path.map(p => X(p).toFixed(1) + ',' + Y(p).toFixed(1)).join(' ')}" fill="none" stroke="${ROAD}" stroke-width="16" stroke-linecap="butt" stroke-linejoin="round" opacity=".6"/>`; });
  g.dirs.forEach((d, di) => L.forEach((s, i) => {
    const lv = sum[i].dirs[di].n ? sum[i].dirs[di].lv : 0;
    o += `<polyline points="${lane(s, di === 0 ? 1 : -1).map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ')}" fill="none" stroke="${LV[lv]}" stroke-width="6" stroke-linecap="butt" stroke-linejoin="round"/>`;
  }));
  L.forEach((s, i) => {
    const m = pointAt(s.path, 0.5), x = X(m) + 26, y = Y(m);
    o += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10" fill="${PANEL}" stroke="${INK}" stroke-width="1.4"/><text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" fill="${INK}">${i + 1}</text>`;
  });
  const a = L[0].path[0], b = L[L.length - 1].path.slice(-1)[0];
  o += `<circle cx="${X(a).toFixed(1)}" cy="${Y(a).toFixed(1)}" r="4.5" fill="${INK}"/><circle cx="${X(b).toFixed(1)}" cy="${Y(b).toFixed(1)}" r="4.5" fill="${INK}"/>`;
  o += `<text x="${(X(a) - 9).toFixed(1)}" y="${(Y(a) - 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="${INK}" font-weight="600">${esc(g.ends ? g.ends[0] : '시작')}</text>`;
  o += `<text x="${(X(b) + 9).toFixed(1)}" y="${(Y(b) + 14).toFixed(1)}" font-size="10.5" fill="${INK}" font-weight="600">${esc(g.ends ? g.ends[1] : '끝')}</text>`;
  return o;
}

const fmtKm = v => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/* ---------- 한 도로 패널: 도식도(좌) + 구간 카드(우) + 시간대별 표(아래) ---------- */
function roadPanel(g, win, y) {
  const sum = summarizeRoad(g, win), nSeg = g.list.length;
  const mapW = 360, cardX = 12 + mapW + 14, cardW = W - cardX - 12;
  const cardH = 62, cardGap = 8, cardsH = nSeg * (cardH + cardGap) - cardGap;
  const mapH = Math.max(260, cardsH);
  const top = y + 34;
  let o = '';
  // 제목
  o += `<text x="12" y="${y + 20}" font-size="17" font-weight="700" fill="${INK}">${esc(g.road)} · ${esc(g.unit.replace('km', ' km'))} 구간 · ${esc(g.dirs[0].label)}(${esc(g.dirs[0].desc)}) / ${esc(g.dirs[1].label)}(${esc(g.dirs[1].desc)})</text>`;
  // 도식도 박스
  o += `<rect x="12" y="${top}" width="${mapW}" height="${mapH}" rx="10" fill="${PANEL}" stroke="${LINE}"/>`;
  o += mapSvg(g, sum, 12, top, mapW, mapH);
  o += `<text x="${12 + mapW / 2}" y="${top + mapH - 8}" text-anchor="middle" font-size="10" fill="${MUTE}">진행방향 오른쪽 선: ${esc(g.dirs[0].label)} · 왼쪽 선: ${esc(g.dirs[1].label)} (평균 속도 기준 색)</text>`;
  // 구간 카드
  sum.forEach((S, i) => {
    const cy = top + i * (cardH + cardGap);
    o += `<rect x="${cardX}" y="${cy}" width="${cardW}" height="${cardH}" rx="10" fill="${PANEL}" stroke="${LINE}"/>`;
    o += `<rect x="${cardX + 8}" y="${cy + 8}" width="26" height="26" rx="8" fill="${INK}"/><text x="${cardX + 21}" y="${cy + 26}" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">${i + 1}</text>`;
    o += `<text x="${cardX + 42}" y="${cy + 26}" font-size="12.5" font-weight="700" fill="${INK}">${fmtKm(S.seg.from)}–${fmtKm(S.seg.to)} km</text><text x="${cardX + 42}" y="${cy + 42}" font-size="10" fill="${MUTE}">(${fmtKm(+S.seg.len.toFixed(1))} km)</text>`;
    const colW = (cardW - 150) / 2;
    S.dirs.forEach((D, di) => {
      const x = cardX + 150 + di * colW;
      const lv = D.n ? D.lv : 0;
      o += `<rect x="${x}" y="${cy + 6}" width="${colW - 8}" height="${cardH - 12}" rx="8" fill="${LV[lv]}" fill-opacity=".14"/><rect x="${x}" y="${cy + 6}" width="4" height="${cardH - 12}" rx="2" fill="${LV[lv]}"/>`;
      o += `<text x="${x + 12}" y="${cy + 21}" font-size="10.5" fill="${MUTE}">${esc(D.dir.label)}</text>`;
      o += D.n
        ? `<text x="${x + 12}" y="${cy + 41}" font-size="19" font-weight="700" fill="${INK}">${Math.round(D.avg)}<tspan font-size="10" font-weight="400" fill="${MUTE}"> km/h 평균</tspan></text>`
          + `<text x="${x + 12}" y="${cy + 55}" font-size="10" fill="${MUTE}">${LEVEL_NAMES[lv]} · 최저 ${Math.round(D.min)}(${esc(D.minAt)}) · 정체 ${D.jam}회</text>`
        : `<text x="${x + 12}" y="${cy + 44}" font-size="13" fill="${MUTE}">기록 없음</text>`;
    });
  });
  // 시간대별 평균 속도 표 (HTML 의 히트맵과 같은 구성)
  const ty = top + mapH + 16;
  o += `<text x="12" y="${ty + 12}" font-size="13" font-weight="700" fill="${INK}">시간대별 평균 속도 (km/h) · 브라질 현지 시각 0~23시</text>`;
  const labW = 118, cw = (W - 24 - labW) / 24, rh = 22;
  let yy = ty + 20;
  o += `<g font-size="9.5" fill="${MUTE}" text-anchor="middle">${Array.from({ length: 24 }, (_, h) => `<text x="${12 + labW + h * cw + cw / 2}" y="${yy + 9}">${String(h).padStart(2, '0')}</text>`).join('')}</g>`;
  yy += 13;
  g.dirs.forEach((dir, di) => {
    o += `<text x="12" y="${yy + 13}" font-size="11" font-weight="700" fill="${ACCENT}">${esc(dir.label)} · ${esc(dir.desc)}</text>`; yy += 18;
    sum.forEach((S, si) => {
      o += `<text x="12" y="${yy + 15}" font-size="10.5" fill="${INK}" font-weight="600">구간 ${si + 1} <tspan font-weight="400" fill="${MUTE}">${fmtKm(S.seg.from)}–${fmtKm(S.seg.to)}km</tspan></text>`;
      S.dirs[di].byH.forEach((c, h) => {
        const x = 12 + labW + h * cw + 1, w = cw - 2;
        if (!c) { o += `<rect x="${x}" y="${yy}" width="${w}" height="${rh - 3}" rx="3" fill="${LINE}"/>`; return; }
        const lv = classify(c.cur, c.ff, c.closed);
        o += `<rect x="${x}" y="${yy}" width="${w}" height="${rh - 3}" rx="3" fill="${LV[lv]}"/><text x="${x + w / 2}" y="${yy + 14}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${LVTXT[lv]}">${Math.round(c.cur)}</text>`;
      });
      yy += rh;
    });
  });
  const bottom = yy + 6;
  return { svg: o, height: bottom - y };
}

// win: loadWindow() 결과. 도로별로 한 장씩 만든다. 반환: { 'segs': {png,w,h,title}, 'sp330': ..., 'sp308': ... }
function buildDash(win, label, coverage) {
  const out = {};
  for (const g of GROUPS) {
    const body = roadPanel(g, win, 62);
    const H = Math.ceil(62 + body.height + 70);
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}"><rect width="${W}" height="${H}" fill="${BG}"/>`;
    s += `<text x="12" y="24" font-size="19" font-weight="700" fill="${INK}">${esc(g.road)} 일일 요약장표</text>`;
    s += `<text x="12" y="44" font-size="11.5" fill="${MUTE}">${esc(label)} · 브라질 현지 시간(BRT, UTC−3) · 15분 슬롯 ${coverage.have}/${coverage.total}칸 수집(${Math.round(coverage.have / coverage.total * 100)}%) · 값은 그날 수집된 슬롯의 평균/최저</text>`;
    s += body.svg;
    // 범례 + 혼잡 기준
    const ly = H - 38;
    let lx = 12;
    ['정보 없음', '원활', '서행', '지체', '정체', '통제'].forEach((n, i) => { s += `<rect x="${lx}" y="${ly}" width="14" height="8" rx="4" fill="${LV[i]}"/><text x="${lx + 19}" y="${ly + 8}" font-size="10.5" fill="${MUTE}">${n}</text>`; lx += 19 + n.length * 11 + 16; });
    s += `<text x="12" y="${ly + 26}" font-size="10" fill="${MUTE}">혼잡 기준(현재 속도 ÷ 자유 흐름 속도): 원활 ≥ ${TH.smooth}% · 서행 ${TH.slow}~${TH.smooth}% · 지체 ${TH.delay}~${TH.slow}% · 정체 &lt; ${TH.delay}%  |  회색 칸 = 해당 시간에 수집된 값 없음</text>`;
    s += '</svg>';
    const png = new Resvg(s, { font: { loadSystemFonts: true, defaultFontFamily: process.platform === 'win32' ? 'Malgun Gothic' : 'Noto Sans CJK KR' }, fitTo: { mode: 'width', value: W * 2 } }).render().asPng();
    out[g.key] = { png, w: W, h: H, title: `${g.road} 일일 요약장표`, svg: s };
  }
  return out;
}

module.exports = { buildDash, summarizeRoad };
