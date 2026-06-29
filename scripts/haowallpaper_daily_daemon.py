#!/usr/bin/env python3
"""
Haowallpaper daily runner without cron.

Usage:
  python3 scripts/haowallpaper_daily_daemon.py --once
  python3 scripts/haowallpaper_daily_daemon.py --run-at 03:30

It loads .env first, then .env.haowallpaper if present, and runs
scripts/run_haowallpaper_daily.sh on schedule.
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import shlex
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STOP = False


def log(msg: str) -> None:
    now = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] {msg}", flush=True)


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
        if not key:
            continue

        # 支持多行单/双引号，例如 WALLPAPER_JOBS='a\nb'
        if val.startswith(("'", '"')):
            quote = val[0]
            while not (len(val) >= 2 and val.endswith(quote)) and i < len(lines):
                val += "\n" + lines[i]
                i += 1

        try:
            parts = shlex.split(val, posix=True)
            val = parts[0] if parts else ""
        except ValueError:
            val = val.strip('"').strip("'")
        env[key] = val
    return env


def load_env(explicit_env: str | None = None) -> dict[str, str]:
    merged = os.environ.copy()
    candidates = []
    if explicit_env:
        candidates.append(ROOT / explicit_env)
    else:
        # .env 更通用；.env.haowallpaper 保持兼容。后读的覆盖前面的。
        candidates.extend([ROOT / ".env", ROOT / ".env.haowallpaper"])
    for p in candidates:
        if p.exists():
            log(f"读取配置: {p}")
            merged.update(parse_env_file(p))
    return merged


def parse_hhmm(s: str) -> tuple[int, int]:
    try:
        h, m = s.split(":", 1)
        h, m = int(h), int(m)
        if 0 <= h <= 23 and 0 <= m <= 59:
            return h, m
    except Exception:
        pass
    raise SystemExit(f"--run-at 格式错误，应为 HH:MM，例如 03:30，当前: {s}")


def next_run_time(run_at: str) -> dt.datetime:
    h, m = parse_hhmm(run_at)
    now = dt.datetime.now()
    target = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if target <= now:
        target += dt.timedelta(days=1)
    return target


def sleep_until(t: dt.datetime) -> None:
    global STOP
    while not STOP:
        remain = (t - dt.datetime.now()).total_seconds()
        if remain <= 0:
            return
        time.sleep(min(remain, 30))


def run_daily(script: Path, env: dict[str, str]) -> int:
    if not script.exists():
        log(f"脚本不存在: {script}")
        return 127
    log(f"开始执行每日任务: {script}")
    proc = subprocess.Popen([str(script)], cwd=str(ROOT), env=env)
    while proc.poll() is None:
        if STOP:
            log("收到退出信号，转发给子进程...")
            proc.terminate()
            try:
                proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                proc.kill()
            break
        time.sleep(1)
    code = proc.returncode or 0
    log(f"每日任务结束: exit={code}")
    return code


def handle_signal(signum, frame):  # noqa: ANN001
    global STOP
    STOP = True
    log(f"收到信号 {signum}，准备退出")


def main() -> int:
    parser = argparse.ArgumentParser(description="Haowallpaper daily daemon without cron")
    parser.add_argument("--run-at", default=None, help="每天运行时间 HH:MM；不填则读取 .env 里的 HAOWALLPAPER_RUN_AT，仍未配置则默认 03:30")
    parser.add_argument("--once", action="store_true", help="只运行一次后退出")
    parser.add_argument("--run-now", action="store_true", help="启动后先立即运行一次，然后进入每日循环")
    parser.add_argument("--env", dest="env_file", default=None, help="指定 env 文件，例如 .env")
    parser.add_argument("--script", default="scripts/run_haowallpaper_daily.sh", help="每日任务脚本路径")
    args = parser.parse_args()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    env = load_env(args.env_file)
    run_at = args.run_at or env.get("HAOWALLPAPER_RUN_AT", "03:30")
    script = ROOT / args.script

    if args.once:
      return run_daily(script, env)

    if args.run_now:
        code = run_daily(script, env)
        if code != 0:
            log(f"立即运行失败 exit={code}，仍继续等待下一次定时")

    log(f"常驻模式启动：每天 {run_at} 自动运行。退出请 Ctrl+C 或 kill 进程。")
    while not STOP:
        target = next_run_time(run_at)
        log(f"下次运行时间: {target.strftime('%Y-%m-%d %H:%M:%S')}")
        sleep_until(target)
        if STOP:
            break
        # 每轮重新读取 env，方便你修改 .env 后第二天自动生效
        env = load_env(args.env_file)
        if args.run_at is None:
            run_at = env.get("HAOWALLPAPER_RUN_AT", run_at)
        run_daily(script, env)

    log("调度器退出")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
