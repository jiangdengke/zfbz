#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# 私密配置放这里：优先读取 .env；兼容 .env.haowallpaper，后者可覆盖前者。
# 不直接 source，避免 WALLPAPER_JOBS 里的 | 被 shell 当成管道执行。
load_env_files() {
  local exports
  exports="$(
    python3 - "$ROOT/.env" "$ROOT/.env.haowallpaper" <<'PY'
import re
import shlex
import sys
from pathlib import Path


def parse_env_file(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env

    lines = path.read_text(encoding="utf-8").splitlines()
    i = 0
    while i < len(lines):
        raw = lines[i]
        i += 1
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip()
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key):
            continue

        # 支持多行单/双引号，例如：
        # WALLPAPER_JOBS='a|1|image|...
        # b|2|image|...'
        # 如果某个单行值漏了结尾引号，遇到空行/注释/新变量就停止，避免把后面的配置吞进去。
        if val.startswith(("'", '"')):
            quote = val[0]
            while not (len(val) >= 2 and val.endswith(quote)) and i < len(lines):
                nxt = lines[i]
                stripped = nxt.strip()
                if (
                    not stripped
                    or stripped.startswith("#")
                    or ("=" in stripped and re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", stripped.split("=", 1)[0].strip()))
                ):
                    break
                val += "\n" + nxt
                i += 1

        try:
            parts = shlex.split(val, posix=True)
            val = parts[0] if parts else ""
        except ValueError:
            val = val.strip('"').strip("'")
        env[key] = val
    return env


merged: dict[str, str] = {}
for item in sys.argv[1:]:
    merged.update(parse_env_file(Path(item)))

for key, val in merged.items():
    print(f"export {key}={shlex.quote(val)}")
PY
  )"
  if [ -n "$exports" ]; then
    eval "$exports"
  fi
}

load_env_files

if [ -z "${DM_PROXY_API:-}" ] && [ -z "${RELAY_BASE:-}" ]; then
  echo "请先在 .env.haowallpaper 里配置 DM_PROXY_API 或 RELAY_BASE" >&2
  exit 2
fi

PROXY_ARGS=()
if [ -n "${RELAY_BASE:-}" ]; then
  PROXY_ARGS+=(--relay-base "$RELAY_BASE")
else
  PROXY_ARGS+=(--dm-proxy-api "$DM_PROXY_API" --bulk-proxy-scheme http --bulk-proxy-timeout 120)
fi

QUALITY="${QUALITY:-original}"
ROWS="${ROWS:-12}"
PAGES="${PAGES:-10000}"
DAILY_LIMIT="${DAILY_LIMIT:-300}"
CONCURRENCY="${CONCURRENCY:-50}"
PROXY_TIMEOUT="${PROXY_TIMEOUT:-8}"
PROXY_RETRIES="${PROXY_RETRIES:-5000}"
LIST_RETRIES="${LIST_RETRIES:-10}"
RUN_RETRIES="${RUN_RETRIES:-0}"
SORT="${SORT:-3}"
SEARCH="${SEARCH:-}"
DELAY="${DELAY:-0}"
LOG_DIR="${LOG_DIR:-logs}"

# 可选：任务结束后上传/搬运到 Google Drive / 其他 rclone remote
# 需要先在服务器配置好 rclone remote，例如 gdrive:
RCLONE_ENABLE="${RCLONE_ENABLE:-0}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
RCLONE_BASE_DIR="${RCLONE_BASE_DIR:-haowallpaper}"
RCLONE_MODE="${RCLONE_MODE:-move}" # move=上传后删除本地图片；copy=本地和网盘都保留；sync=镜像同步
RCLONE_TRANSFERS="${RCLONE_TRANSFERS:-8}"
RCLONE_CHECKERS="${RCLONE_CHECKERS:-16}"
RCLONE_BWLIMIT="${RCLONE_BWLIMIT:-}"
RCLONE_FAIL_FATAL="${RCLONE_FAIL_FATAL:-0}"

# rclone 会自动读取同名环境变量；空的 RCLONE_BWLIMIT="" 会导致：
# Invalid value when setting --bwlimit from environment variable
# 所以没配置限速时必须 unset。
if [ -z "${RCLONE_BWLIMIT:-}" ]; then
  unset RCLONE_BWLIMIT
fi

