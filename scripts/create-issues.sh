#!/usr/bin/env bash
# Заводит issues из docs/issues/*.md в GitHub (метки, milestone «MLP 27.11»).
# Повторный запуск безопасен: issue с тем же заголовком пропускается.
# Нужно: gh с правом записи в репозиторий (gh auth login). Только REST API (без GraphQL).
# Запуск: npm run issues:create   (или bash scripts/create-issues.sh prokodan/kniga-semyi)
set -euo pipefail

REPO="${1:-prokodan/kniga-semyi}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/docs/issues"
MILESTONE="MLP 27.11"
ORDER=(V0 I1 I2 I10 I15 V1 I4 I3 I5 I14 I6 I7 I8 I9 I11 V2 I12 I13 V3)

label() { gh label create "$1" --repo "$REPO" --color "$2" --description "$3" --force >/dev/null; }

echo "Метки…"
label "zone:Z1" "c5def5" "Запись и интервью"
label "zone:Z2" "bfd4f2" "ИИ-конвейер"
label "zone:Z3" "d4c5f9" "Глава, книга, QR"
label "zone:Z4" "fef2c0" "Демо-оплата и допы"
label "zone:Z5" "c2e0c6" "АКНЦ"
label "zone:Z6" "e4e669" "Платформа"
label "owner:claude" "d97757" "Claude Code / Данил"
label "owner:codex" "10a37f" "Codex / Влад"
label "owner:human" "ededed" "Ручная работа без агента"
label "day:W0" "f9d0c4" "сб 21 – вс 22.11"
label "day:W1" "f9d0c4" "пн 23.11"
label "day:W2" "f9d0c4" "вт 24.11"
label "day:W3" "f9d0c4" "ср 25.11 до 14:00"
label "critical-path" "b60205" "Критический путь — не резать"
label "can-cut" "cccccc" "Режем первым, если не успеваем"
label "bug" "d73a4a" "Баг"

echo "Milestone…"
ms="$(gh api "repos/$REPO/milestones?state=all&per_page=100" --jq ".[] | select(.title == \"$MILESTONE\") | .number")"
if [ -z "$ms" ]; then
  ms="$(gh api "repos/$REPO/milestones" -f title="$MILESTONE" -f due_on="2026-11-27T05:00:00Z" \
    -f description="Полуфинал Startup-Nunchi. Фриз фич — ср 25.11 14:00" --jq .number)"
fi

existing="$(gh api "repos/$REPO/issues?state=all&per_page=100" --paginate --jq '.[] | select(.pull_request == null) | .title')"

for id in "${ORDER[@]}"; do
  file="$DIR/$id.md"
  title="$(sed -n 's/^title: "\(.*\)"$/\1/p' "$file" | head -1)"
  labels="$(sed -n 's/^labels: \[\(.*\)\]$/\1/p' "$file" | head -1 | tr -d ' ')"
  body="$(awk 'BEGIN{n=0} /^---$/{n++; next} n>=2' "$file")"
  if grep -Fxq "$title" <<<"$existing"; then
    echo "= уже есть: $title"
    continue
  fi
  printf '%s\n\n---\n_Источник: `docs/issues/%s.md`_\n' "$body" "$id" > /tmp/issue-body.md
  url="$(jq -n --arg t "$title" --rawfile b /tmp/issue-body.md --arg l "$labels" --argjson m "$ms" \
    '{title: $t, body: $b, labels: ($l | split(",")), milestone: $m}' \
    | gh api "repos/$REPO/issues" --input - --jq .html_url)"
  echo "+ $url  $title"
done
echo "Готово."
