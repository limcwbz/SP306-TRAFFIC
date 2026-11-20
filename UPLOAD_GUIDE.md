# GitHub 업로드 안내 (저장소: limcwbz/SP306-TRAFFIC, 공개)

> 이 파일은 안내용입니다. 올려도 되고 안 올려도 됩니다.

두 가지 방법이 있습니다. **방법 A(웹 화면, 설치 없음)** 를 권합니다. `data` 브랜치는 직접 만들 필요가 없습니다 —
처음 실행할 때 서버가 `seed/` 폴더 내용으로 자동 생성합니다.

---------------------------------------------------------------------

## 방법 A. 웹 화면에서 올리기 (설치 불필요)

### 1) 압축 풀기
`sp306-github-upload.zip` 을 풀면 `SP306-TRAFFIC-upload` 폴더가 생깁니다. 이 폴더 **안쪽 내용**을 올립니다.
**폴더 이름까지 올리면 안 됩니다** (저장소 맨 위에 `.github`, `lib.js` 등이 바로 보여야 합니다).

### 2) 숨김 폴더 `.github` 먼저 확인
`.github` 폴더는 이름이 점으로 시작해서 숨김일 수 있습니다. 탐색기 → 보기 → 표시 → **숨긴 항목** 체크.
(워크플로 파일이 이 안에 있어서 빠지면 아무것도 실행되지 않습니다.)

### 3) 업로드
1. https://github.com/limcwbz/SP306-TRAFFIC 접속 (로그인)
2. **Add file → Upload files**
3. 폴더 안의 파일·폴더를 **전부 선택**해서 끌어다 놓습니다. (폴더째 끌어다 놓아도 하위 구조가 유지됩니다)
   - 올라가야 하는 것: `.github`, `scripts`, `seed`, `build_excel.js`, `chart.js`, `collect.js`, `collect_run.js`, `lib.js`, `mailer.js`, `report_run.js`, `package.json`, `package-lock.json`, `segments.json`, `README.md`, `.gitignore`, `UPLOAD_GUIDE.md`
   - **올리면 안 되는 것: `node_modules`, `config.json`** (이 압축에는 원래 없습니다)
4. 아래 **Commit changes** → 브랜치는 **main(Commit directly to the main branch)** → 버튼 클릭

> 웹 업로드는 한 번에 파일 수가 많으면 실패할 수 있습니다(대략 100개 제한). 이 패키지는 약 20개라 괜찮습니다.
> `.github/workflows/*.yml` 이 올라갔는지 저장소 화면에서 `.github` → `workflows` 를 눌러 두 파일이 보이는지 확인하세요.

### 4) Settings 확인
- **Settings → Actions → General → Workflow permissions** → **Read and write permissions** 선택 → Save
- **Settings → Branches** 의 기본 브랜치가 `main` 인지 확인

### 5) Secrets 등록
저장소 → Settings → Secrets and variables → **Actions** → **New repository secret** (4번 반복, 칸이 2개: Name / Secret)

| Name | 밑줄 입력이 안 될 때 쓸 이름 | Secret 칸에 넣을 값 (값만) |
|---|---|---|
| `TOMTOM_API_KEY` | `TOMTOMAPIKEY` | TomTom 키 |
| `MAIL_TO` | `MAILTO` | `limcw@kia.com` |
| `SMTP_USER` | `SMTPUSER` | `limcwbz@gmail.com` |
| `SMTP_PASS` | `SMTPPASS` | Gmail 앱 비밀번호 16자 (공백 제거) |

4개 모두 같은 방식으로 통일합니다. 따옴표·쉼표·이름을 Secret 칸에 같이 넣지 마세요.

### 6) 첫 실행 (이때 data 브랜치가 자동 생성됩니다)
1. **Actions** 탭 → 안내 화면이 나오면 **I understand my workflows, go ahead and enable them**
2. 왼쪽 **collect** → **Run workflow** → Run workflow
3. 1~2분 뒤 초록 체크 확인. 저장소 상단 브랜치 목록에 **data** 가 생기고, 그 안에 `data/날짜.jsonl` 이 쌓이면 성공

### 7) 보고 시험
1. Actions → **daily-report** → Run workflow → `dry_run` 체크(기본) → 실행
2. 끝나면 실행 화면 맨 아래 **Artifacts → report-output** 다운로드 → 엑셀·그래프 확인 (한글이 깨지지 않았는지)
3. 다시 Run workflow → `dry_run` **체크 해제**, `mail_to` 에 `limcwbz@gmail.com` → 본인에게 실제 발송되는지 확인
4. 이상 없으면 끝. 이후 스케줄이 자동으로 동작합니다.

### 8) 전환
GitHub 수집이 몇 번 정상 확인되면 사내 PC의 예약 작업을 중지합니다 (둘이 동시에 돌면 TomTom 무료 한도 초과 가능).

---------------------------------------------------------------------

## 방법 B. git 명령어 (git 설치된 PC)

