# SP306-TRAFFIC

브라질 상파울루주 SP-306 (SP-304 분기점 → SP-308 분기점, 약 19.3 km)의 5 km 구간별·방향별(하행/상행) 교통상황을
**15분 단위**로 수집하고, 매일 **한국 시간 08:00**에 직전 브라질 하루(00:00~23:59)의 엑셀·그래프 보고서를 메일로 보냅니다.
모든 시각은 **브라질 현지 시간(America/Sao_Paulo, UTC−3)** 기준입니다.

| 워크플로 | 주기 | 하는 일 |
|---|---|---|
| `collect` | 15분마다 (UTC 3·18·33·48분) | TomTom 조회 → `data` 브랜치에 커밋 |
| `daily-report` | 매일 KST 08:00 (UTC 23:00) | 엑셀 + 그래프 생성 → Gmail SMTP 로 발송 |

## 브랜치

- `main` : 코드
- `data` : 수집 데이터(`data/날짜.jsonl`), `state.json`(발송 기록), `offsets.json`

## 필요한 Secrets (Settings → Secrets and variables → Actions → Repository secrets)

| 이름 (밑줄 입력이 안 되면 괄호 안 이름) | 값 |
|---|---|
| `TOMTOM_API_KEY` (`TOMTOMAPIKEY`) | TomTom Traffic API 키 |
| `MAIL_TO` (`MAILTO`) | 수신자 이메일 |
| `SMTP_USER` (`SMTPUSER`) | 발신 Gmail 주소 |
| `SMTP_PASS` (`SMTPPASS`) | Gmail **앱 비밀번호** (공백 없이 16자) |

**이 저장소는 공개입니다. 키·비밀번호·메일 주소를 코드나 커밋에 넣지 마세요.** 모두 Secrets 로만 사용합니다.

## 시험 실행

Actions 탭 → `daily-report` → Run workflow
- `dry_run` 체크(기본) : 메일을 보내지 않고 결과 파일을 artifact(`report-output`)로 올립니다.
- 체크 해제 + `mail_to` 에 본인 주소 : 본인에게만 실제 발송해 첨부·그래프를 확인합니다.

## 한계

- GitHub 스케줄은 정시보다 늦거나 드물게 건너뛸 수 있습니다. 건너뛴 15분 슬롯은 TomTom 무료 API가 과거 값을 주지 않아 채울 수 없고, 엑셀에 "기록 없음"으로 표시됩니다.
- TomTom 은 도로 세그먼트(수 km~20 km) 단위로 속도를 제공해, 한산할 때 여러 5 km 구간이 같은 값으로 보일 수 있습니다.
- 집계 기간은 2026-11-17 ~ 2026-12-31 (마지막 보고: 2027-01-02 08:00 KST).

## 통행량(차량 대수) 집계 — `volume` 워크플로

속도(TomTom)와는 별개로, **ARTESP 공개 자료**(SAT 자동 교통량 계수기)에서 SP-308 · SP-330 계측점별 **일 통행량**을 집계합니다.

- 실행: Actions → `volume` → Run workflow (자동으로 매일 UTC 10:30 = 한국 19:30에도 실행)
- 결과: 실행 화면 맨 아래 **Artifacts → traffic-volume** 에서 엑셀(`traffic_volume_자료마지막일자.xlsx`)을 내려받습니다. 요약 CSV는 `data` 브랜치 `volume/summary_latest.csv`에도 남습니다.
- 대상 도로·km 범위·이상치 기준은 `volume_config.json` 에서 바꿉니다.
- **한계**: SP-306 은 이 자료에 없습니다. 계측점은 약 12~15 km 간격이라 우리 구간(2 km 단위)을 나눌 수 없고, 값은 "계측점 한 곳을 하루에 지나간 대수"입니다. 공개 자료는 며칠 늦게 올라옵니다.
