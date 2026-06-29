#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PYTHON_BIN="${PYTHON_BIN:-python3}"
DAEMON_SCRIPT="$ROOT/scripts/haowallpaper_daily_daemon.py"
LOG_DIR="${LOG_DIR:-$ROOT/logs}"
STATE_DIR="${STATE_DIR:-$ROOT/state}"
PID_FILE="${PID_FILE:-$STATE_DIR/haowallpaper_daemon.pid}"
DAEMON_LOG="${DAEMON_LOG:-$LOG_DIR/daemon.log}"

mkdir -p "$LOG_DIR" "$STATE_DIR"

usage() {
  cat <<USAGE
用法：
  $0 start       后台常驻，按 .env 里的 HAOWALLPAPER_RUN_AT 每天运行
  $0 start-now   后台常驻，启动后先立即跑一次，然后每天定时运行
  $0 once        前台只跑一次，跑完退出
  $0 stop        停止后台调度器
  $0 restart     重启后台调度器
  $0 status      查看后台调度器状态
  $0 check-env   检查 .env 解析结果
  $0 logs        查看调度器 nohup 日志
  $0 run-logs    查看每日下载任务日志

环境变量可选：
  PYTHON_BIN=python3
  PID_FILE=state/haowallpaper_daemon.pid
  DAEMON_LOG=logs/daemon.log
USAGE
}

