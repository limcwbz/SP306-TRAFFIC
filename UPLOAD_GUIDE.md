# GitHub 업로드 안내 (최종판) — 저장소: limcwbz/SP306-TRAFFIC (공개)

> 이 파일은 안내용입니다. 올려도 되고 안 올려도 됩니다.
> 이 패키지(`sp306-github-upload-final3.zip`)는 **v6 위에 덮어쓰는 것을 기준**으로 만들었습니다(처음 올리는 경우도 같은 방법). 파일 이름이 같으면 덮어써지고, 새 파일은 추가됩니다.

---------------------------------------------------------------------

## 1. 올리기 (웹 화면, 설치 불필요)

1. **압축 풀기**: `sp306-github-upload-final3.zip` 을 풀면 `SP306-TRAFFIC-upload` 폴더가 생깁니다. **폴더 안의 내용물**을 올립니다(폴더 자체를 올리면 안 됩니다).
2. **숨김 파일 표시**: 탐색기 → 보기 → 표시 → **숨긴 항목**. `.github` 폴더(워크플로 파일이 있음)가 보여야 합니다. 빠지면 아무것도 실행되지 않습니다.
3. https://github.com/limcwbz/SP306-TRAFFIC 에 `limcwbz` 로 로그인
4. **Add file → Upload files** → 폴더 안의 항목을 전부 끌어다 놓기 (`.github`, `scripts`, `seed`, `.js`/`.json`/`.md` 파일, `.gitignore`)
5. 아래에서 **Commit directly to the main branch** 선택 → **Commit changes**
6. 저장소 화면에서 `.github` → `workflows` 안에 **네 파일**이 보이는지 확인: `collect.yml`, `daily-report.yml`, `speed-export.yml`, `volume.yml`

> 이미 올리신 경우: 파일을 한꺼번에 다시 올려도 됩니다(같은 이름은 덮어쓰기). 변경이 있었던 파일은 아래 "이번에 바뀐 파일"에 정리했습니다.
> 업로드 방식이 번거로우면 일부 파일만 올려도 되지만, 어떤 파일이 서로 의존하는지(예: `build_excel.js` 는 `dash.js` 와 `volume_core.js` 를 씁니다) 놓치기 쉬우므로 **전체를 올리는 것을 권장**합니다.

---------------------------------------------------------------------

## 2. 설정 (처음 한 번)

**권한**: Settings → Actions → General → Workflow permissions → **Read and write permissions** → Save
(데이터를 `data` 브랜치에 저장하는 데 필요)

**Secrets**: Settings → Secrets and variables → Actions → **New repository secret** — 칸이 두 개(Name / Secret)입니다. 4번 반복:

| Name | 밑줄이 입력되지 않을 때 이름 | Secret 칸에 넣을 값 (값만) |
|---|---|---|
| `TOMTOM_API_KEY` | `TOMTOMAPIKEY` | TomTom 키 |
| `MAIL_TO` | `MAILTO` | 수신 이메일 |
| `SMTP_USER` | `SMTPUSER` | 발신 Gmail 주소 |
| `SMTP_PASS` | `SMTPPASS` | Gmail 앱 비밀번호 16자 (공백 제거) |

- 4개 모두 **한 가지 방식으로 통일**하세요. 따옴표·쉼표·이름을 Secret 칸에 같이 넣으면 안 됩니다.
- 이미 등록하셨다면 다시 하지 않아도 됩니다. `speed-export`, `volume` 은 Secrets 가 필요 없습니다.
- **TomTom 키를 대화나 메일에 붙여넣은 적이 있다면 TomTom 개발자 포털에서 새로 발급**해 새 키만 등록하세요. 공개 저장소이므로 더 중요합니다.

---------------------------------------------------------------------

## 3. 첫 실행과 확인

