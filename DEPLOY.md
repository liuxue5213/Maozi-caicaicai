# 部署指南

## 服务器信息

- **IP**: 120.48.13.152
- **SSH**: `ssh root@120.48.13.152` (端口 120)
- **密码**: liuxue5213

## 端口分配

| 服务 | 端口 | 说明 |
|------|------|------|
| Web 前端 | 60200 | Nginx 静态文件 + 反向代理 |
| 后端 API + WebSocket | 60205 | Node.js 服务器 |

## 快速部署

### 1. 服务器初始化

```bash
# SSH 登录
ssh root@120.48.13.152

# 安装 Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 安装 PM2
npm install -g pm2

# 安装 Nginx
apt-get install -y nginx

# 创建目录
mkdir -p /opt/maozi-rps/server /opt/maozi-rps/web /var/log/maozi-rps
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

### 3. 部署 Web 前端

```bash
# 构建
cd client
npx expo export --platform web

# 上传 web-build 到服务器
scp -P 120 -r web-build/* root@120.48.13.152:/opt/maozi-rps/web/

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

- Web 前端: http://120.48.13.152:60200
- 后端 API: http://120.48.13.152:60205/api
- WebSocket: ws://120.48.13.152:60205/ws
