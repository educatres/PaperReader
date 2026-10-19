# PaperReader

[開啟 PaperReader](https://educatres.github.io/PaperReader/) · [GitHub](https://github.com/educatres/PaperReader)

[使用指引（PPTX，含範例操作截圖）](docs/PaperReader_使用指引.pptx) · [AI Agent 專案交接文件](交接文件.md)

繁體中文的私人研究工作台：**讀 PDF → 選字標記 → 來源便條 → 翻譯與摘要 → 知識白板 → 可攜備份**。

前端可直接部署 GitHub Pages，CGU 另提供自行在電腦執行的 localhost 連線助手。沒有登入、遠端資料庫、分析追蹤或代管 API 代理。

## 使用

1. 開啟網站，匯入 PDF，或點「先試讀一篇範例」。
2. 螢光筆模式下跨行選字，放開滑鼠就會建立一組標記與便條。跨頁請分開標記。
3. 拖曳便條標題整理白板；從四邊的連接點拖到另一張卡片，建立人工研究關係。雙擊連線可修改。
4. 點「連接你的 AI」，選擇 OpenAI、CGU API、Google Gemini 或 mercuryapi，貼上自己的 API key，再選擇模型與測試連線。OpenAI／CGU 可直接選 `gpt-6-luna`、`gpt-5.6-luna`，或輸入自訂模型 ID；推理程度可選低／中／高，預設為中。
5. 點便條翻譯／摘要，或確認全文摘要的文字傳送範圍。
6. 定期匯出 `.researchpack`，包含 PDF、標記、筆記、連線與視角。從文獻庫可還原。
7. 文件列右側可「隱藏工具列」以增加閱讀空間；按同一位置的「展開工具列」可恢復。收合狀態會記住，手機版以箭頭圖示操作。
8. 點選一張已連線的便條，再按白板上方「關聯摘要」，或便條選單的「摘要這組關聯」。預覽這組便條與連線後確認，即可生成不同風格的紫色整合便條。
9. PDF 工具列選「截圖模式」，在單頁內拖曳框選，放開即建立截圖便條；Esc 取消。點圖片可放大，點「輸入或貼上文字」填入自己的內容。

### PDF 截圖便條

框選只擷取 PDF 畫布，不含螢光標記或介面，支援目前的縮放、旋轉與螢幕像素比例。單次限同一頁，過小的框選、取消操作不建立便條。截圖保留來源頁碼與未旋轉頁面的正規化區域，右下箭頭可回到原頁框選位置。

新便條的文字與筆記**完全留白**，由使用者自行輸入或貼上；不執行 OCR，也不自動擷取框內 PDF 文字。圖片便條可移動、調整寬度、收合、改標題、連線、隱藏、刪除及復原／重做。

**圖片不作 AI 分析。** 單張便條翻譯／摘要只傳送自行填入的文字與筆記，沒有文字時停用。關聯摘要沿用文字與連線屬性，圖片未提供且無文字的便條會標記內容缺失；整組都沒有文字時不發出請求。程式明確列出可傳送的文字欄位，不傳送圖片二進位、Base64、Blob URL、附件 ID 或圖片附件。

PNG Blob 保存在此瀏覽器的 IndexedDB，單張上限 20 MB。完整 `.researchpack` 包含圖片並驗證 SHA-256、PNG 檔頭、尺寸及大小；JSON 只保存文字、來源與附件資訊，Markdown 只輸出文字及來源說明。從 JSON 還原但本機沒有圖片時，顯示缺圖提示，文字仍可使用。完整圖片請使用研究封裝搬移。為支援復原，刪除便條後圖片保留至下次開啟網站；啟動時清理未被目前便條引用的圖片。清除本機資料會一併刪除圖片。

### 關聯便條摘要

摘要範圍為選取便條所屬的連通群組，包含直接與間接連線，排除已隱藏的便條及其連線。群組可跨不同 PDF，至少需要兩張相連便條。箭頭方向不限制尋找群組，但會原樣交給 AI 分析。

AI 會收到這組便條的原文、既有翻譯／摘要、人工筆記、標籤、來源文件名稱與頁碼，以及每條連線的**關係類型、補充說明、來源／目標與方向**。提示要求整合共同主題、保留對比與矛盾、區分延伸與待驗證事項，並以 `[N1]` 便條代號及 `[R1]` 關係代號回查來源。人工連線不代表事實已獲證實，AI 結果仍需自行核對。

紫色摘要便條可編輯、移動、收合、加入筆記及備份，來源按鈕可跳回各便條。「來源快照」保留生成當時的內容與連線；來源後續修改不會自動更新摘要，可按「再次整合」預覽目前群組並生成另一張摘要。刪除來源後，歷史快照仍保留，對應來源按鈕停用。摘要便條不自動新增研究關係線。

每次整合執行一個生成請求，使用目前設定的供應商、模型與推理程度，執行中可取消。單次輸入上限為 60,000 字元（含結構與標籤）；超過時請拆分群組或縮短內容，程式不會自動截斷。取消或失敗不會新增空白便條，可重新執行。金鑰沿用分頁記憶體保存方式。

### mercuryapi 連線

Base URL 為 `https://air.cgu.edu.tw/mercuryapi/v1`。在「連接你的 AI → mercuryapi」填入自己的 API key，按「使用此金鑰」即自動查詢可用模型，並保留仍可用的既有選擇，否則選用清單第一個模型。可從下拉選單更換、手動輸入模型 ID，或按「自動偵測模型」重新查詢；清單為空時會提示確認模型權限。

模型偵測只查詢 `/models`；「測試連線」使用所選模型送出一則簡短的 Responses 文字請求，會產生少量用量。翻譯與摘要也使用此設定。金鑰只暫存分頁記憶體，重新整理後需重新輸入；供應商與模型選擇會保留。金鑰取得與帳戶權限請參考 [mercuryapi 官方說明](https://air.cgu.edu.tw/mercuryapi/)。

### CGU 連線

依 [CGU 官方文件](https://air.cgu.edu.tw/workspace4/LLMAPI/api_call.html)，Base URL 為 `https://air.cgu.edu.tw/cgullmapi/v1`，使用 `Authorization: Bearer 金鑰` 與 Responses API。請先到 [CGU API Key 頁面](https://air.cgu.edu.tw/workspace4/LLMAPI/index.php) 啟用、複製金鑰。可直接貼上純金鑰，或包含 `Bearer`／`Authorization: Bearer` 前綴。

**2026-10-18 實測，CGU 的 CORS 預檢拒絕 GitHub Pages 與本機開發來源（`Disallowed CORS origin`）**。預設使用自己的 localhost 助手：

1. 安裝 [Node.js 24 或更新版本](https://nodejs.org/en/download)。
2. 在「連接你的 AI → CGU API」下載 [本機助手](https://educatres.github.io/PaperReader/PaperReader-CGU-Bridge.mjs)。
3. 在下載檔案所在的資料夾開啟終端機，執行 `node PaperReader-CGU-Bridge.mjs`，保持視窗開啟。已有專案的開發者可執行 `npm run cgu:bridge`（PowerShell 可用 `npm.cmd run cgu:bridge`）。
4. 複製終端機顯示的 Pairing code，貼到設定中的「本機助手連線碼」，按「連接本機助手」。若瀏覽器詢問本機網路權限，請允許。
5. 貼上自己的 CGU API key，按「驗證 CGU 金鑰」。此步只呼叫 `/models`，不送出文字生成。再選模型與推理程度，按「測試連線」進行少量用量的 Responses 文字測試。

助手僅綁定 `127.0.0.1:43127`，每次啟動隨機產生連線碼，只接受 PaperReader 的 GitHub Pages 來源及 localhost／127.0.0.1 的 5173、4173 開發來源；不接受任意轉送網址。連接埠被占用時，關閉先前的助手再重啟。按 Ctrl+C 停止。重新整理網站須重填金鑰與連線碼，重啟助手須複製新的連線碼。

連線助手不寫金鑰檔、不使用環境變數保存金鑰、不記錄請求或金鑰。金鑰僅經本機 HTTP loopback 的請求記憶體，再以 HTTPS 傳給固定的 CGU 官方 API。助手只允許健康檢查、模型清單及非串流 Responses，不轉送 Cookie 或連線碼至 CGU，不使用第三方代管代理。請在可信任的私人電腦使用；同機程式及同來源程式碼仍屬信任邊界。

設定仍可選「瀏覽器直接連線」，但須由 CGU 管理員允許目前網站來源的 CORS。401 表示金鑰驗證失敗；403 也可能是模型權限或 Token／美元額度；404 應確認模型及 Responses 端點支援。自訂模型須支援 Responses，僅支援 Chat Completions 的模型目前不適用。模型是否開放、支援哪些推理程度，以帳戶權限與供應商為準；Gemini 沿用模型自身的推理預設。

## 隱私與本機儲存

| 資料 | 保存方式 |
| --- | --- |
| PDF 原檔 | 此瀏覽器的 IndexedDB |
| PDF 框選截圖 | 此瀏覽器的 IndexedDB，獨立 PNG Blob |
| 文字索引、標記、便條、關係、白板視角、可接續摘要 | 此瀏覽器的 IndexedDB |
| 模型 ID、推理程度、CGU 連線方式、工具列狀態、介面設定、閱讀頁碼 | 此瀏覽器的 localStorage，沒有金鑰 |
| API key、助手連線碼 | **只暫存目前分頁記憶體；CGU 助手請求期間也會經過其記憶體** |

金鑰不寫入 localStorage、sessionStorage、IndexedDB、檔案、GitHub 或備份；重新整理／關閉分頁後清除。CGU 本機模式經自己的助手記憶體轉送，其餘直接由瀏覽器傳至所選供應商。呼叫雲端 API 時，金鑰須以 HTTPS 授權標頭傳給官方供應商驗證。

已暫存的 API Key 在設定中以 `***` 表示；按「清除本機 API Key」可立即清除目前供應商在本分頁記憶體中的金鑰及尚未套用的輸入，保留 PDF 與研究便條。其他供應商的金鑰分別管理。

Gemini 成功取得模型清單後，若可用文字模型中包含 `gemini-flash-lite-latest`，會預設選用它；若沒有，會清空模型選擇並提示自行選擇。可從模型選單選取或輸入自訂 ID；取得清單失敗時保留原先的模型選擇。

- 翻譯／段落摘要只傳送該便條原文，沒有原文時使用該便條的人工筆記。
- 截圖便條的翻譯／摘要使用自行輸入的文字與筆記，不傳送或分析圖片；建立截圖不觸發 AI。
- 關聯摘要確認後，只傳送預覽群組的便條文字與連線屬性，不傳送其他群組或原始 PDF。
- 全文摘要先取得明確同意，再傳送**當前 PDF 的分塊文字**。不傳送原始 PDF、其他文獻或整個工作區。
- OpenAI／CGU 使用 Responses API，設 `store: false` 與 `reasoning.effort`；此設定不取代供應商的資料處理與保留政策。Gemini 使用 `generateContent`，不傳送 OpenAI 專用推理參數。
- PDF、便條與 AI 回應都作為不可信內容處理。模型沒有工具權限，回應以 React 文字呈現，不執行 HTML。
- 所有 JavaScript、PDF worker、字型、CJK 字元映射及 WebAssembly 隨網站提供，沒有第三方 CDN。CSP 限制連線至同源、OpenAI、CGU、Gemini API 網域及固定的 `http://127.0.0.1:43127` 本機助手。
- 模型清單由官方接口取得；清單可見不代表具備文字任務權限，請測試。使用者承擔供應商計費。
- 瀏覽器金鑰輸入適用於個人 BYOK 使用。請使用可信電腦、瀏覽器與擴充功能；應用程式更新與同源執行的程式碼仍屬信任邊界。

**GitHub Pages 網址不是 localhost。** 網站程式在使用者瀏覽器執行；本機資料屬於 `https://educatres.github.io` 這個網站來源。若改用下方本機指令，資料屬於 `http://127.0.0.1:5173`，兩者不共用；請用研究封裝搬移。清除網站資料、瀏覽器重置或儲存空間遭回收都可能遺失資料，IndexedDB 不能取代下載備份。

## 已實作

- 多 PDF 文獻庫、SHA-256 重複文件辨識、拖放匯入。
- PDF.js 連續閱讀、按可見範圍渲染、縮放、旋轉、跳頁、逐頁文字搜尋。
- 四色螢光筆；保存文件座標、文字範圍、引用上下文與文字雜湊。縮放時重建文字錨點，保存正規化矩形作為後援。
- PDF 單頁框選截圖、圖片便條與放大預覽、留白文字、自行輸入／貼上、縮放及旋轉後回查框選位置、圖片本機儲存與完整備份。
- 一次有效選取建立一組標記／便條，單筆 IndexedDB 快照保證原子性。PDF ↔ 便條雙向定位。
- 無邊際白板、卡片拖曳與調整寬度、收合、自由筆記、標籤搜尋、Shift 多選、連線、方向與關係標籤、小地圖、復原／重做。
- 分開保存原文、可編輯翻譯、可編輯 AI 摘要與人工筆記。只隱藏卡片與刪除來源標記分開操作。
- OpenAI／CGU／Gemini 個別分頁金鑰、動態模型清單、指定模型選單、自訂模型 ID、推理程度、文字連線測試、取消及可理解錯誤。
- 長文 map-reduce 摘要、原始頁碼範圍、進度、分塊結果保存、中斷後接續。任務綁定送出時的供應商、模型與推理程度；舊備份缺少推理設定時以中接續。
- 關聯群組 AI 整合、關係類型／說明／方向、來源與關係代號、紫色摘要便條、可回查來源、歷史內容快照、取消與重試。
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

CGU 助手另測試真實 localhost HTTP 配對與轉送、HTTPS 網站的本機網路權限、Bearer 貼上格式、驗證／生成分流、401／403／404、模型未開放、助手離線、重新整理清除金鑰及連線碼、匯出不含憑證。助手單元測試限制 Origin／Host／路徑／方法／標頭、輸入大小、串流拒絕、編碼標頭、上游逾時與取消，不呼叫真實 CGU。

關聯摘要另驗證間接連通與循環、隱藏便條隔離、方向與關係類型保留、內容上限、紫色卡片與來源定位、復原／重做、備份還原、失敗／取消／重試，以及來源移除後的歷史快照相容性。

截圖測試包含實際裁切像素、縮放／旋轉／高像素密度、反向拖曳與頁面邊界、Esc／微小框選、文字留白、單張及混合群組純文字請求、全空白群組停用、圖片復原／重做、離線重載、封裝完整還原、缺圖／損毀拒絕及 JSON 缺圖提示。資料庫測試覆蓋舊版升級、附件生命週期與儲存失敗。

## 限制

- 目前不包含 OCR、向 AI 傳送原始 PDF／圖像、AI 自動推薦關係、簡報／白板圖像輸出、多人協作與跨裝置同步。
- 掃描 PDF 可閱讀，但無文字層就無法精準標註。密碼 PDF 請先解除保護。
- 雙欄、圖表、公式的文字擷取可能不完整。摘要頁碼表示分塊來源範圍，**不是經查證的逐句引用**。
- 單份 PDF 上限 150 MB；匯入封裝壓縮檔上限 200 MB、解壓總量上限 300 MB；JSON 上限 30 MB。可攜封裝最多 50 份文件。
- JSON 只有文字註記、文件與截圖 metadata，缺少 PDF 時須附加同一原檔，完整截圖需從 researchpack 還原。Markdown 是閱讀輸出；重新還原請用 JSON 或 researchpack。
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

原始規劃見 `PDF_AI_Research_Canvas_系統規格書_v1.0.md`。本版部署於 GitHub Pages，金鑰只暫存記憶體；因 CGU 的 CORS 限制，提供使用者自行啟動及配對的 localhost 助手，其餘供應商由前端直連。

介接參考：[OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create)、[OpenAI Models](https://developers.openai.com/api/reference/resources/models/methods/list)、[Gemini generateContent](https://ai.google.dev/api/generate-content)、[Gemini Models](https://ai.google.dev/api/models)。第三方授權見 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
