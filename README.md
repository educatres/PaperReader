# PaperReader

[開啟 PaperReader](https://educatres.github.io/PaperReader/) · [GitHub](https://github.com/educatres/PaperReader)

繁體中文的私人研究工作台：**讀 PDF → 選字標記 → 來源便條 → 翻譯與摘要 → 知識白板 → 可攜備份**。

純前端，可直接部署 GitHub Pages。沒有登入、遠端資料庫、分析追蹤或代管 API 代理。

## 使用

1. 開啟網站，匯入 PDF，或點「先試讀一篇範例」。
2. 螢光筆模式下跨行選字，放開滑鼠就會建立一組標記與便條。跨頁請分開標記。
3. 拖曳便條標題整理白板；從四邊的連接點拖到另一張卡片，建立人工研究關係。雙擊連線可修改。
4. 點「連接你的 AI」，選擇 OpenAI、CGU API 或 Google Gemini，貼上自己的 API key，再選擇模型與測試連線。OpenAI／CGU 可直接選 `gpt-6-luna`、`gpt-5.6-luna`，或輸入自訂模型 ID；推理程度可選低／中／高，預設為中。
5. 點便條翻譯／摘要，或確認全文摘要的文字傳送範圍。
6. 定期匯出 `.researchpack`，包含 PDF、標記、筆記、連線與視角。從文獻庫可還原。
7. 文件列右側可「隱藏工具列」以增加閱讀空間；按同一位置的「展開工具列」可恢復。收合狀態會記住，手機版以箭頭圖示操作。

CGU 的 Base URL 為 `https://air.cgu.edu.tw/cgullmapi/v1`，使用 Bearer 授權與 Responses API。**2026-10-18 實測，CGU 的 CORS 預檢拒絕 `https://educatres.github.io` 與 `http://localhost:5173` 來源（`Disallowed CORS origin`）**；需要 CGU 閘道管理員將使用中的網站來源加入允許清單，瀏覽器才能直接連線。本站不使用第三方代理傳送金鑰。模型是否開放、支援哪些推理程度，仍以帳戶權限與供應商為準；Gemini 沿用模型自身的推理預設。

## 隱私與本機儲存

| 資料 | 保存方式 |
| --- | --- |
| PDF 原檔 | 此瀏覽器的 IndexedDB |
| 文字索引、標記、便條、關係、白板視角、可接續摘要 | 此瀏覽器的 IndexedDB |
| 模型 ID、推理程度、工具列狀態、介面設定、閱讀頁碼 | 此瀏覽器的 localStorage，沒有金鑰 |
| API key | **只存在目前分頁的 JavaScript 記憶體** |

金鑰不寫入 localStorage、sessionStorage、IndexedDB、檔案、GitHub、備份或伺服器；重新整理／關閉分頁後清除。API 呼叫直接由瀏覽器傳至使用者選定的官方供應商，金鑰必須透過 HTTPS 授權標頭傳給該供應商驗證。不存在「金鑰完全不離開電腦但仍呼叫雲端 API」的模式。

- 翻譯／段落摘要只傳送該便條原文，沒有原文時使用該便條的人工筆記。
- 全文摘要先取得明確同意，再傳送**當前 PDF 的分塊文字**。不傳送原始 PDF、其他文獻或整個工作區。
- OpenAI／CGU 使用 Responses API，設 `store: false` 與 `reasoning.effort`；此設定不取代供應商的資料處理與保留政策。Gemini 使用 `generateContent`，不傳送 OpenAI 專用推理參數。
- PDF、便條與 AI 回應都作為不可信內容處理。模型沒有工具權限，回應以 React 文字呈現，不執行 HTML。
- 所有 JavaScript、PDF worker、字型、CJK 字元映射及 WebAssembly 隨網站提供，沒有第三方 CDN。CSP 限制連線至同源、OpenAI、CGU 與 Gemini API 網域。
- 模型清單由官方接口取得；清單可見不代表具備文字任務權限，請測試。使用者承擔供應商計費。
- 瀏覽器金鑰輸入適用於個人 BYOK 使用。請使用可信電腦、瀏覽器與擴充功能；應用程式更新與同源執行的程式碼仍屬信任邊界。

**GitHub Pages 網址不是 localhost。** 網站程式在使用者瀏覽器執行；本機資料屬於 `https://educatres.github.io` 這個網站來源。若改用下方本機指令，資料屬於 `http://127.0.0.1:5173`，兩者不共用；請用研究封裝搬移。清除網站資料、瀏覽器重置或儲存空間遭回收都可能遺失資料，IndexedDB 不能取代下載備份。

## 已實作

- 多 PDF 文獻庫、SHA-256 重複文件辨識、拖放匯入。
- PDF.js 連續閱讀、按可見範圍渲染、縮放、旋轉、跳頁、逐頁文字搜尋。
- 四色螢光筆；保存文件座標、文字範圍、引用上下文與文字雜湊。縮放時重建文字錨點，保存正規化矩形作為後援。
- 一次有效選取建立一組標記／便條，單筆 IndexedDB 快照保證原子性。PDF ↔ 便條雙向定位。
- 無邊際白板、卡片拖曳與調整寬度、收合、自由筆記、標籤搜尋、Shift 多選、連線、方向與關係標籤、小地圖、復原／重做。
- 分開保存原文、可編輯翻譯、可編輯 AI 摘要與人工筆記。只隱藏卡片與刪除來源標記分開操作。
- OpenAI／CGU／Gemini 個別分頁金鑰、動態模型清單、指定模型選單、自訂模型 ID、推理程度、文字連線測試、取消及可理解錯誤。
- 長文 map-reduce 摘要、原始頁碼範圍、進度、分塊結果保存、中斷後接續。任務綁定送出時的供應商、模型與推理程度；舊備份缺少推理設定時以中接續。
- Markdown、帶 schemaVersion 的 JSON、`.researchpack` ZIP 封裝匯入匯出；驗證結構、關聯、大小、路徑、PDF SHA-256。
- 完整載入並完成 Service Worker 快取後，可離線重新開啟閱讀與編輯。AI 須連網。新版本不強制重新整理研究中的分頁。
- 桌面分割視窗、可拖曳比例、可收合的頂部工具列、窄螢幕閱讀／白板切換、鍵盤操作及原生 dialog 焦點限制。

## 本機開發

使用 **Node.js 24 或更新版本**。目前的 PDF.js 要求較新的 Node，Windows 舊版 Node 的打包工具也可能異常退出。

```sh
npm ci
npm run dev
```

開啟 `http://127.0.0.1:5173`。開發與預覽伺服器都只綁定 `127.0.0.1`。Windows PowerShell 若禁止 `npm.ps1`，請改用 `npm.cmd ci`、`npm.cmd run dev`，不必調低系統執行原則。

```sh
npm test
npm run build
npm run preview
```

建置結果位於 `dist/`。`base: './'` 適用 GitHub Pages 專案子路徑。Vite 設定會自動複製本機 PDF.js 資源至 `public/pdfjs/`；此產物不納入 Git。

## GitHub Pages

儲存庫為 `educatres/PaperReader`，發布網址為 <https://educatres.github.io/PaperReader/>。

在 Repository → Settings → Pages，將 Source 設為 **GitHub Actions**。推送 `main` 後，`.github/workflows/deploy.yml` 會執行安裝、單元測試、型別檢查、建置及發布。**不用設定任何 API key 或 GitHub Secret。**

## 驗證

```sh
npm test
npm run test:e2e
```

瀏覽器測試預設使用已安裝的 Microsoft Edge。其他系統可將 `playwright.config.ts` 的 `channel` 改成 `chromium` 並安裝 Playwright Chromium。可透過 `TEST_BASE_URL` 測試既有部署，例如 GitHub Pages 子路徑。

測試涵蓋跨行標記、縮放與旋轉、持久化與雙向定位、人工筆記與連線、封裝備份／還原、三個供應商的 API 格式、模型選單與推理參數、429／連線失敗恢復、金鑰不落盤、長文摘要重新整理後以原推理設定接續、舊設定遷移、工具列收合與窄螢幕展開、離線還原、20 頁雙欄 PDF 按需渲染及掃描 PDF 提示。API 測試使用攔截回應，**不會讀取私人金鑰或產生真實 API 費用**。

## 限制

- 目前不包含 OCR、原始 PDF／圖像輸入、AI 自動推薦關係、簡報／白板圖像輸出、多人協作與跨裝置同步。
- 掃描 PDF 可閱讀，但無文字層就無法精準標註。密碼 PDF 請先解除保護。
- 雙欄、圖表、公式的文字擷取可能不完整。摘要頁碼表示分塊來源範圍，**不是經查證的逐句引用**。
- 單份 PDF 上限 150 MB；匯入封裝壓縮檔上限 200 MB、解壓總量上限 300 MB；JSON 上限 30 MB。可攜封裝最多 50 份文件。
- JSON 只有註記與文件 metadata，缺少 PDF 時須附加同一原檔。Markdown 是閱讀輸出；重新還原請用 JSON 或 researchpack。
- 用量顯示為供應商回傳的最後一次回應 tokens；不是全文所有分塊、重試與整合的總帳單。全文開始前的 tokens 數為粗估。
- 已在 Edge Chromium 驗證；Firefox、Safari 仍需進一步測試。

## 專案結構

```text
src/components/   PDF 閱讀器、白板、研究便條、AI 設定與對話框
src/lib/          PDF 載入、錨定、API adapters、IndexedDB、封裝驗證
src/store.ts      原子資料快照、自動保存、歷史與雙向定位
src/types.ts      版本化資料模型
tests/            核心資料與瀏覽器驗收測試
public/           本機範例 PDF、圖示與建置時複製的 PDF.js 資源
```

原始規劃見 `PDF_AI_Research_Canvas_系統規格書_v1.0.md`。為配合 GitHub Pages，本版採純前端直連供應商，取代草案中的常駐 Node API 代理，並將金鑰保存縮限為分頁記憶體。

介接參考：[OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create)、[OpenAI Models](https://developers.openai.com/api/reference/resources/models/methods/list)、[Gemini generateContent](https://ai.google.dev/api/generate-content)、[Gemini Models](https://ai.google.dev/api/models)。第三方授權見 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
