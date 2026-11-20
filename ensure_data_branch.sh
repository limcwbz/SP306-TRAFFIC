#!/usr/bin/env bash
# data 브랜치가 없으면 seed/ 폴더 내용으로 새로 만들어 push 한다. 이미 있으면 아무것도 하지 않는다.
# (웹 화면으로 코드만 올려도 첫 실행 때 서버가 data 브랜치를 알아서 만들도록 하기 위함)
# 필요: 환경변수 REMOTE_URL (토큰 포함 저장소 주소). 저장소 루트에서 실행.
set -uo pipefail
: "${REMOTE_URL:?REMOTE_URL 이 필요합니다}"

git ls-remote --exit-code --heads "$REMOTE_URL" data >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 0 ]; then echo "data 브랜치가 이미 있습니다."; exit 0; fi
if [ "$rc" -ne 2 ]; then echo "저장소 조회 실패 (코드 $rc)"; exit 1; fi

echo "data 브랜치가 없어 새로 만듭니다."
SRC="$(pwd)/seed"
TMP="$(mktemp -d)"
if [ -d "$SRC" ]; then cp -r "$SRC"/. "$TMP"/; else echo "# data" > "$TMP/README.md"; fi
mkdir -p "$TMP/data"
cd "$TMP" || exit 1
git init -q -b data
git config user.name  "sp306-bot"
git config user.email "sp306-bot@users.noreply.github.com"
git add -A
git commit -q -m "init data branch"
git push -q "$REMOTE_URL" data
echo "data 브랜치 생성 완료."