is_pid_running() {
  local pid="${1:-}"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

read_pid() {
  if [ -f "$PID_FILE" ]; then
    tr -dc '0-9' < "$PID_FILE" || true
  fi
}

find_daemon_pids() {
  pgrep -f "haowallpaper_daily_daemon\.py" 2>/dev/null | while read -r pid; do
    [ "$pid" = "$$" ] && continue
    ps -p "$pid" -o command= 2>/dev/null | grep -q "$DAEMON_SCRIPT" && echo "$pid" || true
  done
}

running_pid() {
  local pid
  pid="$(read_pid)"
  if is_pid_running "$pid"; then
    echo "$pid"
    return 0
  fi
  find_daemon_pids | head -n 1
}

start_daemon() {
  local run_now="${1:-0}"
  local pid
  pid="$(running_pid || true)"
  if [ -n "$pid" ]; then
    echo "已经在运行：pid=$pid"
    echo "日志：$DAEMON_LOG"
    return 0
  fi

  rm -f "$PID_FILE"
  local args=()
  if [ "$run_now" = "1" ]; then
    args+=(--run-now)
  fi

  echo "启动后台调度器..."
  echo "项目：$ROOT"
  echo "日志：$DAEMON_LOG"
  nohup "$PYTHON_BIN" "$DAEMON_SCRIPT" "${args[@]}" > "$DAEMON_LOG" 2>&1 &
  pid=$!
  echo "$pid" > "$PID_FILE"
  sleep 1

  if is_pid_running "$pid"; then
    echo "启动成功：pid=$pid"
    echo "查看日志：$0 logs"
  else
    echo "启动失败，最近日志："
    tail -n 80 "$DAEMON_LOG" || true
    rm -f "$PID_FILE"
    return 1
  fi
}

stop_daemon() {
  local pids=()
  local pid
  pid="$(read_pid)"
  if is_pid_running "$pid"; then
    pids+=("$pid")
  fi
  while read -r pid; do
    [ -n "$pid" ] || continue
    if [[ ! " ${pids[*]:-} " =~ " $pid " ]]; then
      pids+=("$pid")
    fi
  done < <(find_daemon_pids || true)

  if [ "${#pids[@]}" -eq 0 ]; then
    echo "没有运行中的后台调度器"
    rm -f "$PID_FILE"
    return 0
  fi

  echo "停止后台调度器：${pids[*]}"
  for pid in "${pids[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done

  for _ in $(seq 1 30); do
    local alive=0
    for pid in "${pids[@]}"; do
      if is_pid_running "$pid"; then
        alive=1
      fi
    done
    [ "$alive" = "0" ] && break
    sleep 1
  done

  for pid in "${pids[@]}"; do
    if is_pid_running "$pid"; then
      echo "进程未退出，强制结束：pid=$pid"
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
  rm -f "$PID_FILE"
  echo "已停止"
}

status_daemon() {
  local pid
  pid="$(running_pid || true)"
  if [ -n "$pid" ]; then
    echo "运行中：pid=$pid"
    ps -p "$pid" -o pid,etime,command
    echo "PID 文件：$PID_FILE"
    echo "调度日志：$DAEMON_LOG"
    echo "最近日志："
    tail -n 20 "$DAEMON_LOG" 2>/dev/null || true
  else
    echo "未运行"
    echo "PID 文件：$PID_FILE"
    echo "调度日志：$DAEMON_LOG"
    [ -f "$PID_FILE" ] && echo "提示：PID 文件可能是旧的，可执行 $0 stop 清理"
    return 0
  fi
}

check_env() {
  "$PYTHON_BIN" - "$ROOT/.env" "$ROOT/.env.haowallpaper" <<'PY'
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
    p = Path(item)
    if p.exists():
        print(f"读取: {p}")
        merged.update(parse_env_file(p))

errors: list[str] = []
relay = merged.get("RELAY_BASE", "")
dm = merged.get("DM_PROXY_API", "")
jobs = merged.get("WALLPAPER_JOBS", "")

print()
print(f"RELAY_BASE = {relay!r}")
print(f"DM_PROXY_API = {'已配置' if dm else '未配置'}")
print(f"QUALITY = {merged.get('QUALITY', 'original')}")
print(f"CONCURRENCY = {merged.get('CONCURRENCY', '50')}")
print(f"DAILY_LIMIT = {merged.get('DAILY_LIMIT', '300')}")
print(f"RCLONE_ENABLE = {merged.get('RCLONE_ENABLE', '0')}")
print(f"RCLONE_REMOTE = {merged.get('RCLONE_REMOTE', '')!r}")
print(f"RCLONE_BASE_DIR = {merged.get('RCLONE_BASE_DIR', '')!r}")
print(f"RCLONE_MODE = {merged.get('RCLONE_MODE', 'move')!r}")

if relay:
    if "\n" in relay or "\r" in relay:
        errors.append("RELAY_BASE 含换行，通常是引号没闭合")
    if not re.match(r"^https?://", relay):
        errors.append("RELAY_BASE 必须以 http:// 或 https:// 开头")
    if relay.endswith("/https/api.ipify.org") or relay.endswith("/http/api.ipify.org"):
        print("提示: RELAY_BASE 可以用测试地址，脚本会自动截成基础地址；更建议直接填基础地址。")
    print(f"relay 测试命令: curl -s {shlex.quote(relay.rstrip('/') + '/https/api.ipify.org')}")
elif not dm:
    errors.append("RELAY_BASE 和 DM_PROXY_API 至少配置一个")

job_lines = [x for x in jobs.splitlines() if x.strip() and not x.strip().startswith("#")]
print(f"WALLPAPER_JOBS = {len(job_lines)} 个任务")
for idx, line in enumerate(job_lines, 1):
    cols = line.split("|")
    print(f"  {idx}. {line}")
    if len(cols) < 6:
        errors.append(f"WALLPAPER_JOBS 第 {idx} 行字段不足，应至少 6 列")

print()
if errors:
    print("检查结果: 失败")
    for e in errors:
        print(f"  - {e}")
    raise SystemExit(1)
print("检查结果: OK")
PY
}

case "${1:-}" in
  start)
    start_daemon 0
    ;;
  start-now)
    start_daemon 1
    ;;
  once)
    "$PYTHON_BIN" "$DAEMON_SCRIPT" --once
    ;;
  stop)
    stop_daemon
    ;;
  restart)
    stop_daemon
    start_daemon 0
    ;;
  status)
    status_daemon
    ;;
  check-env)
    check_env
    ;;
  logs)
    touch "$DAEMON_LOG"
    tail -f "$DAEMON_LOG"
    ;;
  run-logs)
    touch "$LOG_DIR/.keep"
    if compgen -G "$LOG_DIR/haowallpaper-*.log" >/dev/null; then
      tail -f "$LOG_DIR"/haowallpaper-*.log
    else
      echo "还没有每日下载任务日志：$LOG_DIR/haowallpaper-*.log"
      echo "可以先运行：$0 start-now"
    fi
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "未知命令：$1" >&2
    usage >&2
    exit 2
    ;;
esac
