# HaoWallpaper 服务器部署说明

## 1. 本地打包/上传

推荐用 `rsync`，不要把已经下载的图片、日志、进度一起传上去：

```bash
cd /Users/jiangdk/code/personal
rsync -av \
  --exclude 'downloads/' \
  --exclude 'logs/' \
  --exclude 'state/' \
  --exclude '.env' \
  zhefeng/ root@你的服务器IP:/opt/zhefeng/
```

如果服务器不允许 root，把 `root@你的服务器IP` 换成你的用户，例如：

```bash
rsync -av --exclude 'downloads/' --exclude 'logs/' --exclude 'state/' --exclude '.env' \
  zhefeng/ ubuntu@你的服务器IP:/home/ubuntu/zhefeng/
```

没有 rsync 时，用 tar/scp：

```bash
cd /Users/jiangdk/code/personal
tar --exclude='zhefeng/downloads' --exclude='zhefeng/logs' --exclude='zhefeng/state' --exclude='zhefeng/.env' \
  -czf zhefeng.tar.gz zhefeng
scp zhefeng.tar.gz root@你的服务器IP:/opt/
ssh root@你的服务器IP
cd /opt && tar -xzf zhefeng.tar.gz
```

---

## 2. 服务器安装环境

Ubuntu/Debian：

```bash
sudo apt update
sudo apt install -y curl python3 tmux rsync
```

安装 Node.js，建议 Node 20/22：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

要求：

```txt
node >= 18
python3 >= 3.8
curl 可用
```

---

## 3. 配置 .env

进入项目目录：

```bash
cd /opt/zhefeng
cp .env.example .env
nano .env
```

最简 relay 配置：

```bash
RELAY_BASE='https://你的relay域名/你的用户/你的池子'
HAOWALLPAPER_RUN_AT=03:30
CONCURRENCY=50
DAILY_LIMIT=300

WALLPAPER_JOBS='pc-image|1|image|downloads/haowallpaper-pc-image|state/haowallpaper-pc-image.json|300|3|
mobile-image|2|image|downloads/haowallpaper-mobile-image|state/haowallpaper-mobile-image.json|300|3|'
```

如果用大漠，注释 `RELAY_BASE`，打开 `DM_PROXY_API`。

---

## 4. 可选：上传/搬运到 Google Drive

推荐方式：**先下载到服务器本地，任务结束后用 rclone 上传或 move 到 Google Drive**。

安装 rclone：

```bash
curl https://rclone.org/install.sh | sudo bash
rclone version
```

配置 Google Drive：

```bash
rclone config
```

常用选择：

```txt
n) New remote
name> gdrive
Storage> drive
scope> 1
```

如果服务器没有浏览器，可以在本地电脑跑：

```bash
rclone authorize "drive"
```

然后把生成的 token 粘贴回服务器的 `rclone config`。

测试：

```bash
rclone lsd gdrive:
```

然后在 `/opt/zhefeng/.env` 开启：

```bash
RCLONE_ENABLE=1
RCLONE_REMOTE='gdrive:'
RCLONE_BASE_DIR='haowallpaper'

# move = 上传后删除服务器本地图片，省服务器硬盘，推荐长期跑
# copy = 上传后本地也保留
RCLONE_MODE=move

RCLONE_TRANSFERS=8
RCLONE_CHECKERS=16
```

之后每天跑完每个任务，会自动上传到：

```txt
gdrive:/haowallpaper/pc-image/
gdrive:/haowallpaper/mobile-image/
gdrive:/haowallpaper/_state/
gdrive:/haowallpaper/_logs/
```

> 不建议直接把 Google Drive mount 成下载目录。高并发写入网盘挂载盘容易慢、失败或出现半文件。先本地下载，结束后 rclone move 最稳。

---

## 5. 手动测试

先只跑一次：

```bash
cd /opt/zhefeng
python3 scripts/haowallpaper_daily_daemon.py --once
```

如果正常，会看到：

```txt
job start
🎯 本次计划
✅ 成功 / ⏭️ 跳过
💾 进度
🏁 完成
```

---

## 6. 用 tmux 常驻运行

```bash
cd /opt/zhefeng
tmux new -s haowallpaper
python3 scripts/haowallpaper_daily_daemon.py --run-now
```

每天几点跑由 `.env` 里的 `HAOWALLPAPER_RUN_AT=03:30` 控制。

退出 tmux 但不中断程序：

```txt
Ctrl+B 然后按 D
```

重新进入：

```bash
tmux attach -t haowallpaper
```

---

## 7. 用 nohup 后台运行

项目里带了一个管理脚本：

```bash
cd /opt/zhefeng
chmod +x scripts/haowallpaper_nohup.sh
```

启动后台调度器，按 `.env` 里的 `HAOWALLPAPER_RUN_AT` 每天运行：

```bash
./scripts/haowallpaper_nohup.sh start
```

启动后先立即跑一次，然后每天定时运行：

```bash
./scripts/haowallpaper_nohup.sh start-now
```

查看状态：

```bash
./scripts/haowallpaper_nohup.sh status
```

查看调度器日志：

```bash
./scripts/haowallpaper_nohup.sh logs
```

查看每日下载任务日志：

```bash
./scripts/haowallpaper_nohup.sh run-logs
```

停止：

```bash
./scripts/haowallpaper_nohup.sh stop
```

重启：

```bash
./scripts/haowallpaper_nohup.sh restart
```

只前台跑一次：

```bash
./scripts/haowallpaper_nohup.sh once
```

> nohup 不会开机自启。服务器重启后需要手动执行 `start` 或 `start-now`。如果想开机自启，用下面的 systemd。

---

## 8. 用 systemd 开机自启，推荐服务器使用

把模板复制到 systemd：

```bash
sudo cp deploy/haowallpaper.service /etc/systemd/system/haowallpaper.service
sudo systemctl daemon-reload
sudo systemctl enable haowallpaper
sudo systemctl start haowallpaper
```

查看状态：

```bash
systemctl status haowallpaper --no-pager
```

看日志：

```bash
journalctl -u haowallpaper -f
```

停止：

```bash
sudo systemctl stop haowallpaper
```

重启：

```bash
sudo systemctl restart haowallpaper
```

> 如果项目不在 `/opt/zhefeng`，先编辑 `deploy/haowallpaper.service` 里的路径。

---

## 9. 日常查看

查看下载数量：

```bash
find downloads/haowallpaper-pc-image -type f | wc -l
find downloads/haowallpaper-mobile-image -type f | wc -l
```

查看进度：

```bash
cat state/haowallpaper-pc-image.json
cat state/haowallpaper-mobile-image.json
```

查看磁盘：

```bash
df -h
du -sh downloads/
```

查看运行日志：

```bash
ls -lh logs/
tail -f logs/haowallpaper-*.log
```

---

## 10. 更新代码

本地改完后再次同步：

```bash
cd /Users/jiangdk/code/personal
rsync -av \
  --exclude 'downloads/' \
  --exclude 'logs/' \
  --exclude 'state/' \
  --exclude '.env' \
  zhefeng/ root@你的服务器IP:/opt/zhefeng/
```

服务器重启服务：

```bash
ssh root@你的服务器IP
sudo systemctl restart haowallpaper
```
