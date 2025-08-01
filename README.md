# 🔗 URL Shortener

一个基于 Cloudflare Workers 构建的快速、可扩展的短链接服务。

## ✨ 核心功能

- **🔗 URL 短链生成**: 将长链接转换为短链接
- **📝 描述标注**: 为每个链接添加描述便于管理
- **📊 访问统计**: 跟踪重定向次数和访问时间
- **🔍 搜索功能**: 通过描述搜索链接
- **🌐 API 支持**: 完整的 REST API
- **⚡ 边缘计算**: 运行在 Cloudflare 全球边缘网络
- **🎨 Web 界面**: 现代化响应式界面

## 🚀 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) (v18+)
- [Cloudflare 账户](https://dash.cloudflare.com/sign-up)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

### 安装部署

1. **克隆项目**
   ```bash
   git clone <your-repo-url>
   cd shortURL
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **创建 KV 存储**
   ```bash
   npx wrangler kv:namespace create "URLS"
   npx wrangler kv:namespace create "URLS" --preview
   ```

4. **更新配置**
   
   在 `wrangler.jsonc` 中更新 KV namespace ID:
   ```json
   {
     "kv_namespaces": [
       {
         "binding": "URLS",
         "id": "your-production-kv-id",
         "preview_id": "your-preview-kv-id"
       }
     ]
   }
   ```

5. **部署**
   ```bash
   npm run deploy
   ```

## 🛠️ 开发

### 本地开发
```bash
npm run dev
```

### 运行测试
```bash
npm test
```

## 📖 API 文档

### 创建短链接
**POST** `/api/urls`

```json
{
  "url": "https://example.com/very-long-url",
  "description": "链接描述"
}
```

### 获取链接列表
**GET** `/api/urls`

查询参数:
- `limit`: 返回数量 (默认: 50)
- `cursor`: 分页游标

### 搜索链接
**GET** `/api/urls/search?q=关键词`

### 获取统计信息
**GET** `/api/urls/stats?code=短码`

### 重定向
**GET** `/{shortCode}`

## 🎨 Web 界面

访问根路径即可使用 Web 界面:
- 创建短链接
- 查看最近链接
- 搜索历史记录
- 查看访问统计

## 🔧 配置

### 数据结构

```typescript
interface UrlRecord {
  originalUrl: string;      // 原始链接
  shortCode: string;        // 短码
  description: string;      // 描述
  createdAt: number;        // 创建时间
  redirectCount: number;    // 重定向次数
  lastAccessed?: number;    // 最后访问时间
}
```

### 自定义配置

- **短码生成**: 修改 `generateShortCode()` 函数
- **界面样式**: 修改 `serveMainPage()` 中的 CSS
- **验证规则**: 更新 URL 验证和描述长度规则

## 📝 许可证

MIT License

## 🆘 支持

如遇问题请查看:
1. [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
2. 项目测试用例
3. GitHub Issues