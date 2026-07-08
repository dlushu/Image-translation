# Image-translation

基于 Cloudflare Workers 的图片翻译 API 服务，调用百度 AI 图片翻译接口，支持将图片中的文字翻译为目标语言并渲染回图片。

## 功能特性

- 支持 **图片 URL** 或 **Base64 编码** 两种方式上传图片
- 自动识别源语言（支持手动指定 `from` 参数）
- 翻译结果以 Base64 图片形式返回（`pasteImg` 渲染模式）
- 支持多种 Content-Type（JSON、FormData、自动检测）
- 可选的 Bearer Token 认证机制
- 内置百度 AI access_token 管理，支持 KV 缓存
- CORS 跨域支持

## 架构

```
客户端 → Cloudflare Worker → 百度 AI 图片翻译 API
                ↕
          KV Namespace (token 缓存)
```

## 快速开始

### 1. 安装 Wrangler

```bash
npm install -g wrangler
```

### 2. 配置环境变量

在 Cloudflare Dashboard 或使用 `wrangler secret put` 设置以下密钥：

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `BAIDU_API_KEY` | 是 | 百度 AI 开放平台 API Key |
| `BAIDU_SECRET_KEY` | 是 | 百度 AI 开放平台 Secret Key |
| `REQUIRE_AUTH` | 否 | 设为 `"true"` 启用接口认证 |
| `API_TOKEN` | 否 | 当启用认证时的 Bearer Token |

### 3. 创建 KV 命名空间（可选，用于缓存 token）

```bash
wrangler kv:namespace create "BAIDU_TOKEN_CACHE"
```

将输出的 `id` 配置到 `wrangler.toml` 中。

### 4. 部署

```bash
wrangler deploy
```

## API 文档

### 接口地址

```
POST https://your-worker.workers.dev/
```

### 请求方式

**方式一：JSON 格式**

```json
{
  "image_url": "https://example.com/image.png",
  "from": "auto",
  "to": "zh"
}
```

**方式二：Base64 格式**

```json
{
  "image_base64": "iVBORw0KGgo...",
  "from": "en",
  "to": "zh"
}
```

### 请求参数

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `image_url` / `imageUrl` / `url` | 三选一 | - | 图片 URL 地址 |
| `image_base64` / `imageBase64` / `base64` | 三选一 | - | 图片 Base64 编码（支持 data URL 前缀） |
| `from` | 否 | `auto` | 源语言（如 `en`、`ja`、`zh`） |
| `to` | 否 | `zh` | 目标语言 |

**认证请求头**（启用认证时必传）：

```
Authorization: Bearer <your-api-token>
```

### 成功响应

```json
{
  "success": true,
  "paste_img": "iVBORw0KGgo...",
  "api_detail": {
    "from": "en",
    "to": "zh"
  }
}
```

### 错误响应

```json
{
  "success": false,
  "error": "错误类型",
  "detail": "详细错误信息"
}
```

## 项目结构

```
Image-translation/
├── _worker.js      # Cloudflare Worker 入口文件
├── wrangler.toml   # Wrangler 配置文件
└── README.md       # 项目说明文档
```

## 技术细节

- **运行时**: Cloudflare Workers (ES Modules 格式)
- **图片下载超时**: 15 秒（通过 AbortController 控制）
- **Token 有效期**: 约 30 天（2591000 秒），自动缓存在 KV 中
- **翻译模式**: 调用百度 AI 图片翻译 v3 接口，启用 `paste` 渲染模式

## 许可

MIT License
