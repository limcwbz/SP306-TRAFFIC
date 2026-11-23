'use strict';
// 매일 한국 08:00 무렵 GitHub Actions 에서 실행: 발송 시각이 지났고 아직 안 보낸 일일 보고를 엑셀+그래프+메일로 처리한다.
// 보고 대상 = 집계 마감(발송 − 60분)까지 이미 끝난 가장 최근의 브라질 하루(00:00~23:59). 예) 한국 11-19 08:00 → 브라질 11-17
// 환경변수: SP306_HOME(데이터/상태 폴더), MAIL_TO, SMTP_USER, SMTP_PASS (SP306_DRYRUN=1 이면 발송 안 함)
const path = require('path');
const fs = require('fs');
const { cfg, DIRS, brt, pad, readState, writeState, log, allReports, loadWindow, fmtWin, LEAD_MIN, SEGMENT_NOTE } = require('./lib');
const { buildExcel } = require('./build_excel');
const { buildCharts } = require('./chart');
const { buildDash } = require('./dash');
const { buildHtmlReport } = require('./html_report');
const { sendReport } = require('./mailer');
const V = require('./volume_core');

const nowMs = () => (process.env.SP306_FAKE_NOW ? Date.parse(process.env.SP306_FAKE_NOW) : Date.now());
const hm = ms => { const b = brt(new Date(ms)); return `${b.date} ${pad(b.hh)}:${pad(b.mm)}`; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function bodies(w, info, charts, vol, dash) {
  const label = fmtWin(w);
  const head = [
    ['집계 기간', `${label}  (브라질 현지 시간, 15분 단위, ${info.total}슬롯)`],
    ['집계 마감', `브라질 ${hm(w.cutoff).slice(11)} (${hm(w.cutoff).slice(0, 10)}) — 메일 발송 ${LEAD_MIN}분 전`],
    ['시간 기준', '브라질 현지 시간 (상파울루주, America/Sao_Paulo, UTC−3)'],
    ['방향', 'SP-306: 하행 = SP-304 → SP-308 방면 / 상행 = 반대 · SP-330: 남행 = 남쪽 방면 / 북행 = 북쪽 방면 · SP-308: 남동행 = 시작(23.018°S) → 끝(23.076°S) 방면 / 북서행 = 반대'],
    ['수집 슬롯', `${info.slotCount} / ${info.total}  (수집이 실행되지 않은 시간대는 기록 없음)`],
  ];
  const fmtRow = s => [s.label, s.dir, `${s.from.toFixed(1)}–${s.to.toFixed(1)} km`, s.avg == null ? '기록 없음' : s.avg.toFixed(1), s.min == null ? '-' : `${s.min} (${s.minAt})`, s.jam, `${s.n}/${info.total}`];
  const sections = [
    ['SP-306 · 구간 1·2는 5 km, 구간 3은 10 km급(5 km 3·4번 합침, 실제 9.3 km) (SP-304 분기점 → SP-308 분기점)', info.summary.filter(s => s.road === 'SP-306'), 'SP306'],
    ['SP-330 · 2 km 구간 (SP-133 교차점에서 남쪽으로 4 km)', info.summary.filter(s => s.road === 'SP-330'), 'SP330'],
    ['SP-308 · 2 km 구간 (23.018°S 47.437°W → 23.076°S 47.403°W, 약 7.4 km)', info.summary.filter(s => s.road === 'SP-308'), 'SP308'],
  ];

  const txt = [`SP-306 · SP-330 · SP-308 구간별·방향별 교통상황 일일 보고`, ``, ...head.map(([k, v]) => `${k}: ${v}`), ``,
    ...sections.flatMap(([t, rows, vid]) => [`[${t}]`, ...rows.map(s => `  ${s.label} ${s.dir} (${s.from.toFixed(1)}–${s.to.toFixed(1)} km): ` + (s.avg == null ? '기록 없음' : `평균 ${s.avg.toFixed(1)} km/h, 최저 ${s.min} km/h (${s.minAt}), 정체 ${s.jam}회, 수집 ${s.n}/${info.total}`)), ``, ...V.textBlock(vol, vid)]),
    `도로별 요약장표(그림)는 본문 맨 위와 엑셀 「요약장표」 시트에 있고, 첨부 HTML 에는 같은 날의 수집 기록이 모두 들어 있으며, 속도 추이 그래프는 엑셀 각 시트 표 하단에 있습니다.`, ``, SEGMENT_NOTE.title, ...SEGMENT_NOTE.lines, ``, `* 데이터 출처: TomTom Traffic Flow. 자동 발송 메일입니다.`].join('\r\n');

  const th = 'style="background:#2f6b4f;color:#fff;padding:5px 8px;text-align:center;font-size:12px;border:1px solid #d0d4d8"';
  const td = 'style="padding:4px 8px;text-align:center;font-size:12px;border:1px solid #d0d4d8"';
  const keys = Object.keys(charts);
  const dashKeys = dash ? Object.keys(dash) : [];
  const imgs = keys.map((k, i) => `<p style="margin:16px 0 4px"><b>${esc(charts[k].title)}</b></p><img src="cid:chart${i}" width="760" alt="${esc(charts[k].title)}" style="max-width:100%;border:1px solid #e1e0d9">`).join('\n');
  const html = `<div style="font-family:'Malgun Gothic',sans-serif;font-size:13px;color:#0b0b0b">
<p style="font-size:15px"><b>SP-306 · SP-330 · SP-308 구간별·방향별 교통상황 일일 보고</b></p>
${dashKeys.map((k, i) => `<p style="margin:10px 0 3px"><b>${esc(dash[k].title)}</b></p><img src="cid:dash${i}" width="860" alt="${esc(dash[k].title)}" style="max-width:100%;border:1px solid #e1e0d9">`).join('\n')}
<table style="border-collapse:collapse">${head.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#52514e;white-space:nowrap">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
${sections.map(([t, rows, vid]) => `<p style="margin:14px 0 4px"><b>${esc(t)}</b></p>
<table style="border-collapse:collapse;font-family:'Malgun Gothic',sans-serif"><tr>${['구간', '방향', '범위', '평균 km/h', '최저 km/h (시각)', '정체 횟수', '수집'].map(h => `<th ${th}>${h}</th>`).join('')}</tr>
${rows.map(s => `<tr>${fmtRow(s).map(v => `<td ${td}>${esc(v)}</td>`).join('')}</tr>`).join('\n')}</table>
${V.htmlBlock(vol, vid, esc)}`).join('\n')}
<p style="margin:18px 0 0;font-size:14px"><b>▼ 구간별 속도 추이 (브라질 현지 시간 ${esc(w.day)} 00:00–23:59)</b></p>
${imgs}
<div style="margin-top:18px;padding-top:10px;border-top:1px solid #e1e0d9"><p style="margin:0 0 4px"><b>${esc(SEGMENT_NOTE.title)}</b></p>${SEGMENT_NOTE.lines.map(l => `<p style="margin:2px 0;font-size:12.5px">${esc(l)}</p>`).join('')}</div>
<p style="color:#898781;font-size:11px;margin-top:16px">상세 데이터와 15분 단위 표는 첨부된 엑셀 파일에, 화면 형태의 보고서는 첨부된 HTML 파일(더블클릭으로 열림, 인터넷 불필요)에 있습니다. 데이터 출처: 속도 = TomTom Traffic Flow, 일일 통행량 = ARTESP 공개 자료(SAT). 자동 발송 메일입니다.</p></div>`;
  return { txt, html, keys, dashKeys };
}

async function reportOne(w, state) {
  const win = loadWindow(w), label = fmtWin(w);
  if (!win.some(e => e.rec)) { log(`보고 ${w.K}: 브라질 ${w.day} 수집된 데이터가 없어 생략`); state.skipped[w.K] = new Date().toISOString(); return; }
  const xlsx = path.join(DIRS.out, `SP306_traffic_BRT_${w.day}.xlsx`);
  let vol = null;
  try { vol = (await V.load()).view; } catch (e) { log(`보고 ${w.K}: ARTESP 통행량을 불러오지 못해 통행량 표를 뺍니다 — ${e.message}`); }
  const charts = buildCharts(win);
  const got = win.filter(e => e.rec).length;
  const dash = buildDash(win, label, { have: got, total: win.length });
  const info = await buildExcel(win, label, xlsx, charts, vol, dash);
  log(`보고 ${w.K}: 엑셀 생성 — 브라질 ${w.day} (${info.slotCount}/${info.total} 슬롯, 그래프 ${Object.keys(charts).length}종)`);
  // 독립형 HTML 보고서 (그날의 GitHub 수집 기록을 문서 안에 포함) — 엑셀과 함께 첨부
  const htmlFile = path.join(DIRS.out, `SP306_traffic_BRT_${w.day}.html`);
  fs.writeFileSync(htmlFile, buildHtmlReport(win, w, label, vol, info), 'utf8');
  log(`보고 ${w.K}: HTML 보고서 생성 — ${path.basename(htmlFile)} (${(fs.statSync(htmlFile).size / 1024).toFixed(0)} KB)`);
  const { txt, html, keys, dashKeys } = bodies(w, info, charts, vol, dash);
  const inline = keys.map((k, i) => { const p = path.join(DIRS.out, `chart_${w.day}_${k.replace(':', '_')}.png`); fs.writeFileSync(p, charts[k].png); return { path: p, cid: `chart${i}` }; })
    .concat(dashKeys.map((k, i) => { const p = path.join(DIRS.out, `dash_${w.day}_${k}.png`); fs.writeFileSync(p, dash[k].png); return { path: p, cid: `dash${i}` }; }));
  const res = await sendReport({ to: cfg.recipient, subject: `[SP-306·SP-330·SP-308 교통상황] 브라질 ${w.day} 00:00~23:59 집계 (현지 시간)`, text: txt, html, attachPath: xlsx, extraAttach: [htmlFile], inline, outDir: DIRS.out });
  log(`보고 ${w.K}: 메일 ${res.split(' ')[0]} → ${process.env.SP306_DRYRUN ? '(시험: 발송 안 함)' : '수신자'}`);
  if (!process.env.SP306_DRYRUN) state.sent[w.K] = new Date().toISOString();
}

(async () => {
  const state = readState(); state.sent = state.sent || {}; state.skipped = state.skipped || {};
  // GitHub 스케줄은 정시보다 늦게 시작될 수 있어 일찍 시작해 발송 시각까지 대기한다 (이미 지났으면 즉시 진행). 최대 대기 25분.
  const due = allReports().filter(w => !state.sent[w.K] && !state.skipped[w.K]);
  const next = due.find(w => nowMs() < w.send);
  if (next && next.send - nowMs() <= 25 * 60000 && !process.env.SP306_NOWAIT) { log(`발송 시각까지 ${Math.ceil((next.send - nowMs()) / 1000)}초 대기`); await sleep(next.send - nowMs()); }
  let failed = 0;
  for (const w of due) {
    if (nowMs() < w.send) continue;
    try { await reportOne(w, state); } catch (e) { failed++; log(`보고 ${w.K}: 실패 — 다음 실행에서 재시도: ${e.message}`); }
  }
  writeState(state);
  if (failed) process.exit(1);
})();