1. **Actions** 탭 → 안내가 나오면 **I understand my workflows, go ahead and enable them**
2. 왼쪽 **collect** → Run workflow → 1~2분 뒤 초록 체크. 저장소 브랜치 목록에 **data** 가 생겼는지 확인 (처음 한 번만 자동 생성)
3. **daily-report** → Run workflow (기본 `dry_run` 체크) → 끝나면 화면 맨 아래 **Artifacts → report-output** 에서 엑셀을 받아 「요약장표」 시트와 한글이 깨지지 않았는지 확인. 같은 폴더의 **`SP306_traffic_BRT_날짜.html`** 도 더블클릭해 열어, 그래프·표가 보이고 한글이 깨지지 않았는지 확인
4. 같은 곳에서 `dry_run` **체크 해제** + `mail_to` 에 본인 주소 → 본인에게 실제 발송되어 첨부·그래프가 오는지 확인
5. **speed-export** → Run workflow → Artifacts → **traffic-speed** 에서 TomTom 15분 속도 엑셀 확인
6. **volume** → Run workflow → Artifacts → **traffic-volume** 에서 통행량 엑셀 확인

---------------------------------------------------------------------

## 4. v6 대비 바뀐 파일 (실제 비교 결과)

| 구분 | 파일 |
|---|---|
| **추가 (6)** | `html_report.js` (메일에 첨부되는 독립형 HTML 보고서 — 그날 GitHub 수집 기록 포함) |
| | `speed_export.js`, `.github/workflows/speed-export.yml` (TomTom 15분 속도를 엑셀로 내보내기) |
| | `dash.js` (일일 요약장표), `volume_core.js`, `volume_json.js` (통행량 공통 모듈) |
| **변경 (8)** | `build_excel.js` (요약장표·통행량 시트), `report_run.js` (HTML 생성·첨부), `mailer.js` (첨부 파일 추가 지원), `volume.js`, `volume_config.json`, `package-lock.json`, `README.md`, `UPLOAD_GUIDE.md` |
| **동일 (19)** | 워크플로 `collect.yml`, `daily-report.yml`, `volume.yml`, `lib.js`, `collect.js`, `collect_run.js`, `chart.js`, `segments.json`, `sp330.json`, `sp308.json`, `thresholds.json`, `seed/`, `scripts/` 등 — 다시 올려도 무방 |

- 속도 수집 간격(`collect.yml`)은 **변경하지 않았습니다**(15분 cron 그대로).
- `data` 브랜치와 Secrets 는 그대로 쓰며 새로 만들 필요가 없습니다.
- **`.github/workflows/` 에 `speed-export.yml` 이 새로 생깁니다.** 올린 뒤 Actions 탭에 `speed-export` 가 보이는지 확인하세요.

---------------------------------------------------------------------

## 5. 문제가 생기면

| 증상 | 확인 |
|---|---|
| Actions 에 워크플로가 안 보임 | `.github/workflows/` 4개 파일이 main 에 올라갔는지, Actions 가 enable 되었는지 |
| collect 실패: `TOMTOM_API_KEY 가 설정되지 않았습니다` | Secret 이름 철자(`TOMTOM`), 4개 방식 통일, 값에 따옴표 없는지 |
| collect 실패: push 권한 오류 | Workflow permissions 가 Read and write 인지 |
| `speed-export` 실패: `수집 기록이 없습니다` | `collect` 를 한 번이라도 실행했는지, `data` 브랜치에 `data/날짜.jsonl` 이 있는지 |
| 그래프 글자가 네모(□)로 보임 | `daily-report` 로그의 "Install Korean font" 단계 성공 여부 |
| 메일 `Invalid login` / `535` | `SMTP_PASS` 가 앱 비밀번호(16자)인지, 2단계 인증이 켜져 있는지 |
| 메일이 안 옴 | 스팸함 확인. 사내 메일이 외부 Gmail 발신을 막을 수 있음 |
| 수집이 시간당 1~2건뿐 | **GitHub 스케줄 한계**입니다(README 「알려진 한계」). 코드 오류가 아닙니다 |

오류 화면의 **문구만** 알려주세요 (키·비밀번호는 가리고).
