# AI Interior Pro (Next.js)

AI Interior Pro 是面向室內設計產業的 AI 營運平台，主打：

- AI 空間渲染與視覺提案生成
- 社群發文與社群短影音生成
- CRM + 專案管理 + 報價流程（管理為輔）

---

## 本機啟動

1. 安裝依賴

   ```bash
   npm install
   ```

2. 啟動開發模式（http://localhost:3000）

   ```bash
   npm run dev
   ```

## 正式環境驗證

```bash
npm run build
npm run start
```

---

## 第三方登入（OAuth）

專案已串接 NextAuth（`/api/auth/*`），登入頁會自動偵測已啟用 provider。

### 必要環境變數

```bash
AUTH_SECRET=replace_with_a_long_random_secret
```

### Google（建議先啟用）

```bash
AUTH_GOOGLE_ID=your_google_oauth_client_id
AUTH_GOOGLE_SECRET=your_google_oauth_client_secret
```

### 可選：Facebook / Apple

```bash
AUTH_FACEBOOK_ID=your_facebook_app_id
AUTH_FACEBOOK_SECRET=your_facebook_app_secret

AUTH_APPLE_ID=your_apple_service_id
AUTH_APPLE_SECRET=your_apple_client_secret
```

回呼網址請在各平台設定：

- `https://your-domain/api/auth/callback/google`
- `https://your-domain/api/auth/callback/facebook`
- `https://your-domain/api/auth/callback/apple`

---

## AI 空間渲染（Google AI Studio / Vertex AI）

已完成真實 API 串接，流程為：

1. 前端上傳空間原圖（或線稿）/ 參考風格圖與參數
2. 呼叫 `POST /api/ai/render`
3. 由後端呼叫 Gemini 影像模型生成渲染圖
4. 可選擇呼叫 `POST /api/ai/refine` 做 AI 細節修復
5. 可選擇呼叫 `POST /api/ai/upscale` 做 2x 高清增強
6. 回傳渲染結果與建議說明到介面

### AI Provider 環境變數

```bash
# 可省略；若偵測到 Vertex 參數會自動切到 vertex
# GOOGLE_AI_PROVIDER=aistudio | vertex

# --- Google AI Studio ---
GEMINI_API_KEY=your_real_api_key

# --- Vertex AI（建議）---
VERTEX_AI_PROJECT_ID=your_gcp_project_id
VERTEX_AI_LOCATION=us-central1

# Vertex 憑證二選一：
# 1) API Key
# VERTEX_API_KEY=your_vertex_api_key
# 2) Service Account / Workload Identity
# GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

可選：

```bash
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image-preview
```

---

## 社群短影音生成（Video Studio）

已完成可運行版本：

- 圖轉影（Image to Video）  
  - 預設使用 **Veo 影片模型**（真實 image-to-video）
  - API 流程：`/api/ai/video/generate` → `/api/ai/video/status` → `/api/ai/video/download`
  - 可選運鏡與空間風格模板
  - 可選 AI 關鍵幀增強、AI 畫面延展
  - 可切換模型與輸出解析度（720p / 1080p）
- 影轉影（Video to Video）  
  - 對既有空間素材做風格化輸出
- 支援下載生成影片（Veo 路徑為 MP4）

必要環境變數（與上方 AI Provider 共用）：

```bash
# AI Studio 模式
GEMINI_API_KEY=your_key

# 或 Vertex 模式
VERTEX_AI_PROJECT_ID=your_gcp_project_id
VERTEX_AI_LOCATION=us-central1
# VERTEX_API_KEY=your_vertex_api_key
# (或) GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

可選：

```bash
REPLICATE_VIDEO_MODEL=xai/grok-imagine-video
```

---

## 社群發文（Marketing Center）

提供 AI 社群貼文流程：

- 一鍵生成貼文主題、標題、內文、Hashtags
- 多平台排程（Instagram / Facebook）
- 草稿管理與手機端視覺預覽
- AI 短影音腳本（Hook、鏡位、口播）生成

---

## CRM + 室內設計專案管理 + 報價

已改為後端持久化，不再使用固定假資料：

- 可在「新增專案」建立室內設計案件（可綁定 CRM 客戶）
- 專案詳情可編輯狀態/階段/預算/註記，可封存/取消封存、永久刪除
- 封面圖可直接上傳（沿用 `POST /api/crm/upload`）
- 支援「同步註記到 LINE CRM」

專案 API 端點：

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:projectId`
- `PATCH /api/projects/:projectId`
- `DELETE /api/projects/:projectId`
- `POST /api/projects/:projectId/archive`
- `DELETE /api/projects/:projectId/archive`
- `POST /api/projects/:projectId/sync-crm-note`

CRM API 端點：

- `GET /api/crm/contacts`
- `GET /api/crm/messages?contactId=...`
- `POST /api/crm/messages`
- `POST /api/crm/upload`
- `PUT /api/crm/settings/line`
- `POST /api/line/webhook`

---

## 部署方式

### 1) Vercel（最簡單）

1. 將專案推送到 GitHub
2. 到 Vercel 匯入該 repository
3. Framework Preset 確認為 `Next.js`
4. Output Directory 留空
5. Build Command 使用 `npm run build`
6. Start Command 使用 `npm run start`

### 2) 任意 Node.js 主機

```bash
npm ci
npm run build
npm run start
```

預設服務埠為 `3000`。

### 3) Docker

```bash
docker build -t ai-interior-pro .
docker run -p 3000:3000 ai-interior-pro
```

---

## 重要：Vercel 正式環境資料持久化

若部署在 Vercel，建議安裝 Redis（Upstash）Integration，並設定以下環境變數：

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

（舊版 `KV_REST_API_URL / KV_REST_API_TOKEN` 也可相容）

### 社群媒體庫（圖片/影片）持久化注意

`/api/social/assets` 現在會優先使用 Redis 作為儲存後端。  
如果沒有設定 Redis，會退回檔案系統（Vercel 上通常是暫存空間），部署或實例切換後歷史可能遺失。

可選自訂 key：

- `SOCIAL_ASSET_REDIS_KEY`（預設：`social:assets:store:v2`）
- `SOCIAL_ASSET_REDIS_DATA_PREFIX`（預設：`social:assets:data:v2:`）

### LINE OA 串接（每個使用者獨立設定）

平台模式下，LINE OA 憑證會依「登入使用者」分開儲存：

- 每位使用者可在 CRM 的「LINE OA 串接設定」填入自己的 Channel ID / Token / Secret
- 重新登入後會自動載入該使用者自己的設定，不需要每次重填
- Webhook URL 會附帶 `userId` 參數，讓不同使用者的 OA 事件可正確路由
