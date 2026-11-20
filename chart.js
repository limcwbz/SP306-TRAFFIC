'use strict';
// 구간별 속도 추이 꺾은선 그래프 (SVG → PNG). 엑셀·메일 본문에 같은 이미지를 사용한다.
// 색은 dataviz 기본 팔레트의 앞쪽 슬롯 순서(고정, 순환 없음) — validate_palette.js 로 4색·5색 모두 통과 확인
const { Resvg } = require('@resvg/resvg-js');
const { GROUPS } = require('./lib');

const INK = '#0b0b0b', INK2 = '#52514e', MUTED = '#898781', GRID = '#e1e0d9', AXIS = '#c3c2b7', SURFACE = '#fcfcfb';
const CAT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
const FONT = "'Malgun Gothic','Segoe UI',sans-serif";
const W = 960, H = 380;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const textW = (s, px) => [...String(s)].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e80 ? px : px * 0.56), 0);
const km = v => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const slotLabel = i => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`;

function speedChart({ title, subtitle, note, series, slots = 96 }) {
  const L = 56, R = 24, T = 96, B = 56, pw = W - L - R, ph = H - T - B;
  const vals = series.flatMap(s => s.values).filter(v => v != null);
  const yMax = Math.max(100, Math.ceil(Math.max(0, ...vals) / 20) * 20);
  const X = i => L + (i / slots) * pw, Y = v => T + ph * (1 - v / yMax);
  let g = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`;
  g += `<rect width="${W}" height="${H}" fill="${SURFACE}"/>`;
  g += `<text x="${L}" y="26" font-size="17" font-weight="700" fill="${INK}">${esc(title)}</text>`;
  g += `<text x="${L}" y="47" font-size="12" fill="${INK2}">${esc(subtitle)}</text>`;
  // 범례 (2개 이상 시리즈면 항상 표시) — 글자는 텍스트 색, 구분은 선 모양 견본이 담당
  let lx = L;
  series.forEach((s, k) => {
    g += `<line x1="${lx}" x2="${lx + 16}" y1="70" y2="70" stroke="${CAT[k]}" stroke-width="2" stroke-linecap="round"/>`;
    g += `<text x="${lx + 22}" y="74" font-size="12" fill="${INK2}">${esc(s.name)}</text>`;
    lx += 22 + textW(s.name, 12) + 22;
  });
  // 격자(실선 헤어라인)와 y축
  g += `<text x="${L}" y="${T - 8}" font-size="11" fill="${MUTED}">km/h</text>`;
  for (let v = 0; v <= yMax; v += 20) {
    g += `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="${v === 0 ? AXIS : GRID}" stroke-width="1"/>`;
    g += `<text x="${L - 8}" y="${(Y(v) + 4).toFixed(1)}" font-size="11" fill="${MUTED}" text-anchor="end">${v}</text>`;
  }
  for (let h = 0; h <= 24; h += 3) {
    const x = X(h * 4);
    g += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${T + ph}" y2="${T + ph + 4}" stroke="${AXIS}" stroke-width="1"/>`;
    g += `<text x="${x.toFixed(1)}" y="${T + ph + 18}" font-size="11" fill="${MUTED}" text-anchor="middle">${String(h).padStart(2, '0')}:00</text>`;
  }
  g += `<text x="${(L + pw / 2).toFixed(1)}" y="${T + ph + 36}" font-size="11.5" fill="${INK2}" text-anchor="middle">브라질 현지 시각 (BRT, UTC−3)</text>`;
  if (note) g += `<text x="${L}" y="${T + ph + 51}" font-size="11" fill="${MUTED}">${esc(note)}</text>`;

  if (!vals.length) {
    g += `<text x="${(L + pw / 2).toFixed(1)}" y="${(T + ph / 2).toFixed(1)}" font-size="14" fill="${MUTED}" text-anchor="middle">수집된 데이터가 없습니다</text></svg>`;
    return g;
  }
  // 선: 연속 구간만 잇고, 수집이 빠진 슬롯은 이어 붙이지 않는다 (보간 금지). 첫 시리즈가 맨 위에 보이도록 뒤에서부터 그린다
  for (let k = series.length - 1; k >= 0; k--) {
    const v = series[k].values, col = CAT[k];
    let run = [];
    const flush = () => {
      if (run.length >= 2) g += `<polyline points="${run.map(([i, y]) => `${X(i + 0.5).toFixed(1)},${Y(y).toFixed(1)}`).join(' ')}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
      else if (run.length === 1) g += `<circle cx="${X(run[0][0] + 0.5).toFixed(1)}" cy="${Y(run[0][1]).toFixed(1)}" r="4" fill="${col}" stroke="${SURFACE}" stroke-width="2"/>`;
      run = [];
    };
    v.forEach((y, i) => { if (y == null) flush(); else run.push([i, y]); });
    flush();
  }
  // 전체 최저 속도 한 곳만 직접 표기
  let m = null;
  series.forEach((s, k) => s.values.forEach((y, i) => { if (y != null && (!m || y < m.y)) m = { y, i, k }; }));
  // 최저점은 모든 선의 아래쪽 끝이므로 라벨을 점 아래에 두면 다른 선과 겹치지 않는다 (x축에 닿을 만큼 낮으면 위로)
  const mx = X(m.i + 0.5), my = Y(m.y), below = my + 24 < T + ph - 2;
  const lab = `최저 ${Math.round(m.y)} km/h · ${slotLabel(m.i)}`, tw = textW(lab, 12);
  const tx = Math.max(L + tw / 2, Math.min(W - R - tw / 2, mx));
  g += `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="4.5" fill="${CAT[m.k]}" stroke="${SURFACE}" stroke-width="2"/>`;
  g += `<text x="${tx.toFixed(1)}" y="${(below ? my + 22 : my - 12).toFixed(1)}" font-size="12" font-weight="600" fill="${INK}" text-anchor="middle" stroke="${SURFACE}" stroke-width="3" paint-order="stroke">${esc(lab)}</text>`;
  return g + '</svg>';
}

function toPng(svg) {
  return new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'Malgun Gothic' }, fitTo: { mode: 'width', value: W * 2 } }).render().asPng();
}

// win: loadWindow() 결과(96슬롯). 반환: { 'segs:down', 'segs:up', 'sp330:down', 'sp330:up', 'sp308:down', 'sp308:up' }
function buildCharts(win) {
  const out = {}, day = win[0].date, got = win.filter(e => e.rec).length;
  for (const g of GROUPS) for (const dir of g.dirs) {
    const series = g.list.map((s, i) => ({
      name: `${g.label(i)} (${km(s.from)}–${km(s.to)} km)`,
      values: win.map(e => { const d = e.rec && e.rec[g.key] && e.rec[g.key][i] && e.rec[g.key][i][dir.key]; return d ? d.cur : null; }),
    }));
    const title = `${g.road} ${g.unit.replace("km", " km")} 구간 · ${dir.label}(${dir.desc}) 속도 추이`;
    const svg = speedChart({
      title, series,
      subtitle: `${day} 00:00–23:59 · 브라질 현지 시간(BRT) · 15분 단위 · 수집 ${got}/${win.length} 슬롯`,
      note: '수집이 빠진 시간은 선이 끊깁니다. 값이 같은 구간은 선이 겹쳐 보입니다(첫 구간 색이 위).',
    });
    out[`${g.key}:${dir.key}`] = { png: toPng(svg), w: W, h: H, title, svg };
  }
  return out;
}

module.exports = { speedChart, toPng, buildCharts };
