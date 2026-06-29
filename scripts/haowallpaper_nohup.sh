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