```powershell
cd SP306-TRAFFIC-upload
git init -b main
git config user.name  "limcwbz"
git config user.email "limcwbz@users.noreply.github.com"
git add .
git status                                  # node_modules, config.json 이 없어야 함
git commit -m "SP-306 traffic collector"
git remote add origin https://github.com/limcwbz/SP306-TRAFFIC.git
git push -u origin main                     # 브라우저 로그인 창이 뜨면 limcwbz 로 로그인
```
이후 4)~8) 는 방법 A 와 동일합니다. `data` 브랜치는 첫 실행 때 자동 생성됩니다.

---------------------------------------------------------------------

## 문제가 생기면
| 증상 | 확인 |
|---|---|
| Actions 에 워크플로가 안 보임 | `.github/workflows/` 두 파일이 main 에 올라갔는지, Actions 가 enable 되었는지 |
| collect 실패: `TOMTOM_API_KEY 가 설정되지 않았습니다` | Secret 이름 철자(`TOMTOM`), 4개 방식 통일, 값에 따옴표 없는지 |
| collect 실패: push 권한 오류 | Settings → Actions → General → Workflow permissions 가 Read and write 인지 |
| 그래프 글자가 네모(□)로 보임 | daily-report 로그의 "Install Korean font" 단계 성공 여부 알려주세요 |
| 메일 `Invalid login` / `535` | `SMTP_PASS` 가 앱 비밀번호(16자)인지, 2단계 인증이 켜져 있는지 |
| 메일이 안 옴 | 스팸함 확인. 사내 메일이 외부 Gmail 발신을 막을 수 있음 |

오류 화면의 **문구만** 알려주세요 (키·비밀번호는 가리고).

---------------------------------------------------------------------


## 업데이트 안내: SP-330 · SP-308 추가 (2026-11-19)

이미 이전 버전을 올리셨다면 아래 **변경·추가된 파일만** 같은 방법(Add file → Upload files)으로 덮어쓰면 됩니다.
`data` 브랜치와 Secrets 는 그대로 쓰며 다시 만들 필요가 없습니다.

| 구분 | 파일 |
|---|---|
| 변경 | `lib.js`, `collect.js`, `build_excel.js`, `chart.js`, `report_run.js` |
| 추가 | `sp330.json`, `sp308.json` (구간 좌표), `thresholds.json` (혼잡 기준) |

- 올린 직후부터 `collect` 가 SP-306 4구간 + SP-330 2구간 + SP-308 4구간(각 2방향 = 20건/15분, 하루 약 1,920건)을 조회합니다.
- 과거 `data` 기록에는 SP-330(1km×4)·SP-308 값이 없습니다. 보고서에서 해당 칸은 "기록 없음"입니다.
- 혼잡 기준을 바꾸려면 HTML 의 「혼잡 기준 설정」 탭에서 값을 정한 뒤 「내용 복사」한 JSON 을 `thresholds.json` 에 붙여 넣어 저장(commit)하세요. 파일이 없거나 값이 잘못되면 기본값 80/60/40 을 씁니다.

## 업데이트 안내: SP-306 3구간 + 세그먼트 기준 문구 (2026-11-19)

이전 버전을 올리셨다면 아래 **변경된 파일만** 덮어쓰면 됩니다. `data` 브랜치와 Secrets 는 그대로 쓰며, 파일 추가는 없습니다.

| 구분 | 파일 |
|---|---|
| 변경 | `lib.js`, `collect.js`, `build_excel.js`, `chart.js`, `report_run.js` |

- SP-306 이 4구간에서 3구간(구간 3 = 기존 3·4번 합침, 10.0–19.3 km)으로 바뀝니다. 이미 쌓인 `data` 의 4구간 기록은 읽을 때 자동으로 3구간으로 합쳐지므로 **다시 만들거나 지울 필요가 없습니다**.
- 엑셀 「요약」 시트와 메일 맨 아래에 「도로 세그먼트 기준 - TomTom 기준」 문구가 들어갑니다.
- 올린 직후부터 `collect` 가 15분마다 18건(SP-306 3구간 + SP-330 2구간 + SP-308 4구간, 각 2방향), 하루 약 1,728건을 조회합니다.

## 업데이트 안내: 통행량(volume) 집계 추가 (2026-11-20)

ARTESP 공개 자료로 SP-308 · SP-330 계측점별 일 통행량(차량 대수) 엑셀을 만드는 기능입니다. 속도 수집·보고와는 별개로 동작하며, **TomTom 을 호출하지 않으므로 API 한도에 영향이 없습니다.**

| 구분 | 파일 |
|---|---|
| 추가 | `volume.js`, `volume_config.json`, `.github/workflows/volume.yml` |
| 변경 | `README.md` (설명 추가) |

- 이미 올리셨다면 위 파일만 추가·덮어쓰면 됩니다. `data` 브랜치와 Secrets 는 그대로 쓰며, Secrets 를 새로 등록할 필요가 없습니다.
- 올린 뒤 Actions → `volume` → Run workflow 로 한 번 실행하고, 실행 화면 맨 아래 Artifacts → `traffic-volume` 에서 엑셀을 받으세요.
