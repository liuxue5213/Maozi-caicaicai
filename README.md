# 帽子猜猜猜 App ✊✌️✋

一个支持联网实时匹配和人机对战的猜拳游戏。Web 端和 App 端共享同一用户体系，可跨平台对战。

## 项目结构

```
maozi-rps/
├── client/          # React Native + Expo (App + Web)
├── server/          # Node.js 后端 (Express + WebSocket)
├── shared/          # 共享类型和常量
└── .github/         # GitHub Actions CI/CD
```

## 功能特性

- ✅ 账号注册/登录系统 (JWT)
- ⚡ 联网真人实时匹配对战
- 🤖 AI 人机对战
- 🏆 排行榜（胜场榜/连胜榜）
- 🎖️ 称号系统（每200场一个新称号）
- 🌐 Web + App 跨平台数据互通
- 📱 适配 iOS / Android

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React Native + Expo + TypeScript |
| 后端 | Node.js + Express + ws |
| 通信 | WebSocket (实时) + REST API |
| 构建 | GitHub Actions |

## 快速开始

### 环境要求

- Node.js 20+
- npm 或 yarn

### 安装

```bash
# 安装所有依赖
npm install

# 构建 shared 包
cd shared && npm install && npm run build

# 启动后端
cd ../server
npm install
npm run dev

# 启动前端 (新终端)
cd ../client
npm install
npm run web     # Web 开发
npm run android # Android 开发
```

### 配置

后端环境变量（`server/.env`）：
```
PORT=60205
JWT_SECRET=请修改为强密钥
```

前端环境变量（`client/.env`）：
```
EXPO_PUBLIC_API_URL=http://你的服务器IP:60205/api
EXPO_PUBLIC_WS_URL=ws://你的服务器IP:60205/ws
```

## 服务器部署

```bash
# 后端
cd server
npm install
npm run build
npm start
# 或 PM2: pm2 start dist/index.js --name maozi-rps-server

# Web 前端 (Nginx 部署)
cd client
npx expo export --platform web
# 将 web-build/ 目录放到 Nginx
```

## GitHub Actions 自动构建

推送到 `main` 分支自动触发：
- 自动构建 debug APK
- 上传构建产物到 GitHub Releases

### 配置 Secrets

在 GitHub 仓库 Settings → Secrets 中添加：

| Secret | 说明 |
|--------|------|
| `API_URL` | 后端 API 地址 |
| `WS_URL` | WebSocket 地址 |
| `ANDROID_KEYSTORE_BASE64` | Android 签名文件 (Base64) |
| `ANDROID_KEYSTORE_PASSWORD` | 签名密码 |
| `ANDROID_KEY_ALIAS` | 签名别名 |
| `ANDROID_KEY_PASSWORD` | 签名密钥密码 |
| `SERVER_HOST` | 服务器 IP |
| `SERVER_USER` | SSH 用户名 |
| `SERVER_PASSWORD` | SSH 密码 |

## 端口分配

| 服务 | 端口 |
|------|------|
| Web 前端 | 60200 |
| 后端 API + WebSocket | 60205 |
- 用户: root