# 多任务格式，每行：名称|wp-type|kind|输出目录|进度文件|本任务每日新增上限|排序|搜索词
# kind: image / video / all
DEFAULT_JOBS=$'pc-image|1|image|downloads/haowallpaper-pc-image|state/haowallpaper-pc-image.json|300|3|\nmobile-image|2|image|downloads/haowallpaper-mobile-image|state/haowallpaper-mobile-image.json|300|3|'
WALLPAPER_JOBS="${WALLPAPER_JOBS:-$DEFAULT_JOBS}"

mkdir -p "$LOG_DIR" state downloads
LOG_FILE="$LOG_DIR/haowallpaper-$(date '+%Y%m%d-%H%M%S').log"

rclone_enabled() {
  [ "${RCLONE_ENABLE:-0}" = "1" ] || [ "${RCLONE_ENABLE:-0}" = "true" ] || [ "${RCLONE_ENABLE:-0}" = "yes" ]
}

rclone_dest() {
  local sub="$1"
  local remote="${RCLONE_REMOTE%:}:"
  local base="${RCLONE_BASE_DIR#/}"
  base="${base%/}"
  if [ -n "$base" ]; then
    printf '%s%s/%s' "$remote" "$base" "$sub"
  else
    printf '%s%s' "$remote" "$sub"
  fi
}

rclone_common_args() {
  printf '%s\0' --transfers "$RCLONE_TRANSFERS" --checkers "$RCLONE_CHECKERS"
  if [ -n "${RCLONE_BWLIMIT:-}" ]; then
    printf '%s\0' --bwlimit "$RCLONE_BWLIMIT"
  fi
}

upload_path_with_rclone() {
  local mode="$1"
  local src="$2"
  local dest="$3"
  local label="$4"

  if ! rclone_enabled; then
    return 0
  fi
  if ! command -v rclone >/dev/null 2>&1; then
    echo "[$(date '+%F %T')] rclone 未安装，跳过上传: $label" | tee -a "$LOG_FILE"
    [ "$RCLONE_FAIL_FATAL" = "1" ] && return 1 || return 0
  fi
  if [ -z "${RCLONE_REMOTE:-}" ]; then
    echo "[$(date '+%F %T')] RCLONE_ENABLE=1 但 RCLONE_REMOTE 为空，跳过上传: $label" | tee -a "$LOG_FILE"
    [ "$RCLONE_FAIL_FATAL" = "1" ] && return 1 || return 0
  fi
  if [ ! -e "$src" ]; then
    echo "[$(date '+%F %T')] 上传源不存在，跳过: $src" | tee -a "$LOG_FILE"
    return 0
  fi

  local args=()
  while IFS= read -r -d '' arg; do
    args+=("$arg")
  done < <(rclone_common_args)

  echo "[$(date '+%F %T')] rclone $mode: $label -> $dest" | tee -a "$LOG_FILE"
  set +e
  case "$mode" in
    move)
      rclone move "$src" "$dest" "${args[@]}" --create-empty-src-dirs 2>&1 | tee -a "$LOG_FILE"
      ;;
    copy)
      rclone copy "$src" "$dest" "${args[@]}" 2>&1 | tee -a "$LOG_FILE"
      ;;
    sync)
      rclone sync "$src" "$dest" "${args[@]}" 2>&1 | tee -a "$LOG_FILE"
      ;;
    *)
      echo "[$(date '+%F %T')] RCLONE_MODE 只能是 move/copy/sync，当前: $mode" | tee -a "$LOG_FILE"
      set -e
      return 1
      ;;
  esac
  local code=${PIPESTATUS[0]}
  set -e

  if [ "$code" -ne 0 ]; then
    echo "[$(date '+%F %T')] rclone 上传失败: label=$label status=$code" | tee -a "$LOG_FILE"
    [ "$RCLONE_FAIL_FATAL" = "1" ] && return "$code" || return 0
  fi
  echo "[$(date '+%F %T')] rclone 上传完成: $label" | tee -a "$LOG_FILE"
  return 0
}

echo "[$(date '+%F %T')] daily run start: concurrency=$CONCURRENCY log=$LOG_FILE" | tee -a "$LOG_FILE"
if rclone_enabled; then
  echo "[$(date '+%F %T')] rclone enabled: remote=${RCLONE_REMOTE:-未配置} base=${RCLONE_BASE_DIR:-} mode=$RCLONE_MODE transfers=$RCLONE_TRANSFERS checkers=$RCLONE_CHECKERS" | tee -a "$LOG_FILE"
