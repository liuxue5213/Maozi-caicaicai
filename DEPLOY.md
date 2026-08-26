# 部署指南

## 端口分配

| 服务 | 端口 | 说明 |
|------|------|------|
| Web 前端 | 60200 | Nginx 静态文件 + 反向代理 |
| 后端 API + WebSocket | 60205 | Node.js 服务器 |

## 快速部署

### 1. 服务器初始化

```bash
# SSH 登录
ssh root@你的服务器IP

# 安装 Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 安装 PM2
npm install -g pm2

# 安装 Nginx
apt-get install -y nginx

# 创建目录
mkdir -p /opt/maozi-rps/server /opt/maozi-rps/web /var/log/maozi-rps
mkdir -p /opt/maozi-rps/server/data
```

### 2. 部署后端

```bash
# 方式1: GitHub Actions 自动部署（推荐）
# 推送代码到 main 分支自动触发

# 方式2: 手动部署
cd /opt/maozi-rps/server
# 上传 dist/ 和 package.json
npm install --production
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

SQLite 数据默认保存到 `/opt/maozi-rps/server/data/maozi-rps.db`。该目录不能随发布流程删除，建议定期备份数据库文件。

### 3. 部署 Web 前端

```bash
# 构建
cd client
npx expo export --platform web

# 上传 web-build 到服务器
scp -r web-build/* root@你的服务器IP:/opt/maozi-rps/web/

# 配置 Nginx
cp nginx.conf /etc/nginx/sites-available/maozi-rps
ln -sf /etc/nginx/sites-available/maozi-rps /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 4. 验证

```bash
# 检查后端
curl http://localhost:60205/api/health

# 检查 PM2
pm2 status
pm2 logs maozi-rps-server

# 检查 Nginx
curl -I http://localhost:60200
```

## 访问地址

- Web 前端: http://你的服务器IP:60200
- 后端 API: http://你的服务器IP:60205/api
- WebSocket: ws://你的服务器IP:60205/ws
