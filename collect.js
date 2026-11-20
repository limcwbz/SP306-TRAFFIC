'use strict';
// SP-306 구간 3개(5·5·약 9.3 km) + SP-330 2 km 구간 2개 + SP-308 2 km 구간 4개를 각각 양방향으로 TomTom Traffic Flow 로 조회해 15분 슬롯 단위로 저장
// 모든 시각은 브라질 현지 시간(America/Sao_Paulo) 기준
const fs = require('fs');
const path = require('path');
const { cfg, GROUPS, HOME, bearing, offsetPoint, brt, slotOf, dataFile, readDay, log } = require('./lib');

class FatalError extends Error {}
const OFFSETS = [10, 6, 14, 4]; // 도로 중심선에서 차로 쪽으로 벗어나는 거리(m) — 25m 이상은 다른 도로로 붙는 경우가 있음
const CACHE_FILE = path.join(HOME, 'offsets.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readCache = () => { try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) { return {}; } };

async function fetchPoint(lat, lon, key) {
  const url = 'https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?unit=KMPH&point='
    + lat.toFixed(6) + ',' + lon.toFixed(6) + '&key=' + encodeURIComponent(key);
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (res.status === 401 || res.status === 403) throw new FatalError('API 키 거부 (' + res.status + ')');
  if (res.status === 429) throw new FatalError('요청 한도 초과 (429)');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return (await res.json()).flowSegmentData;
}

// 응답 세그먼트가 (1) 조회 지점 근처이고 (2) 기대한 진행 방향과 같은지 확인
function dirOk(coords, p, travelBrg) {
  const c = coords.map(x => [x.latitude, x.longitude]);
  if (c.length < 2) return false;
  // 조회 지점에서 가장 가까운 "선분"(꼭짓점이 아님 — 직선 구간은 꼭짓점이 듬성듬성함)을 찾고 그 선분의 진행 방위로 방향 판정
  const kx = Math.cos(p[0] * Math.PI / 180);
  let j = 0, best = Infinity;
  for (let n = 0; n < c.length - 1; n++) {
    const ax = (c[n][1] - p[1]) * kx, ay = c[n][0] - p[0], bx = (c[n + 1][1] - p[1]) * kx, by = c[n + 1][0] - p[0];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const d2 = (ax + t * dx) ** 2 + (ay + t * dy) ** 2;
    if (d2 < best) { best = d2; j = n; }
  }
  if (Math.sqrt(best) * 111320 > 40) return false;
  const a = c[j], b = c[j + 1];
  if (a[0] === b[0] && a[1] === b[1]) return false;
  const diff = Math.abs(((bearing(a, b) - travelBrg + 540) % 360) - 180);
  return diff < 60;
}

async function fetchDirection(sample, dir, key, ck, cache, perDir) {
  const order = cache[ck] ? [cache[ck], ...OFFSETS.filter(o => o !== cache[ck])] : OFFSETS;
  const base = perDir ? sample[dir.key] : sample; // SP-330: 방향별 {p, brg} (brg 는 이미 진행방향)
  const travel = perDir ? base.brg : (sample.brg + (dir.reverse ? 180 : 0)) % 360;
  for (const off of order) {
    const p = offsetPoint(base.p, perDir ? base.brg + 90 : sample.brg + dir.side, off);
    const f = await fetchPoint(p[0], p[1], key);
    await sleep(250);
    if (dirOk(f.coordinates.coordinate, p, travel)) { cache[ck] = off; return { f, off }; }
  }
  return null;
}

function summarize(f, off) {
  const r1 = v => Math.round(v * 10) / 10;
  return {
    cur: r1(f.currentSpeed), ff: r1(f.freeFlowSpeed), conf: Math.round(f.confidence * 100) / 100,
    closed: f.roadClosure ? 1 : 0, delay: Math.round(Math.max(0, f.currentTravelTime - f.freeFlowTravelTime)), off,
  };
}

async function collectGroup(g, key, cache) {
  const out = [];
  for (const [i, s] of g.list.entries()) {
    const rec = {};
    for (const dir of g.dirs) {
      try {
        const r = await fetchDirection(s.sample, dir, key, `${g.key}:${i}:${dir.key}`, cache, g.perDirSample);
        rec[dir.key] = r ? summarize(r.f, r.off) : null;
        if (!r) log(`${g.label(i)} ${dir.label}: 방향 검증 실패 (기록 안 함)`);
      } catch (e) {
        if (e instanceof FatalError) throw e;
        log(`${g.label(i)} ${dir.label} 조회 실패: ${e.message}`);
        rec[dir.key] = null;
      }
    }
    out.push(rec);
  }
  return out;
}

async function collect(now) {
  const b = brt(now);
  now = now || new Date();
  if (b.date < cfg.startDate || b.date > cfg.endDate) return 'out-of-range';
  if (!cfg.apiKey) { log('수집 건너뜀: config.json 에 apiKey 가 없습니다.'); return 'no-key'; }
  const slot = slotOf(b);
  if (readDay(b.date).has(slot)) return 'exists';

  const cache = readCache();
  const rec = { slot, at: now.toISOString() };
  for (const g of GROUPS) rec[g.key] = await collectGroup(g, cfg.apiKey, cache);
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch (e) {}
  const empty = GROUPS.every(g => rec[g.key].every(x => !x.down && !x.up));
  if (empty) { log('모든 구간·방향 조회 실패, 슬롯 ' + slot + ' 기록 안 함'); return 'failed'; }
  fs.appendFileSync(dataFile(b.date), JSON.stringify(rec) + '\n');
  const f = x => (x ? Math.round(x.cur) : '-');
  log(`수집 완료 ${b.date} ${slot} (BRT) 정방향/역방향 km/h — ` + GROUPS.map(g => g.road + ': ' + rec[g.key].map(x => f(x.down) + '/' + f(x.up)).join(' ')).join(' | '));
  return 'ok';
}

module.exports = { collect };