else
  echo "[$(date '+%F %T')] rclone disabled: RCLONE_ENABLE=${RCLONE_ENABLE:-0}" | tee -a "$LOG_FILE"
fi

status=0
while IFS='|' read -r JOB_NAME JOB_WP_TYPE JOB_KIND JOB_OUT JOB_STATE JOB_LIMIT JOB_SORT JOB_SEARCH; do
  # 跳过空行和注释
  [ -z "${JOB_NAME// }" ] && continue
  [[ "$JOB_NAME" =~ ^# ]] && continue

  JOB_LIMIT="${JOB_LIMIT:-$DAILY_LIMIT}"
  JOB_KIND="${JOB_KIND:-image}"
  JOB_OUT="${JOB_OUT:-downloads/haowallpaper-$JOB_NAME}"
  JOB_STATE="${JOB_STATE:-state/haowallpaper-$JOB_NAME.json}"
  JOB_SORT="${JOB_SORT:-$SORT}"
  JOB_SEARCH="${JOB_SEARCH:-$SEARCH}"

  SEARCH_ARGS=()
  if [ -n "${JOB_SEARCH:-}" ]; then
    SEARCH_ARGS+=(--search "$JOB_SEARCH")
  fi

  mkdir -p "$JOB_OUT" "$(dirname "$JOB_STATE")"

  echo "[$(date '+%F %T')] job start: name=$JOB_NAME wpType=$JOB_WP_TYPE kind=$JOB_KIND sort=$JOB_SORT search=${JOB_SEARCH:-无} limit=$JOB_LIMIT state=$JOB_STATE" | tee -a "$LOG_FILE"

  attempt=0
  code=0
  while :; do
    attempt=$((attempt + 1))
    echo "[$(date '+%F %T')] job attempt: name=$JOB_NAME attempt=$attempt/$((RUN_RETRIES + 1))" | tee -a "$LOG_FILE"
    set +e
    node scripts/haowallpaper_original_downloader.mjs \
      --quality "$QUALITY" \
      --pages "$PAGES" \
      --rows "$ROWS" \
      --wp-type "$JOB_WP_TYPE" \
      --kind "$JOB_KIND" \
      --sort "$JOB_SORT" \
      "${SEARCH_ARGS[@]}" \
      --out "$JOB_OUT" \
      --delay "$DELAY" \
      --concurrency "$CONCURRENCY" \
      "${PROXY_ARGS[@]}" \
      --proxy-retries "$PROXY_RETRIES" \
      --proxy-timeout "$PROXY_TIMEOUT" \
      --list-retries "$LIST_RETRIES" \
      --daily-limit "$JOB_LIMIT" \
      --state-file "$JOB_STATE" \
      --resume \
      2>&1 | tee -a "$LOG_FILE"
    code=${PIPESTATUS[0]}
    set -e
    if [ "$code" -eq 0 ] || [ "$attempt" -gt "$RUN_RETRIES" ]; then
      break
    fi
    echo "[$(date '+%F %T')] job retry after failure: name=$JOB_NAME status=$code" | tee -a "$LOG_FILE"
    sleep 30
  done

  echo "[$(date '+%F %T')] job end: name=$JOB_NAME status=$code" | tee -a "$LOG_FILE"
  if [ "$code" -ne 0 ]; then
    status="$code"
  fi

  if rclone_enabled; then
    DEST="$(rclone_dest "$JOB_NAME")"
    if ! upload_path_with_rclone "$RCLONE_MODE" "$JOB_OUT" "$DEST" "$JOB_NAME"; then
      status=1
    fi
    # state 很小，始终 copy 一份到网盘，避免服务器重装/迁移后丢进度
    if ! upload_path_with_rclone copy "$(dirname "$JOB_STATE")" "$(rclone_dest "_state")" "state"; then
      status=1
    fi
  fi

done <<< "$WALLPAPER_JOBS"

if rclone_enabled; then
  if ! upload_path_with_rclone copy "$LOG_FILE" "$(rclone_dest "_logs")" "log"; then
    status=1
  fi
fi

echo "[$(date '+%F %T')] daily run end: status=$status" | tee -a "$LOG_FILE"
exit "$status"
