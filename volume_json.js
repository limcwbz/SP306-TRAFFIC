'use strict';
// ARTESP 통행량(volume_core 의 view)을 JSON 으로 저장한다. HTML 빌드(build_html.js)가 이 JSON 을 문서 안에 넣는다.
//   사용: node volume_json.js [출력경로]    환경변수: VOLUME_CSV (이미 받은 CSV 경로, 없으면 ARTESP 에서 내려받음)
const fs = require('fs');
const path = require('path');
const V = require('./volume_core');

(async () => {
  const { view, meta } = await V.load();
  const out = process.argv[2] || path.join(__dirname, 'out', 'volume_view.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // HTML 용으로 필요한 값만 (연 평균 등 계산값 포함)
  const slim = { first: view.first, last: view.last, partialDay: view.partialDay, dates: view.dates, margin: view.margin, generatedAt: view.generatedAt,
    roads: view.roads.map(r => ({ id: r.id, display: r.display, noData: !!r.noData, note: r.note || null, ourKm: r.ourKm || null, basis: r.basis || null,
      rows: r.rows.map(x => ({ zone: x.zone, edge: x.edge, segNo: x.segNo, dist: x.dist, conc: x.conc, kmL: x.kmL, satDir: x.satDir, dirLabel: x.dirLabel,
        vals: x.vals, avg7: x.avg7 == null ? null : Math.round(x.avg7), avgAll: x.avgAll == null ? null : Math.round(x.avgAll), trust: x.trust })) })) };
  fs.writeFileSync(out, JSON.stringify(slim));
  V.log(`통행량 보기 저장: ${out} (자료 마지막 일자 ${view.last}, 도로 ${slim.roads.length}개, 지점 ${slim.roads.reduce((s, r) => s + r.rows.length, 0)}행)`);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
