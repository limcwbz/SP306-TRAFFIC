'use strict';
// 15분마다 GitHub Actions 에서 실행: 현재 15분 슬롯(브라질 시간)의 구간별 교통상황을 수집해 data/ 에 추가한다.
// 환경변수: TOMTOM_API_KEY (필수), SP306_HOME (데이터 폴더, 기본 = 이 폴더)
const { log } = require('./lib');
const { collect } = require('./collect');

(async () => {
  try {
    const r = await collect();
    log('collect 결과: ' + r);
    // 키 없음/한도 초과/전부 실패는 눈에 띄게 실패 처리해 Actions 화면과 알림 메일로 알 수 있게 한다
    if (r === 'no-key') { console.error('TOMTOM_API_KEY 가 설정되지 않았습니다 (저장소 Secrets 확인).'); process.exit(1); }
    if (r === 'failed') { console.error('모든 구간·방향 조회에 실패했습니다.'); process.exit(1); }
  } catch (e) {
    log('수집 오류: ' + e.message);
    process.exit(1);
  }
})();
