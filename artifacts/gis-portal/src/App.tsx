import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import { useRef, useState, useMemo, useCallback, useEffect } from 'react'
import * as THREE from 'three'
import { motion, AnimatePresence } from 'framer-motion'
import { CARD_HUE, COLOR, FONT_STACK } from './theme'
import './portal.css'

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const UNLOCK_KEY = 'portal_unlocked'

// Position pools — private sites go right side (+X), public sites go left side (-X)
const PRIVATE_POSITION_POOL: [number, number][] = [
  [4.0, 1.5], [5.5, 3.5], [3.5, -1.0], [6.0, -2.5],
  [4.5, 5.0], [2.5, 3.8], [5.0, 0.2], [6.5, 2.5],
]
const PUBLIC_POSITION_POOL: [number, number][] = [
  [-3.0, -1.5], [-5.0, 1.0], [-3.5, 3.5], [-4.5, -3.0],
  [-2.0, 2.5], [-5.5, -1.8], [-2.5, -3.5], [-4.0, 4.0],
]

// ─────────────────────────────────────────────
// Version History  (update this before each release)
// ─────────────────────────────────────────────
const VERSION_HISTORY = [
  {
    version: '1.31.1',
    date: '2026-08-21',
    summary: '修正 update.ps1 的 schema sync 步驟其實整段沒真的在運作',
    changes: [
      '這次部署 v1.31.0（score 欄位改 nullable 的 migration）時，HERMES 回報 update.ps1 的 schema sync 步驟要手動繞過才能過。查了才發現不是路徑打錯這麼單純：api-server 的 Dockerfile 執行階段（runtime stage）只有 COPY esbuild 打包後的單一 dist/index.mjs，完全沒有 node_modules、drizzle-kit、drizzle.config.ts，docker compose exec api-server npx drizzle-kit push 這個指令從一開始就不可能真的執行過，不管給的路徑對不對',
      '改回 docker-compose.yml 裡本來就完整定義好的 db-migrate service（docker compose --profile migrate run --build --rm db-migrate）——這個 service 用的是 Dockerfile 的 build 階段，有完整 pnpm workspace 跟 drizzle-kit，套用的是 lib/db/migrations/ 底下版本化的 SQL 檔案，這整個 session 生成的每一份 migration 檔案本來就是為了配合這套機制。之前改走 api-server exec 是為了繞開 db-migrate 曾經遇到的 ENOTFOUND "base" DNS 問題，但 exec 那條路根本沒真的通過，如果 DNS 問題還在，需要在正式主機上重新排查',
    ],
  },
  {
    version: '1.31.0',
    date: '2026-08-21',
    summary: '日記篇數改成每 10 分鐘自動更新，不用等 HERMES 每天跑一次的知識庫分數腳本',
    changes: [
      '心智指標的 dailyEngagementScore（日記篇數算出來、計入幸福指數的分數）原本規劃要讓 HERMES 的 daily-life-score.py 每天算一次，這次改成直接併進已經存在、每 10 分鐘跑一次的 services/hermes-status/collect.ps1——不新增腳本，單純多一段掃 NAS 日記資料夾算篇數。daily-life-score.py 完全不用改，繼續只管知識庫健康分數',
      '/api/admin/mind-index 端點改成支援「部分欄位」推送——知識庫健康分數（daily-life-score.py 每天推一次）跟心智基本分（collect.ps1 每 10 分鐘推一次）現在是兩個各自獨立、互不覆蓋的推送來源，共用同一張表、同一個日期列，各自只更新自己負責的欄位',
      '順手修掉一個連帶發現的問題：collect.ps1 原本只要系統快照那段推送失敗（例如先前的 SSL/DNS 故障）就會整支腳本直接結束，導致近期活動、心智指標這些後面的段落完全不會執行到——這正是「近期活動永遠空白」的真正原因。改成三個段落各自獨立失敗，一個掛掉不會連帶擋住其他兩個',
    ],
  },
  {
    version: '1.30.0',
    date: '2026-08-21',
    summary: '心智指標拿掉完成任務數（跟從容指數重複），改成純看日記篇數、邊際效用遞減的算法',
    changes: [
      '心智指標原本的公式是「日記篇數 + 完成任務數」各自封頂 50 分相加，但完成任務數這件事從容指數（Vikunja 忙碌指數的反向）本來就已經在算了，兩個 HHI 維度算同一件事會重複。改成純看日記篇數，不再看任務完成',
      '新公式 dailyEngagementScore = round(100 × 日記篇數 ÷ (日記篇數 + 3))——前幾篇日記的邊際效用最大，篇數越多效果越平緩但沒有硬性封頂（例如 1 篇 25 分、3 篇 50 分、5 篇 63 分、10 篇 77 分），符合「多寫一點總是有幫助，但效果會遞減」的直覺。這個公式改在 HERMES 的 daily-life-score.py 那邊實作，Aiportal 這邊只是更新卡片顯示（拿掉「完成任務數」欄位、副標題改成「日記書寫」）',
    ],
  },
  {
    version: '1.29.0',
    date: '2026-08-20',
    summary: '版面調整：運動 APP 系統雷達圖放大、人生自由指數卡片旁邊補上鄰卡、容器健康補上名稱清單',
    changes: [
      '運動 APP 系統卡片全寬獨佔一列後，原本雷達圖跟數字直式堆疊、雷達圖置中固定 230px 的排法沒有跟著調整，卡片變寬但雷達圖沒有變大，兩側留白一大片。改成左右並排（跟翰翰仔幸福指數卡片同一套排法），雷達圖放大到 340px',
      '私領域 2 欄 bento grid 補上 grid-auto-flow: dense——原本全寬卡片（運動 APP 系統）夾在兩張一般卡片中間時，CSS Grid 不會自動把後面的卡片回填到前面卡片旁邊的空格，導致人生自由指數卡片旁邊空出一大塊。dense 讓瀏覽器優先填滿前面留下的空格',
      'HERMES 戰情室的「容器健康」原本只在小卡顯示 6/7 這種計數，看不出是哪些容器。新增「容器清單」面板，跟排程任務/近期活動一樣用清單列出每個容器的名稱＋執行狀態',
    ],
  },
  {
    version: '1.28.1',
    date: '2026-08-20',
    summary: '修正輸入正確密碼卻立刻被鎖回去的問題',
    changes: [
      '入口網原本靠「私領域有任何一項資料是 null，就當作密碼過期」來自動清掉存在瀏覽器裡的密碼——這個判斷法在只有 4 個私領域來源、彼此都相對穩定時沒出過問題，但這次新增的旅遊生活來源第一次上線很容易因為 .env 還沒填 token 之類的原因抓資料失敗，失敗時資料一樣是 null，跟「密碼被拒絕」長得一模一樣，導致密碼明明是對的，畫面卻立刻跳回鎖定狀態',
      '改成後端直接回傳一個 unlocked 布林值（就是伺服器自己驗證 x-admin-password header 對不對的那個判斷結果），前端不用再用資料有沒有缺來猜密碼對不對，兩件事徹底分開，不會再互相干擾',
    ],
  },
  {
    version: '1.28.0',
    date: '2026-08-20',
    summary: '幸福指數新增旅遊生活維度，心智指標改成「日記＋任務完成度」，知識庫健康分數保留顯示但移出計算',
    changes: [
      '新增「旅遊生活」維度（權重 15%）：讀自架 AdventureLog 的行程資料，反映「最近有沒有出去玩」——3 天內剛玩回來 100 分，之後線性遞減，約 93 天沒出去玩降到 0 分，只看已結束的行程，還沒發生的計畫不算。即時計算，不用另外存歷史表',
      '心智指標改版：原本的心智指標其實是 HERMES 知識庫的健康分數，跟翰翰仔本人的心智狀態關係不大，這次拆成兩塊——知識庫健康度保留顯示，但移出幸福指數；新的「心智基本分」= min(50,當天日記篇數×25) + min(50,當天完成任務數×10) 才計入幸福指數。日記/任務資料由 HERMES 的 daily-life-score.py 一起 push 過來（還沒實作前這個維度會顯示「資料準備中」，用其餘 4 維重新正規化計算，不影響其他分數）',
      '5 個維度權重重新分配：人生自由 36→31%、健身習慣 24→20%、生活從容 20→17%、心智指標 20→17%、旅遊生活 新增 15%（等比例縮小舊 4 維權重騰出空間，跟上次新增心智指標時同一套做法）',
      '私領域卡片版面照「有計入幸福指數的系統優先」固定排序（人生自由→健身習慣→生活從容→旅遊生活→心智指標），不再依賴資料庫插入順序',
    ],
  },
  {
    version: '1.27.0',
    date: '2026-08-15',
    summary: '私領域卡片版面重整：雷達圖卡片獨佔一列，純連結卡另外分組，不再跟高度差很多的卡片同列硬湊',
    changes: [
      '2 欄 bento grid 裡混雜了三種天生高度差很多的卡片：有雷達圖的（目前是運動 APP 系統，最高）、HeroIndex+支援數字的摘要卡（人生進度管理系統／任務追蹤系統／心智指標，中等）、純連結卡（例如 Duplicati 狀態，很矮）。同一列配對到高度差很大的鄰居時，矮的那張下面會空出一大片沒對齊的空白，看起來很不整齊',
      '改成：有雷達圖的卡片（GlassSummaryCard 新增 wide 參數）獨佔一整列（grid-column: 1 / -1）；其餘摘要卡（高度天生接近）留在 2 欄 grid；純連結卡另外用跟公領域同一套緊湊 2 欄格線，自成一列，不再跟摘要卡混在一起比高度',
    ],
  },
  {
    version: '1.26.2',
    date: '2026-08-15',
    summary: '修正容器健康仍是 0/0：PowerShell 5.1 把 docker 寫到 stderr 的內容誤判成中斷錯誤',
    changes: [
      '正式主機上手動測試 docker ps 本身完全正常（7 個容器都抓得到），但透過 collect.ps1 執行卻還是 0/0——用本機重現後確認：整支腳本開頭設了 $ErrorActionPreference = "Stop"，PowerShell 5.1 在這個設定下，只要原生指令（docker.exe）寫任何東西到 stderr，即使 exit code 是 0，也會被拉高成中斷錯誤，讓 docker ps 那行直接被當例外處理掉，即使有用 2>檔案 把 stderr 導到檔案而不是 $null 也一樣',
      'Docker Desktop 偶爾會在乾淨執行時也印一些提示/棄用訊息到 stderr，剛好就會踩到這個地雷。修法是呼叫 docker 那一行前後暫時把 $ErrorActionPreference 切成 Continue，執行完再切回 Stop，其餘腳本的失敗即停紀律不受影響',
    ],
  },
  {
    version: '1.26.1',
    date: '2026-08-15',
    summary: '修正 HERMES 戰情室三個實測發現的問題：容器健康 0/0、近期活動亂碼、排程任務誤判失敗',
    changes: [
      '容器健康顯示 0/0：collect.ps1 原本用 docker ps --format 搭配跳脫雙引號去抓 compose 專案名稱，Windows PowerShell 5.1 對含雙引號的原生命令參數有已知的跳脫地雷，會在傳給 docker.exe 之前就把參數弄壞。改成不帶引號的格式字串，不抓專案名稱（反正前端也沒用到這欄）',
      '近期活動文字亂碼：collect.ps1 檔案本身沒有 UTF-8 BOM，Windows PowerShell 5.1 在沒有 BOM 時會用系統內碼（不是 UTF-8）解析 .ps1 原始碼裡的中文字面值，導致腳本裡寫死的「已更新部署」字串在執行時就已經是亂碼，不是傳輸或資料庫的問題。已補上 BOM，訊息文字也順手改成不依賴中文字面值的格式',
      '排程任務顯示「失敗 (267009)」：267009 其實是 Windows Task Scheduler 的 SCHED_S_TASK_RUNNING（工作還在執行中），不是真的失敗——因為 update.log 已經累積好幾週的部署紀錄，第一次執行 collect.ps1 時逐行 POST 歷史紀錄卡了很久，查詢當下剛好抓到「執行中」狀態。改成只從目前檔案結尾開始追蹤新的一行，不倒灌歷史紀錄；前端也把「執行中」跟「尚未觸發過」這兩個正常狀態碼跟真的失敗分開顯示',
    ],
  },
  {
    version: '1.26.0',
    date: '2026-08-15',
    summary: '新增 HERMES 戰情室：CPU/RAM/磁碟、容器健康、排程任務狀態、近期部署活動',
    changes: [
      '入口網私領域新增獨立區塊「HERMES 戰情室」，顯示部署主機的即時運維狀態：CPU/記憶體/磁碟使用率、Docker 容器健康、Windows 排程任務最近執行結果、近期部署/備份活動——這些不是幸福指數的一個維度，是純粹的維運監控，所以獨立成一區、不進 HHI 合成分數',
      '資料來自新的 services/hermes-status/collect.ps1（部署主機上每 10 分鐘跑一次的排程任務），POST 到新的 /api/admin/hermes-status（快照）與 /api/admin/hermes-activity（單筆事件）端點，跟心智指標同一套 x-admin-password push-to-API 模式',
      '排程任務結果直接讀 Windows 原生的 Get-ScheduledTaskInfo，近期活動則是讀 update.ps1 本來就會寫的 update.log 尾端新增行——不用另外要求 HERMES 改自己的行為去插點記錄',
      '30 分鐘沒更新就視為過期（比心智指標的 36 小時門檻短很多，因為這裡資料本來就該幾分鐘更新一次），過期時整區降低飽和度顯示，不是當成錯誤',
    ],
  },
  {
    version: '1.25.0',
    date: '2026-08-15',
    summary: '入口網視覺改版：深色玻璃絲綢風格，波浪背景取代粒子場，卡片加上光帶+彗星邊框',
    changes: [
      '背景改成 PS4 風格的多層 sine 波浪 + 漂浮塵埃粒子（取代原本滑鼠吸附的粒子場），色相沿用既有的青(公領域)→紫(私領域)語意；加上兩顆模糊光暈球做深度感',
      '主要卡片（幸福指數、心智指標、各子系統摘要卡）套上絲綢光帶掃過 + 旋轉彗星邊框 + 滑鼠光斑的玻璃殼效果；幸福指數卡跟心智指標卡（純 div，沒有既有的 framer-motion 動畫）額外有 3D 滑鼠傾斜，圖卡類的卡片維持原本 framer-motion 的 hover 上浮不疊加，避免兩套 transform 系統互搶',
      '字型全面換成 Noto Sans TC，順手清掉沒在用的舊 8-bit 街機殘留 CSS（.arcade-card / pixel-glow 動畫 / cursor-blink），新增 theme.ts 統一色票常數，取代原本散落各處的顏色字面值',
    ],
  },
  {
    version: '1.24.0',
    date: '2026-08-14',
    summary: '私領域卡片版面修正：矮卡片不再被拉伸成跟旁邊高卡片一樣高',
    changes: [
      '私領域 bento grid 少了 alignItems: start，同一列的卡片預設會被拉伸成一樣高（CSS Grid 預設 align-items: stretch）——例如人生自由指數（沒有雷達圖，內容矮）跟運動 APP 系統（有雷達圖，內容高）同一列時，前者會被硬撐出一大片空白去配合後者，看起來版面很不一致。實測正式站當時矮卡片被撐到 501px（自然高度只要約 280px），改完後各自長到自己內容需要的高度就好',
    ],
  },
  {
    version: '1.23.0',
    date: '2026-08-14',
    summary: '運動 APP 系統覆蓋率補上活動量加成，跟主站顯示一致',
    changes: [
      'FitnessForge 主站的覆蓋分數會依步數等活動量加成（封頂 +10%，例如「覆蓋 66%（含活動量 +10%）」），但 /api/public/summary 原本沒有套用這個加成，入口網卡片顯示的覆蓋率因此一直比主站自己頁面少了這一截——現在改讀新回傳的 activityBonusPoints，一樣用「XX%（含活動量 +Y%）」的格式顯示，不是把加成暗中併進去看不出來源',
    ],
  },
  {
    version: '1.22.0',
    date: '2026-08-14',
    summary: '運動 APP 系統雷達圖同步主站新增的第 9 軸「有氧」',
    changes: [
      'FitnessForge 主站雷達圖新增「有氧」軸（純有氧運動如跑步原本肌群佔比全是 0，做再多也不會反映在雷達圖上），/api/public/summary 的 muscleComposites 已經一併補上這一軸，入口網卡片只需要把軸列表從 8 項改成 9 項（跟著加上「有氧」）就會自動同步，不用改其他邏輯',
    ],
  },
  {
    version: '1.21.0',
    date: '2026-08-09',
    summary: '雷達圖補上軸線名稱與分數標籤，運動 APP 系統改用跟主站一致的刻度',
    changes: [
      '新增共用的 LabeledRadarChart 元件：每個軸自動標示維度名稱＋分數（例如「人生自由 79」），取代原本兩張雷達圖各自土砲、完全沒有標示的空白多邊形——之前看起來太空洞是因為真的什麼標示都沒有',
      '運動 APP 系統卡片的雷達圖改讀 FitnessForge 新回傳的 muscleComposites（跟它自己網站上的雷達圖同一組 0-150% 複合分，維持基準=100% 用虛線標示），不再是拿原始組數/容量數字自己重新正規化——原本每週都會自我填滿到 100%，跟主站雷達圖的形狀、刻度都對不上，也是先前「雷達圖看起來沒在更新」的部分原因',
      '翰翰仔幸福指數卡片重新排版：雷達圖放大到 260px，跟主指數＋四個貢獻度數字放在同一行左側，不再用 space-between 把兩者推到卡片兩端留一大片空白',
    ],
  },
  {
    version: '1.20.0',
    date: '2026-08-09',
    summary: 'HHI 卡片新增大型四維雷達圖，API 回應一律禁止快取',
    changes: [
      '翰翰仔幸福指數卡片新增四維雷達圖（人生自由/健身習慣/生活從容/心智指標），200px、跟主指數並排在卡片最上方，是卡片視覺重心；跟運動 APP 系統卡片的肌群雷達圖同一套 SVG 手法，但用固定 0-100 絕對刻度而非每次依本週最大值重新縮放——同一個分數在不同天看起來大小要一致，才看得出真的有沒有變化',
      '所有 /api/* 回應統一加上 Cache-Control: no-store、關掉 Express 預設的 ETag——原本沒有明講快取策略，Express 預設會生成 ETag 但沒有搭配 Cache-Control，這個組合正是會讓瀏覽器或中間的反向代理誤快取回應的典型情況；正式站後端本身確認過是即時運算（每次 fetchedAt 都不同），這次是防禦性補強，避免中間層快取造成使用者端偶爾看到舊資料',
    ],
  },
  {
    version: '1.19.0',
    date: '2026-08-09',
    summary: '心智指標改成 HERMES 推送到 API，不再讀 NAS 檔案',
    changes: [
      '心智指標的資料來源從「容器直接讀 NAS 上的 心智指標.md」改成「HERMES 的 daily-life-score.py 算完後 POST 到新的 POST /api/admin/mind-index」，寫進新的 mind_index_history 表——原本的檔案讀取方案在部署時發現 Docker Desktop 的 WSL2 backend 沒辦法穩定 bind mount UNC 路徑（掛上了但容器內是空的），退而求其次把檔案 COPY 進 image 又會讓分數只在每次部署時才更新，不是真的每日更新，所以改成直接 push',
      '心智指標卡片的歷史趨勢線改讀新的 GET /api/mind-index/history（跟 HHI 卡片的 /api/happiness/history 同一套模式），不再依賴 心智指標-history.jsonl 檔案',
      '這個改動需要 daily-life-score.py 那邊配合改一個小地方：跑完之後多一個 POST 請求，把 score/conversion/link_health/vitality/rhythm/rhythm_trend_pct/partial 送到 Aiportal 的新端點（帶 x-admin-password header），細節另外交代',
    ],
  },
  {
    version: '1.18.0',
    date: '2026-08-09',
    summary: '新增心智指標卡片，翰翰仔幸福指數擴充為四維度',
    changes: [
      '新增「心智指標」卡片：讀取 HERMES 每天寫在 NAS（Obsidian Vault）上的 心智指標.md，顯示轉化率／連結健康度／活化度／本週節奏四個子分數，各自級距標籤用 HERMES 自己定義的門檻（例如轉化率 ≥90 順暢、活化度 ≥80 活躍），不是套用其他卡片的通用色階',
      '資料超過 36 小時沒更新（HERMES 計分腳本沒跑）時整張卡降低飽和度標示「資料已超過 36 小時未更新」，但還是顯示最後已知分數，不會憑空消失',
      '翰翰仔幸福指數（HHI）從三維度擴充為四維度：人生自由 45%→36%、健身習慣 30%→24%、生活從容 25%→20%，三者依原比例等比縮小；心智指標新佔 20%——原本三項的相對比例完全不變，只是整體讓出五分之一空間給新維度',
      '心智指標卡片沒有對應的 portal_sites 列（沒有外部網址可連），比照翰翰仔幸福指數的做法直接掛進私領域 bento grid，不透過 GlassSummaryCard／SUMMARY_BODIES 那條路徑',
      '「展開明細」內附近 5-30 天歷史趨勢線（若 HERMES 有寫 心智指標-history.jsonl），跟 HHI 卡片同一顆 TrendLineChart 元件，這次順便把它從只認 HHI 的 displayedScore 欄位改成通用的 {date, value} 格式',
    ],
  },
  {
    version: '1.17.0',
    date: '2026-08-09',
    summary: '任務追蹤系統子分數加註級距標籤，不再只看到裸數字',
    changes: [
      '逾期壓力／近期負荷／停滯程度／拖延程度四個子分數旁邊加上級距標籤（輕鬆／普通／緊繃），跟從容指數卡片主指數同一套色階與門檻——原本只看到「近期負荷 100」不知道是高是低，現在直接標「緊繃」',
      'SupportStats 共用元件新增可選的 tier 欄位，之後其他卡片的數字如果也想加級距標籤可以直接沿用，不用重複做一套',
    ],
  },
  {
    version: '1.16.0',
    date: '2026-08-08',
    summary: '子系統卡片公式說明改成點擊展開，不再依賴滑鼠 hover（手機也能用）',
    changes: [
      '上一版（v1.14.0）加的公式 ⓘ 用的是瀏覽器原生 title 屬性，只有滑鼠移上去才會出現，手機觸控完全用不到——改成跟翰翰仔幸福指數卡片「展開明細」一樣的點擊展開模式：卡片內新增「公式說明 ▼」按鈕，點下去在卡片內展開所有數字的公式說明，再點一次收起',
      '三張子系統卡片（人生進度管理系統／運動 APP 系統／任務追蹤系統）本身點擊會導覽到外部系統連結，公式展開按鈕做了事件阻擋（stopPropagation），點它只會展開/收起面板，不會誤觸跳轉',
    ],
  },
  {
    version: '1.15.0',
    date: '2026-08-08',
    summary: '翰翰仔幸福指數新增每日趨勢線，任務追蹤系統改顯示從容指數',
    changes: [
      '翰翰仔幸福指數卡片「展開明細」新增近 30 天趨勢線圖，跟人生進度管理系統的投資組合績效圖一樣是每天記一筆、畫成折線——資料來源是本來就在寫入的 happiness_index_history 表，只是這次才把歷史資料實際畫出來；新增 GET /api/happiness/history 端點供這張圖抓資料，跟 /api/dashboard 分開，因為歷史資料一天只變一次，不需要每次開頁面都重抓',
      '任務追蹤系統卡片主指數從「忙碌指數」改顯示「從容指數」（= 100 － 忙碌指數，跟 HHI 卡片「生活從容」貢獻度是同一個數字），三張子系統卡片現在方向一致都是「越高越好」，不用切換心智模型；逾期壓力／近期負荷／停滯程度／拖延程度四個子分數維持原本「越高代表這個問題越嚴重」的診斷語意，只有主指數翻轉',
      '這張趨勢線圖剛上線時歷史資料還很少（happiness_index_history 這幾天才開始穩定寫入），會隨著每天自動累積慢慢畫出線來，沒辦法回填更早以前的資料',
    ],
  },
  {
    version: '1.14.0',
    date: '2026-08-07',
    summary: '子系統卡片數字加註計算公式（hover 顯示），運動 APP 肌群雷達圖放大',
    changes: [
      '人生進度管理系統、運動 APP 系統、任務追蹤系統三張卡片的主指數跟每個輔助數字旁邊加上 ⓘ 標記，滑鼠移上去會顯示該數字實際怎麼算出來的（例如「均衡度 = 最弱肌群複合分 ÷ 最強肌群複合分」），不用回頭問或猜',
      '運動 APP 系統的肌群雷達圖從 88px 放大到 130px，原本太小看不清楚各肌群分布',
    ],
  },
  {
    version: '1.13.0',
    date: '2026-08-07',
    summary: '入口網改成開頁即時抓取各子系統資料，修正翰翰仔幸福指數消失的問題',
    changes: [
      '入口網 /api/dashboard 改成每次請求都直接向 pf-cwh、運動 APP 的來源 API 即時抓取，不再只讀 20 分鐘一次的快取，開頁面看到的就是當下最新數字（任務追蹤系統的忙碌指數仍是當天由 Python 服務算好的每日值，本來就是一天更新一次）',
      '修正翰翰仔幸福指數卡片一直顯示「資料準備中」的問題：改成即時抓取後，後端算出 HHI 分數卻只把「有實際去抓 API」的三個來源塞進回應清單，HHI 是用其他三個算出來的、不在那份清單裡，資料算出來了卻沒送到前端，現在改成直接把即時抓取結果全部送出，不再漏掉 HHI',
      '修正 HHI 平滑顯示功能悄悄失效的問題：改即時抓取那次改動把負責寫入 happiness_index_history 的地方拿掉了卻沒補上，導致「今天分數」永遠找不到「昨天分數」，平滑公式形同虛設；現在改成每次即時算完就順便寫入（同一天多次寫入會直接覆蓋，不會壞資料）',
      '清掉沒接上的「手動觸發快照重算」按鈕相關程式碼（Aiportal 前端 + pf-cwh 後端各一段），改成即時抓取後這個手動刷新的需求已經不需要了',
    ],
  },
  {
    version: '1.12.0',
    date: '2026-08-03',
    summary: '新增翰翰仔幸福指數總合卡片，任務追蹤系統改接正式忙碌指數服務',
    changes: [
      '新增「翰翰仔幸福指數（HHI）」置頂橫向卡片：綜合人生自由指數、運動習慣指數、忙碌指數（反轉為生活從容分）三項加權平均，加上最弱項修正與日對日平滑顯示，明確標示非醫療/心理診斷，僅為生活系統總覽指標',
      'HHI 缺資料時不當作 0 計算：任一來源缺席就在剩餘來源間重新分配權重，三項全缺則顯示「資料準備中」，絕不顯示假分數',
      '卡片可展開查看明細（基礎分、最弱項分數、平滑前後分數），行動版三項貢獻度改直式排列',
      '任務追蹤系統卡片的忙碌指數不再由前端即時計算，改為讀取 services/busyness-index/ Python 服務每日寫入 Postgres 的 busyness_index_history 正式資料（該服務含逾期壓力/近期負荷/停滯程度/完成度衰減加權四項子分數）',
      'summaryFetchJob 改成循序（非併發）抓取四個來源，讓 HHI 能安全讀取同一輪次中另外三個來源剛寫入的快取資料',
    ],
  },
  {
    version: '1.11.0',
    date: '2026-08-03',
    summary: '每個子系統改成「單一綜合指數 + 輔助數據」，字體全面放大',
    changes: [
      '不再只是列原始數字——三個子系統各自新增一個綜合指數當作卡片主角：人生自由指數（pf-cwh：資產分/報酬分/休假配速分平均）、運動習慣指數（FitnessForge：訓練量分/覆蓋分/均衡分/趨勢分平均）、忙碌指數（Vikunja：逾期任務/待辦任務/完成落後程度加權，越高越忙）',
      '忙碌指數是「越低越好」的指標，跟其他兩個「越高越好」的指數共用同一套色階/文字邏輯但方向相反（≥80 忙碌指數顯示「輕鬆」綠色，其他兩個指數則是「優異」）',
      '放棄任務追蹤系統的簡易甘特圖呈現，改成跟其他兩張卡一致的「大數字 + 幾個輔助統計」版面，不用再佔 2 欄寬',
      '全面放大字體與留白：卡片 padding、hero 數字（clamp 2.4rem–3.2rem）、輔助數據、圖示、頁尾文字都比照卡片實際可用空間重新抓比例，不再是小卡片時代的尺寸',
    ],
  },
  {
    version: '1.10.1',
    date: '2026-08-03',
    summary: '排版與資料修正：2 欄網格、休假配速、甘特圖補標籤',
    changes: [
      '私領域改回每列最多 2 欄（不是 4 欄）：第一列人生進度管理系統+運動 APP 系統並排，任務追蹤系統（2 欄寬）獨自佔一列，其餘依序往下排；公領域也改成每列 2 欄',
      '人生進度管理系統卡片「休假比率」改成「休假配速」：原本接錯欄位（顯示的是已休天數/總假別天數，畫面上根本沒有這個數字），改抓 pf-cwh 自己也在用的配速指數',
      '任務追蹤系統卡片內部改垂直排版（清單在上、甘特圖在下），甘特圖欄位加大到全卡寬度；甘特圖補上日期軸（-3天／今天／+7天）跟每列任務名稱標籤，不再是看不懂在畫什麼的裸線條',
    ],
  },
  {
    version: '1.10.0',
    date: '2026-08-03',
    summary: '版面改垂直佈局，貼近概念稿',
    changes: [
      '私領域/公領域從左右對半分改成上下垂直排列：私領域儀表板卡片在上、佔滿版面寬度，公領域純連結卡在下，跟一開始的設計概念稿一致',
      '私領域改用固定 4 欄 bento 網格，有摘要來源的卡片（如任務追蹤系統）可以橫跨 2 欄，卡片不再被半版寬度擠壓',
      '手機版對應調整：≤768px 縮成 2 欄、≤480px 縮成 1 欄且寬卡自動變回單欄，不會橫向溢出',
    ],
  },
  {
    version: '1.9.1',
    date: '2026-08-03',
    summary: '修正密碼過期後無法自動重鎖 · Vikunja 補甘特圖',
    changes: [
      '修正解鎖密碼失效後卡片會卡在「暫時無法取得資料」的問題：/api/dashboard 只有在密碼被伺服器拒絕時才會回傳 data:null（真正的抓取失敗會保留上次快取值，不會是 null），所以現在偵測到這個訊號就自動清掉本機存的舊密碼、退回真正的鎖定畫面，讓使用者重新輸入現在有效的密碼',
      '任務追蹤系統卡片加寬為 2 欄，補上簡易甘特圖（沿用現有到期任務清單資料，未設定起始日的任務畫成單日標記）',
    ],
  },
  {
    version: '1.9.0',
    date: '2026-08-03',
    summary: '系統總覽看板（第三階段：任務追蹤系統）',
    changes: [
      '私領域卡片新增任務追蹤系統（Vikunja）摘要：7 天內到期任務清單，依到期日排序，逾期／今天／N天後分色標示',
      'Vikunja 是第三方系統、無法加自訂端點，api-server 改直接呼叫 Vikunja 既有 REST API（獨立唯讀 token）彙整全部專案的任務',
      '甘特圖視覺化這次先不做——卡片維持現有寬度，等其他子系統都好、一次做版面加寬時再一起補',
    ],
  },
  {
    version: '1.8.0',
    date: '2026-08-03',
    summary: '系統總覽看板（第二階段：運動 APP 系統）',
    changes: [
      '私領域卡片新增運動 APP 系統（FitnessForge）摘要：本週積分、較上週趨勢、肌群訓練分布雷達圖',
      '雷達圖依本週各肌群訓練量正規化繪製（8 軸：胸/背/腿/肩/二頭肌/核心/臀/三頭肌），最高量的肌群固定畫滿整個半徑',
      'api-server 設定新增 fitnessforge 摘要來源，架構完全沿用第一階段（排程快取、私領域密碼解鎖）',
    ],
  },
  {
    version: '1.7.0',
    date: '2026-08-03',
    summary: '系統總覽看板（第一階段：人生進度管理系統）',
    changes: [
      '私領域卡片新增「摘要卡」型態：有對應 /api/public/summary 來源的子系統，從純連結卡升級成內嵌數據的儀表板卡片',
      '第一階段串接人生進度管理系統（pf-cwh）：總資產、TWRR、MWRR、休假比率',
      'api-server 新增排程器每 20 分鐘拉取一次各子系統摘要並快取，來源掛掉時保留上次快取值，不讓整頁被拖垮',
      '新增 GET /api/dashboard：人看的卡片與 AI Agent 要讀的結構化資料共用同一份，私領域摘要一樣要密碼解鎖才吐出真實數字',
      '私領域解鎖沿用同一把密碼，解鎖後會即時重新拉取一次摘要資料，不用整頁重新整理',
    ],
  },
  {
    version: '1.6.1',
    date: '2026-07-01',
    summary: '手機版面修正 · 卡片捲動',
    changes: [
      '修正手機瀏覽時字體/卡片消失問題：窄螢幕改為公私領域上下堆疊',
      '窄螢幕啟用垂直捲動，卡片高度依內容自動調整，不再被裁切',
    ],
  },
  {
    version: '1.6.0',
    date: '2026-05-19',
    summary: '毛玻璃粒子 Portal UI · 全息重設計',
    changes: [
      '以透明毛玻璃（Glassmorphism）取代街機風格，全頁不捲動',
      '背景粒子網格：72 個浮動粒子 + 連線，游標吸引特效',
      '卡片 backdrop-filter blur + 頂部光暈線，hover 浮升動效',
      '公/私領域以垂直分隔線區分，細膩光暈 zone label',
      'grid-auto-rows: 1fr 確保所有卡片一頁完整呈現',
    ],
  },
  {
    version: '1.5.0',
    date: '2026-05-19',
    summary: '街機電玩 UI · 動畫視圖切換',
    changes: [
      '新增快打旋風風格的街機角色選擇清單（Arcade Mode）',
      '地標以格鬥士肖像卡呈現，含 HP 條、公私領域分區',
      'CRT 掃描線、pixel grid 背景與 Press Start 2P 像素字體',
      '底部切換鈕一鍵在 3D 地標與街機清單間動畫過渡',
      '切換時顯示 ARCADE! / FIGHT! 霓虹閃光效果',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-03-25',
    summary: '龍捲風粒子 · 即時渲染修正',
    changes: [
      '地標周圍新增 28 顆環繞粒子（雪花特效）',
      '滑鼠懸停觸發龍捲風效果：粒子加速旋轉、螺旋上升、漏斗成形',
      '風力值平滑插值，進入/離開皆有自然的風起風止過渡',
      '修正場景初始渲染問題，地形與粒子立即顯示，不再閃白畫面',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-03-25',
    summary: '後端資料庫 · 公私分區',
    changes: [
      '網站資料遷移至後端 PostgreSQL 資料庫',
      '管理 CRUD 操作透過 REST API 持久化',
      '公領域 / 私領域地標分區顯示（左右分區）',
      '新增場景區域標示',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-03-25',
    summary: '點擊進入 · 後台管理 · 版本紀錄',
    changes: [
      '點擊3D地標直接進入系統，無需懸停按鈕',
      '新增首頁版本紀錄面板',
      '新增管理後台（CRUD 網站、公私領域設定）',
      '標題改為 AI工具入口網',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-03-25',
    summary: '地標標籤 · 私領域保護',
    changes: [
      '地標旁常駐顯示系統名稱',
      '新增公領域 / 私領域分類標示',
      '私領域網站密碼保護，設備一次驗證即記憶',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-03-25',
    summary: '初始發布',
    changes: [
      '3D 點雲地形場景（Three.js + React Three Fiber）',
      '6 個專案地標，滑鼠懸停互動效果',
      '玻璃質感資訊卡片，自動旋轉場景',
    ],
  },
]

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface SiteLink {
  label: string
  url: string
}

interface SiteData {
  id: string
  name: string
  subtitle: string
  links: SiteLink[]
  worldXZ: [number, number]
  isPrivate: boolean
  subsystemId: string | null
}

interface DashboardSummary {
  subsystemId: string
  name: string
  isPrivate: boolean
  status: 'ok' | 'error' | 'pending'
  errorMessage: string | null
  fetchedAt: string | null
  data: Record<string, unknown> | null
}

// ─────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────
const API_BASE = import.meta.env.BASE_URL ?? '/'

async function apiFetchSites(): Promise<SiteData[]> {
  const r = await fetch(`${API_BASE}api/sites`)
  if (!r.ok) throw new Error('Failed to fetch sites')
  const data = await r.json() as { sites: SiteData[] }
  return data.sites
}

async function apiFetchDashboard(adminPassword: string | null): Promise<{ summaries: DashboardSummary[]; unlocked: boolean }> {
  const r = await fetch(`${API_BASE}api/dashboard`, {
    headers: adminPassword ? { 'x-admin-password': adminPassword } : {},
  })
  if (!r.ok) throw new Error('Failed to fetch dashboard')
  return r.json() as Promise<{ summaries: DashboardSummary[]; unlocked: boolean }>
}

interface HappinessHistoryPoint {
  date: string
  finalScore: number
  displayedScore: number
}

async function apiFetchHappinessHistory(adminPassword: string, days = 30): Promise<HappinessHistoryPoint[]> {
  const r = await fetch(`${API_BASE}api/happiness/history?days=${days}`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch happiness history')
  const data = await r.json() as { history: HappinessHistoryPoint[] }
  return data.history
}

interface MindIndexHistoryPoint {
  date: string
  score: number
}

async function apiFetchMindIndexHistory(adminPassword: string, days = 30): Promise<MindIndexHistoryPoint[]> {
  const r = await fetch(`${API_BASE}api/mind-index/history?days=${days}`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch mind-index history')
  const data = await r.json() as { history: MindIndexHistoryPoint[] }
  return data.history
}

interface HermesDiskInfo { drive: string; percentUsed: number; freeGb: number; totalGb: number }
interface HermesContainerInfo { name: string; project: string | null; status: string; health: string | null }
interface HermesScheduledTaskInfo { name: string; lastRunTime: string | null; lastTaskResult: number | null }

interface HermesStatusData {
  available: boolean
  cpuPercent: number | null
  memPercent: number | null
  disks: HermesDiskInfo[]
  containers: HermesContainerInfo[]
  scheduledTasks: HermesScheduledTaskInfo[]
  computedAt: string | null
  stale: boolean
}

async function apiFetchHermesStatus(adminPassword: string): Promise<HermesStatusData> {
  const r = await fetch(`${API_BASE}api/hermes-status`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch hermes status')
  return r.json() as Promise<HermesStatusData>
}

interface HermesActivityEntry { id: number; occurredAt: string; source: string; message: string }

async function apiFetchHermesActivity(adminPassword: string, limit = 20): Promise<HermesActivityEntry[]> {
  const r = await fetch(`${API_BASE}api/hermes-activity?limit=${limit}`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch hermes activity')
  const data = await r.json() as { activity: HermesActivityEntry[] }
  return data.activity
}

async function apiVerifyPassword(password: string): Promise<boolean> {
  const r = await fetch(`${API_BASE}api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  return r.ok
}

async function apiAddSite(data: Omit<SiteData, 'id'>, adminPassword: string): Promise<SiteData> {
  const r = await fetch(`${API_BASE}api/sites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
    body: JSON.stringify(data),
  })
  if (!r.ok) throw new Error('Failed to create site')
  const json = await r.json() as { site: SiteData }
  return json.site
}

async function apiUpdateSite(id: string, data: Partial<Omit<SiteData, 'id'>>, adminPassword: string): Promise<SiteData> {
  const r = await fetch(`${API_BASE}api/sites/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
    body: JSON.stringify(data),
  })
  if (!r.ok) throw new Error('Failed to update site')
  const json = await r.json() as { site: SiteData }
  return json.site
}

async function apiDeleteSite(id: string, adminPassword: string): Promise<void> {
  const r = await fetch(`${API_BASE}api/sites/${id}`, {
    method: 'DELETE',
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to delete site')
}

function nextPosition(existing: SiteData[], isPrivate: boolean): [number, number] {
  const pool = isPrivate ? PRIVATE_POSITION_POOL : PUBLIC_POSITION_POOL
  const used = new Set(existing.map(s => `${s.worldXZ[0]},${s.worldXZ[1]}`))
  for (const p of pool) {
    if (!used.has(`${p[0]},${p[1]}`)) return p
  }
  const sign = isPrivate ? 1 : -1
  return [sign * (3 + Math.random() * 3), (Math.random() - 0.5) * 6]
}

// ─────────────────────────────────────────────
// Terrain height function
// ─────────────────────────────────────────────
function getHeight(x: number, z: number): number {
  return (
    Math.sin(x * 0.5) * Math.cos(z * 0.3) * 2.0 +
    Math.sin(x * 0.2 + z * 0.4) * 1.5 +
    Math.cos(x * 0.7 + z * 0.2) * 1.0
  )
}

// ─────────────────────────────────────────────
// 3D Scene Components
// ─────────────────────────────────────────────
function Terrain() {
  const SEGS = 100
  const SIZE = 22
  const { positions, colors } = useMemo(() => {
    const count = (SEGS + 1) * (SEGS + 1)
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    let i = 0
    for (let ix = 0; ix <= SEGS; ix++) {
      for (let iz = 0; iz <= SEGS; iz++) {
        const x = (ix / SEGS - 0.5) * SIZE
        const z = (iz / SEGS - 0.5) * SIZE
        const h = getHeight(x, z)
        positions[i * 3] = x; positions[i * 3 + 1] = h; positions[i * 3 + 2] = z
        const t = Math.max(0, Math.min(1, (h + 4.5) / 9.0))
        colors[i * 3] = t * 0.25; colors[i * 3 + 1] = 0.45 + t * 0.55; colors[i * 3 + 2] = 0.65 + t * 0.35
        i++
      }
    }
    return { positions, colors }
  }, [])
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.06} vertexColors sizeAttenuation transparent opacity={0.88} />
    </points>
  )
}

function FloatingParticles() {
  const ref = useRef<THREE.Points>(null)
  const count = 700
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 24
      arr[i * 3 + 1] = Math.random() * 6 + 0.5
      arr[i * 3 + 2] = (Math.random() - 0.5) * 24
    }
    return arr
  }, [])
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.elapsedTime * 0.018
      ref.current.position.y = Math.sin(clock.elapsedTime * 0.12) * 0.25
    }
  })
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.03} color="#7fffd4" sizeAttenuation transparent opacity={0.45} />
    </points>
  )
}

// ─────────────────────────────────────────────
// Vortex / tornado particles orbiting each landmark
// ─────────────────────────────────────────────
const FLAKE_COUNT = 28
const MAX_H = 4.0

function SnowflakeRing({ hovered }: { hovered: boolean }) {
  const ref = useRef<THREE.Points>(null)
  // 0 = calm drift, 1 = full tornado; ramps smoothly each frame
  const wind = useRef(0)
  // reusable Color objects to avoid GC pressure inside useFrame
  const calmColor = useRef(new THREE.Color('#c8eeff'))
  const stormColor = useRef(new THREE.Color('#ffddb0'))

  const { baseAngles, radii, baseHeights, driftSpeeds, phases } = useMemo(() => {
    const baseAngles  = new Float32Array(FLAKE_COUNT)
    const radii       = new Float32Array(FLAKE_COUNT)
    const baseHeights = new Float32Array(FLAKE_COUNT)
    const driftSpeeds = new Float32Array(FLAKE_COUNT)
    const phases      = new Float32Array(FLAKE_COUNT)
    for (let i = 0; i < FLAKE_COUNT; i++) {
      baseAngles[i]  = (i / FLAKE_COUNT) * Math.PI * 2
      radii[i]       = 0.25 + Math.random() * 0.38
      baseHeights[i] = Math.random() * MAX_H
      driftSpeeds[i] = 0.20 + Math.random() * 0.35
      phases[i]      = Math.random() * Math.PI * 2
    }
    return { baseAngles, radii, baseHeights, driftSpeeds, phases }
  }, [])

  const positions = useMemo(() => new Float32Array(FLAKE_COUNT * 3), [])

  useFrame(({ clock }, delta) => {
    if (!ref.current) return

    // ── wind ramp: 0 = calm, 1 = tornado ──────────────────────────────────
    const targetWind = hovered ? 1 : 0
    wind.current += (targetWind - wind.current) * Math.min(delta * 2.8, 1)
    const w = wind.current

    const t   = clock.elapsedTime
    const pos = ref.current.geometry.attributes['position'] as THREE.BufferAttribute

    for (let i = 0; i < FLAKE_COUNT; i++) {
      const spd = driftSpeeds[i]

      // ── spin speed: 0.55 idle → 5.5 full tornado ─────────────────────
      const spin  = 0.55 + w * 4.95
      const angle = baseAngles[i] + t * spd * spin

      // ── vertical drift: gentle fall when calm, fast spiral-UP in tornado ─
      // netFall > 0 → downward; at w=0.5 → hover; w=1 → fast upward
      const fallMag  = (0.35 + w * 1.4) * spd
      const netFall  = fallMag * (1 - w * 2.1)           // crosses zero ~w=0.48
      const hPos = ((baseHeights[i] - t * netFall + phases[i] * MAX_H) % MAX_H + MAX_H) % MAX_H

      // ── radius: loose orbit idle → tight funnel at base, wide at top ─
      const idleR    = radii[i] + 0.07 * Math.sin(t * spd + phases[i])
      const vortexR  = 0.05 + (hPos / MAX_H) * 0.72   // tornado funnel shape
      const r        = idleR * (1 - w) + vortexR * w

      pos.setXYZ(i, Math.cos(angle) * r, hPos, Math.sin(angle) * r)
    }
    pos.needsUpdate = true

    // ── material: animate size, opacity, and colour ───────────────────────
    const mat   = ref.current.material as THREE.PointsMaterial
    mat.size    = 0.046 + w * 0.060
    mat.opacity = 0.44  + w * 0.52
    mat.color.lerpColors(calmColor.current, stormColor.current, w * 0.65)
    mat.needsUpdate = true
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.046}
        color="#c8eeff"
        sizeAttenuation
        transparent
        opacity={0.44}
      />
    </points>
  )
}

function ZoneLabel({ position, text, color }: { position: [number, number, number]; text: string; color: string }) {
  return (
    <Html center position={position} style={{ pointerEvents: 'none' }}>
      <div style={{
        color,
        fontSize: '10px',
        fontWeight: '300',
        letterSpacing: '0.45em',
        textTransform: 'uppercase',
        fontFamily: FONT_STACK,
        whiteSpace: 'nowrap',
        opacity: 0.38,
        userSelect: 'none',
      }}>
        {text}
      </div>
    </Html>
  )
}

function Landmark({
  site,
  onSiteClick,
  onUrlClick,
}: {
  site: SiteData
  onSiteClick: (site: SiteData) => void
  onUrlClick: (url: string, isPrivate: boolean) => void
}) {
  const [hovered, setHovered] = useState(false)
  const groupRef = useRef<THREE.Group>(null)
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null)

  const [wx, wz] = site.worldXZ
  const wy = getHeight(wx, wz)

  const handleEnter = useCallback(() => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
    setHovered(true)
  }, [])
  const handleLeave = useCallback(() => {
    leaveTimerRef.current = setTimeout(() => setHovered(false), 280)
  }, [])

  const handlePointerDown = useCallback((e: { clientX: number; clientY: number }) => {
    pointerDownPos.current = { x: e.clientX, y: e.clientY }
  }, [])

  const handleClick = useCallback((e: { clientX: number; clientY: number }) => {
    if (pointerDownPos.current) {
      const dx = Math.abs(e.clientX - pointerDownPos.current.x)
      const dy = Math.abs(e.clientY - pointerDownPos.current.y)
      if (dx > 6 || dy > 6) return
    }
    onSiteClick(site)
  }, [site, onSiteClick])

  useFrame(() => {
    if (!groupRef.current) return
    const target = hovered ? 1.28 : 1.0
    const s = groupRef.current.scale.x
    groupRef.current.scale.setScalar(s + (target - s) * 0.11)
  })

  const col = hovered ? '#ffaa00' : '#00e5ff'
  const emi = hovered ? '#ff6600' : '#009abb'
  const labelColor = site.isPrivate ? '#c084fc' : '#00e5ff'
  const labelGlow = site.isPrivate
    ? 'rgba(192, 132, 252, 0.85), 0 0 22px rgba(192, 132, 252, 0.4)'
    : 'rgba(0, 229, 255, 0.9), 0 0 22px rgba(0, 229, 255, 0.45)'
  const labelBorder = site.isPrivate ? 'rgba(192, 132, 252, 0.22)' : 'rgba(0, 229, 255, 0.22)'
  const secondaryLinks = site.links.slice(1)

  return (
    <group ref={groupRef} position={[wx, wy, wz]}>
      {/* Invisible hit volume */}
      <mesh
        position={[0, 1.6, 0]}
        onPointerEnter={handleEnter}
        onPointerLeave={handleLeave}
        onPointerDown={handlePointerDown}
        onClick={handleClick}
      >
        <cylinderGeometry args={[0.48, 0.48, 3.5, 8]} />
        <meshBasicMaterial transparent opacity={0.001} depthWrite={false} />
      </mesh>

      {/* Pillar */}
      <mesh position={[0, 1.6, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 3.2, 8]} />
        <meshStandardMaterial color={col} emissive={emi} emissiveIntensity={4} transparent opacity={0.92} />
      </mesh>

      {/* Inverted cone tip */}
      <mesh position={[0, 3.35, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.21, 0.72, 8]} />
        <meshStandardMaterial color={col} emissive={emi} emissiveIntensity={6} transparent opacity={0.88} />
      </mesh>

      {/* Glow sphere */}
      <mesh position={[0, 3.1, 0]}>
        <sphereGeometry args={[0.11, 8, 8]} />
        <meshStandardMaterial color={col} emissive={emi} emissiveIntensity={8} transparent opacity={0.55} />
      </mesh>

      <pointLight color={col} intensity={hovered ? 6 : 2.5} distance={5.5} position={[0, 3.1, 0]} />

      {/* Snowflake drift particles */}
      <SnowflakeRing hovered={hovered} />

      {/* Always-visible name label */}
      <Html center position={[0, 4.35, 0]} style={{ pointerEvents: 'none' }}>
        <div style={{
          color: labelColor,
          fontSize: '11px',
          fontWeight: '500',
          fontFamily: FONT_STACK,
          letterSpacing: '0.06em',
          whiteSpace: 'nowrap',
          textShadow: `0 0 10px ${labelGlow}`,
          background: 'rgba(5, 8, 20, 0.55)',
          padding: '3px 9px',
          borderRadius: '5px',
          border: `1px solid ${labelBorder}`,
          userSelect: 'none',
        }}>
          {site.name}
        </div>
      </Html>

      {/* Hover info card */}
      {hovered && (
        <Html position={[0.75, 2.6, 0]} style={{ pointerEvents: 'none' }}>
          <div
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
            style={{
              pointerEvents: 'auto',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.18)',
              borderRadius: '14px',
              padding: '16px 20px',
              width: '210px',
              color: 'white',
              fontFamily: FONT_STACK,
              boxShadow: '0 0 40px rgba(0, 229, 255, 0.12), inset 0 1px 0 rgba(255,255,255,0.1)',
            }}
          >
            <div style={{
              fontSize: '10px',
              color: site.isPrivate ? 'rgba(192, 132, 252, 0.75)' : 'rgba(0, 229, 255, 0.65)',
              letterSpacing: '0.18em', marginBottom: '6px',
              textTransform: 'uppercase', fontWeight: '500',
            }}>
              {site.isPrivate ? '🔒 私領域' : '🌐 公領域'}
            </div>
            <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '3px', lineHeight: '1.4', color: 'rgba(255,255,255,0.95)' }}>
              {site.name}
            </div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.03em' }}>
              {site.subtitle}
            </div>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', marginTop: '10px', letterSpacing: '0.05em' }}>
              點擊地標直接進入
            </div>
            {secondaryLinks.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px' }}>
                {secondaryLinks.map(link => (
                  <button
                    key={link.url}
                    onClick={() => onUrlClick(link.url, site.isPrivate)}
                    style={{
                      display: 'block', width: '100%',
                      padding: '7px 12px',
                      background: 'rgba(0, 229, 255, 0.06)',
                      border: '1px solid rgba(0, 229, 255, 0.22)',
                      borderRadius: '7px',
                      color: 'rgba(0,229,255,0.8)',
                      fontSize: '11px', fontWeight: '500',
                      letterSpacing: '0.04em', textAlign: 'center',
                      cursor: 'pointer', fontFamily: 'inherit', boxSizing: 'border-box',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,229,255,0.14)'; e.currentTarget.style.borderColor = 'rgba(0,229,255,0.45)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,229,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(0,229,255,0.22)' }}
                  >
                    {link.label} ↗
                  </button>
                ))}
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  )
}

function Scene({
  sites,
  onSiteClick,
  onUrlClick,
}: {
  sites: SiteData[]
  onSiteClick: (site: SiteData) => void
  onUrlClick: (url: string, isPrivate: boolean) => void
}) {
  return (
    <>
      <color attach="background" args={['#050814']} />
      <fog attach="fog" args={['#050814', 30, 46]} />
      <ambientLight intensity={0.15} />
      <Terrain />
      <FloatingParticles />

      {/* Zone labels — always visible */}
      <ZoneLabel position={[5.0, 7.0, 1.0]} text="私 領 域" color="rgba(192,132,252,1)" />
      <ZoneLabel position={[-4.0, 7.0, 0.5]} text="公 領 域" color="rgba(0,229,255,1)" />

      {/* Landmarks — appear once data is loaded from API */}
      {sites.map(s => (
        <Landmark key={s.id} site={s} onSiteClick={onSiteClick} onUrlClick={onUrlClick} />
      ))}

      <OrbitControls
        autoRotate autoRotateSpeed={0.4}
        enableDamping dampingFactor={0.05}
        maxPolarAngle={Math.PI / 2.15} minPolarAngle={0.18}
        minDistance={8} maxDistance={32}
      />
    </>
  )
}

// ─────────────────────────────────────────────
// Password Modal (private site access)
// ─────────────────────────────────────────────
function PasswordModal({
  pendingUrl,
  onSuccess,
  onCancel,
}: {
  pendingUrl: string
  onSuccess: (password: string) => void
  onCancel: () => void
}) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const ok = await apiVerifyPassword(input)
    setLoading(false)
    if (ok) {
      localStorage.setItem(UNLOCK_KEY, input)
      if (pendingUrl) window.open(pendingUrl, '_blank', 'noopener,noreferrer')
      onSuccess(input)
    } else {
      setError('密碼錯誤，請再試一次')
      setInput('')
    }
  }

  const card: React.CSSProperties = {
    backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: '20px', padding: '40px 44px', width: '340px',
    color: 'white', fontFamily: FONT_STACK,
    boxShadow: '0 0 80px rgba(192,132,252,0.18), inset 0 1px 0 rgba(255,255,255,0.08)',
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(5,8,20,0.88)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div style={card}>
        <div style={{ fontSize: '10px', color: 'rgba(192,132,252,0.75)', letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: '14px', fontWeight: '500' }}>
          🔒 私領域網站
        </div>
        <div style={{ fontSize: '20px', fontWeight: '600', marginBottom: '8px' }}>輸入密碼</div>
        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.42)', marginBottom: '28px', lineHeight: '1.6' }}>
          此為私領域網站，請輸入密碼以繼續。<br />本裝置驗證後將不再詢問。
        </div>
        <form onSubmit={e => { void handleSubmit(e) }}>
          <input
            type="password" value={input} autoFocus placeholder="••••••"
            disabled={loading}
            onChange={e => { setInput(e.target.value); setError('') }}
            style={{
              width: '100%', padding: '12px 16px', background: 'rgba(0,0,0,0.35)',
              border: `1px solid ${error ? 'rgba(248,113,113,0.6)' : 'rgba(255,255,255,0.14)'}`,
              borderRadius: '10px', color: 'white', fontSize: '15px',
              fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', letterSpacing: '0.18em',
            }}
          />
          {error && <div style={{ fontSize: '12px', color: 'rgba(248,113,113,0.9)', marginTop: '8px' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
            <button type="button" onClick={onCancel}
              style={{ flex: 1, padding: '11px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', color: 'rgba(255,255,255,0.5)', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' }}>
              取消
            </button>
            <button type="submit" disabled={loading}
              style={{ flex: 2, padding: '11px', background: 'rgba(192,132,252,0.14)', border: '1px solid rgba(192,132,252,0.38)', borderRadius: '10px', color: '#c084fc', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit', opacity: loading ? 0.6 : 1 }}>
              {loading ? '驗證中…' : '確認進入'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Admin Panel
// ─────────────────────────────────────────────
const inputSt: React.CSSProperties = {
  padding: '9px 12px', background: 'rgba(0,0,0,0.3)',
  border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px',
  color: 'white', fontSize: '13px',
  fontFamily: FONT_STACK,
  outline: 'none', boxSizing: 'border-box', width: '100%',
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', letterSpacing: '0.08em', marginBottom: '6px' }}>{label}</div>
      {children}
    </div>
  )
}

const BLANK_FORM = (): Omit<SiteData, 'id' | 'worldXZ'> => ({
  name: '', subtitle: '', links: [{ label: '進入系統', url: '' }], isPrivate: false, subsystemId: null,
})

interface AdminPanelProps {
  sites: SiteData[]
  adminPassword: string
  onAdd: (data: Omit<SiteData, 'id'>) => Promise<void>
  onEdit: (id: string, data: Partial<Omit<SiteData, 'id'>>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onClose: () => void
}

function AdminPanel({ sites, adminPassword, onAdd, onEdit, onDelete, onClose }: AdminPanelProps) {
  const [editing, setEditing] = useState<SiteData | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [form, setForm] = useState(BLANK_FORM())
  const [busy, setBusy] = useState(false)
  const [apiError, setApiError] = useState('')

  void adminPassword

  const openEdit = (s: SiteData) => {
    setEditing(s); setAdding(false); setApiError('')
    setForm({ name: s.name, subtitle: s.subtitle, links: s.links.map(l => ({ ...l })), isPrivate: s.isPrivate, subsystemId: s.subsystemId })
  }
  const openAdd = () => {
    setAdding(true); setEditing(null); setApiError('')
    setForm(BLANK_FORM())
  }
  const closeForm = () => { setEditing(null); setAdding(false); setApiError('') }

  const handleDelete = async (id: string) => {
    setBusy(true)
    try {
      await onDelete(id)
      setConfirmDelete(null)
      if (editing?.id === id) closeForm()
    } catch {
      setApiError('刪除失敗，請再試一次')
    } finally {
      setBusy(false)
    }
  }

  const handleSave = async () => {
    const links = form.links.filter(l => l.url.trim())
    if (!form.name.trim() || links.length === 0) return
    setBusy(true)
    setApiError('')
    try {
      const subsystemId = form.subsystemId?.trim() || null
      if (adding) {
        const worldXZ = nextPosition(sites, form.isPrivate)
        await onAdd({ name: form.name.trim(), subtitle: form.subtitle.trim(), links, worldXZ, isPrivate: form.isPrivate, subsystemId })
      } else if (editing) {
        await onEdit(editing.id, { name: form.name.trim(), subtitle: form.subtitle.trim(), links, isPrivate: form.isPrivate, subsystemId })
      }
      closeForm()
    } catch {
      setApiError('儲存失敗，請再試一次')
    } finally {
      setBusy(false)
    }
  }

  const setLink = (idx: number, field: keyof SiteLink, val: string) =>
    setForm(f => { const links = f.links.map((l, i) => i === idx ? { ...l, [field]: val } : l); return { ...f, links } })

  const addLink = () => setForm(f => ({ ...f, links: [...f.links, { label: '', url: '' }] }))
  const removeLink = (idx: number) => setForm(f => ({ ...f, links: f.links.filter((_, i) => i !== idx) }))

  const showForm = adding || editing !== null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 8888, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(5,8,20,0.92)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}>
      <div style={{
        width: '680px', maxWidth: '95vw', maxHeight: '88vh', overflowY: 'auto',
        backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '20px', padding: '32px 36px',
        color: 'white', fontFamily: FONT_STACK,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px' }}>
          <div>
            <div style={{ fontSize: '10px', color: 'rgba(0,229,255,0.6)', letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: '6px' }}>⚙ 管理後台</div>
            <div style={{ fontSize: '20px', fontWeight: '600' }}>網站管理</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', padding: '8px 18px', cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit' }}>
            關閉
          </button>
        </div>

        {apiError && (
          <div style={{ marginBottom: '14px', padding: '10px 14px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: '8px', fontSize: '12px', color: 'rgba(248,113,113,0.9)' }}>
            {apiError}
          </div>
        )}

        {/* Zone legend */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', color: 'rgba(0,229,255,0.55)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#00e5ff', display: 'inline-block', opacity: 0.7 }} />
            公領域 — 場景左側
          </div>
          <div style={{ fontSize: '11px', color: 'rgba(192,132,252,0.55)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#c084fc', display: 'inline-block', opacity: 0.7 }} />
            私領域 — 場景右側
          </div>
        </div>

        {/* Site list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
          {sites.map(s => (
            <div key={s.id}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '12px 16px',
                background: editing?.id === s.id ? 'rgba(0,229,255,0.05)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${editing?.id === s.id ? 'rgba(0,229,255,0.22)' : 'rgba(255,255,255,0.07)'}`,
                borderRadius: confirmDelete === s.id ? '10px 10px 0 0' : '10px',
              }}>
                <span style={{
                  fontSize: '10px', padding: '2px 7px', borderRadius: '4px', whiteSpace: 'nowrap',
                  background: s.isPrivate ? 'rgba(192,132,252,0.12)' : 'rgba(0,229,255,0.1)',
                  color: s.isPrivate ? '#c084fc' : '#00e5ff',
                  border: `1px solid ${s.isPrivate ? 'rgba(192,132,252,0.28)' : 'rgba(0,229,255,0.28)'}`,
                }}>
                  {s.isPrivate ? '私' : '公'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: '500', color: 'rgba(255,255,255,0.92)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.32)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.links[0]?.url}</div>
                </div>
                <button onClick={() => openEdit(s)} disabled={busy} style={{ padding: '6px 12px', background: 'rgba(0,229,255,0.08)', border: '1px solid rgba(0,229,255,0.25)', borderRadius: '7px', color: '#00e5ff', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                  編輯
                </button>
                <button
                  onClick={() => setConfirmDelete(confirmDelete === s.id ? null : s.id)}
                  disabled={busy}
                  style={{ padding: '6px 12px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: '7px', color: '#f87171', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                  刪除
                </button>
              </div>
              {confirmDelete === s.id && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.2)', borderTop: 'none', borderRadius: '0 0 10px 10px' }}>
                  <span style={{ flex: 1, fontSize: '12px', color: 'rgba(248,113,113,0.85)' }}>確定刪除「{s.name}」？</span>
                  <button onClick={() => setConfirmDelete(null)} style={{ padding: '5px 12px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}>取消</button>
                  <button onClick={() => { void handleDelete(s.id) }} disabled={busy} style={{ padding: '5px 12px', background: 'rgba(248,113,113,0.14)', border: '1px solid rgba(248,113,113,0.4)', borderRadius: '6px', color: '#f87171', fontSize: '12px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}>確定刪除</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {!showForm && (
          <button onClick={openAdd} disabled={busy} style={{ width: '100%', padding: '11px', background: 'rgba(0,229,255,0.06)', border: '1px dashed rgba(0,229,255,0.28)', borderRadius: '10px', color: '#00e5ff', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.06em' }}>
            ＋ 新增網站
          </button>
        )}

        {showForm && (
          <div style={{ marginTop: '12px', padding: '22px 24px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}>
            <div style={{ fontSize: '13px', fontWeight: '600', color: 'rgba(255,255,255,0.8)', marginBottom: '18px' }}>
              {adding ? '新增網站' : '編輯網站'}
            </div>

            <FormField label="名稱">
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="系統名稱" style={inputSt} />
            </FormField>

            <FormField label="副標題（選填）">
              <input value={form.subtitle} onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))} placeholder="English subtitle" style={inputSt} />
            </FormField>

            <FormField label="領域設定">
              <div style={{ display: 'flex', gap: '8px' }}>
                {([false, true] as const).map(priv => (
                  <button key={String(priv)} onClick={() => setForm(f => ({ ...f, isPrivate: priv }))}
                    style={{
                      padding: '7px 18px',
                      background: form.isPrivate === priv ? (priv ? 'rgba(192,132,252,0.18)' : 'rgba(0,229,255,0.14)') : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${form.isPrivate === priv ? (priv ? 'rgba(192,132,252,0.5)' : 'rgba(0,229,255,0.45)') : 'rgba(255,255,255,0.1)'}`,
                      borderRadius: '7px',
                      color: form.isPrivate === priv ? (priv ? '#c084fc' : '#00e5ff') : 'rgba(255,255,255,0.4)',
                      fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                    {priv ? '🔒 私領域（右側）' : '🌐 公領域（左側）'}
                  </button>
                ))}
              </div>
            </FormField>

            <FormField label="儀表板摘要來源 ID（選填）">
              <input
                value={form.subsystemId ?? ''}
                onChange={e => setForm(f => ({ ...f, subsystemId: e.target.value }))}
                placeholder="例如 pf-cwh，留空則顯示為一般連結卡"
                style={inputSt}
              />
            </FormField>

            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', letterSpacing: '0.08em', marginBottom: '8px' }}>連結</div>
              {form.links.map((link, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <input value={link.label} onChange={e => setLink(idx, 'label', e.target.value)} placeholder="按鈕文字" style={{ ...inputSt, width: '100px', flex: '0 0 100px' }} />
                  <input value={link.url} onChange={e => setLink(idx, 'url', e.target.value)} placeholder="https://..." style={{ ...inputSt, flex: 1 }} />
                  {form.links.length > 1 && (
                    <button onClick={() => removeLink(idx)} style={{ background: 'none', border: '1px solid rgba(248,113,113,0.3)', borderRadius: '7px', color: 'rgba(248,113,113,0.7)', padding: '0 10px', cursor: 'pointer', fontSize: '16px', fontFamily: 'inherit', flexShrink: 0 }}>×</button>
                  )}
                </div>
              ))}
              {form.links.length < 3 && (
                <button onClick={addLink} style={{ fontSize: '11px', color: 'rgba(0,229,255,0.6)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', fontFamily: 'inherit', letterSpacing: '0.04em' }}>
                  ＋ 新增連結
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button onClick={closeForm} disabled={busy} style={{ flex: 1, padding: '10px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '9px', color: 'rgba(255,255,255,0.5)', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' }}>
                取消
              </button>
              <button onClick={() => { void handleSave() }} disabled={busy} style={{ flex: 2, padding: '10px', background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.38)', borderRadius: '9px', color: '#00e5ff', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1 }}>
                {busy ? '儲存中…' : '儲存'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Admin Auth Modal — verifies via API
// ─────────────────────────────────────────────
function AdminAuthModal({ onSuccess, onCancel }: { onSuccess: (pw: string) => void; onCancel: () => void }) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const ok = await apiVerifyPassword(input)
    setLoading(false)
    if (ok) {
      onSuccess(input)
    } else {
      setError('通行碼錯誤')
      setInput('')
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(5,8,20,0.88)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div style={{ backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '20px', padding: '36px 40px', width: '320px', color: 'white', fontFamily: FONT_STACK }}>
        <div style={{ fontSize: '10px', color: 'rgba(0,229,255,0.6)', letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: '12px' }}>⚙ 管理後台</div>
        <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '20px' }}>輸入通行碼</div>
        <form onSubmit={e => { void handleSubmit(e) }}>
          <input type="password" value={input} autoFocus placeholder="••••••••"
            disabled={loading}
            onChange={e => { setInput(e.target.value); setError('') }}
            style={{ width: '100%', padding: '11px 14px', background: 'rgba(0,0,0,0.35)', border: `1px solid ${error ? 'rgba(248,113,113,0.6)' : 'rgba(255,255,255,0.14)'}`, borderRadius: '9px', color: 'white', fontSize: '15px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', letterSpacing: '0.18em' }} />
          {error && <div style={{ fontSize: '12px', color: 'rgba(248,113,113,0.9)', marginTop: '8px' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button type="button" onClick={onCancel} style={{ flex: 1, padding: '10px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '9px', color: 'rgba(255,255,255,0.5)', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' }}>取消</button>
            <button type="submit" disabled={loading} style={{ flex: 2, padding: '10px', background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.35)', borderRadius: '9px', color: '#00e5ff', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit', opacity: loading ? 0.6 : 1 }}>
              {loading ? '驗證中…' : '進入'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Version History Panel
// ─────────────────────────────────────────────
function VersionHistory() {
  const [expanded, setExpanded] = useState(false)
  const latest = VERSION_HISTORY[0]
  return (
    <div style={{ position: 'absolute', bottom: '1.5rem', left: '1.5rem', zIndex: 100, fontFamily: FONT_STACK }}>
      <button onClick={() => setExpanded(x => !x)} style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        background: 'rgba(5,8,20,0.75)', backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px',
        padding: '8px 14px', cursor: 'pointer', fontSize: '11px', fontFamily: 'inherit',
        color: 'rgba(255,255,255,0.7)',
      }}>
        <span style={{ color: '#00e5ff', fontWeight: '600' }}>v{latest.version}</span>
        <span style={{ color: 'rgba(255,255,255,0.38)' }}>{latest.summary}</span>
        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '9px', marginLeft: '2px' }}>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div style={{
          marginTop: '8px', background: 'rgba(5,8,20,0.88)', backdropFilter: 'blur(14px)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px',
          padding: '18px 20px', width: '290px', maxHeight: '60vh', overflowY: 'auto',
        }}>
          {VERSION_HISTORY.map((v, vi) => (
            <div key={v.version} style={{ marginBottom: vi < VERSION_HISTORY.length - 1 ? '18px' : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px' }}>
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#00e5ff' }}>v{v.version}</span>
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.32)', letterSpacing: '0.04em' }}>{v.date}</span>
              </div>
              <ul style={{ margin: 0, padding: '0 0 0 14px' }}>
                {v.changes.map((c, ci) => (
                  <li key={ci} style={{ fontSize: '11px', color: 'rgba(255,255,255,0.58)', lineHeight: '1.7' }}>{c}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// Glass Portal View — Glassmorphism + Particles
// ─────────────────────────────────────────────
const PORTAL_ICONS = ['⚡', '🔮', '🌐', '📊', '🗺️', '💫', '🎯', '🏆', '⚔️', '🛡️', '🧭', '🔬']

// Floating particle canvas — mouse-attracted dots + connecting lines
// PS4 風格波浪背景 — 五層疊加的 sine 波面 + 漂浮塵埃粒子，取代原本的滑鼠吸附
// 粒子場。色相沿著入口網既有的青(186°，公領域) → 紫(270°，私領域) 語意漸層排列，
// 不是隨機配色。維持跟舊版一樣的掛載介面（無 props、absolute inset:0 canvas），
// 呼叫方（GlassPortalView）完全不用改。
const WAVE_LAYERS = [
  { base: 0.40, a: [46, 24, 12], k: [0.0018, 0.0038, 0.0072], s: [0.35, -0.28, 0.45], p: [0.0, 2.1, 4.2], hue: CARD_HUE.cyan, alpha: 0.10, par: 24 },
  { base: 0.50, a: [60, 30, 15], k: [0.0015, 0.0031, 0.0063], s: [-0.30, 0.36, -0.50], p: [1.3, 3.7, 0.6], hue: 210, alpha: 0.12, par: 38 },
  { base: 0.60, a: [66, 32, 17], k: [0.0013, 0.0028, 0.0058], s: [0.26, -0.40, 0.55], p: [2.6, 0.9, 5.1], hue: 235, alpha: 0.13, par: 54 },
  { base: 0.70, a: [56, 27, 13], k: [0.0016, 0.0034, 0.0068], s: [-0.32, 0.30, -0.42], p: [4.0, 5.5, 1.8], hue: 255, alpha: 0.12, par: 72 },
  { base: 0.80, a: [50, 23, 11], k: [0.0014, 0.0030, 0.0060], s: [0.28, -0.34, 0.48], p: [5.2, 1.6, 3.3], hue: CARD_HUE.purple, alpha: 0.10, par: 92 },
] as const

const WAVE_DUST_HUES = [CARD_HUE.cyan, 210, 235, CARD_HUE.purple]

function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let animId: number
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let W = 0, H = 0, HS = 1
    const resize = () => {
      const DPR = Math.min(window.devicePixelRatio || 1, 1.5)
      W = window.innerWidth
      H = window.innerHeight
      canvas.width = W * DPR
      canvas.height = H * DPR
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
      HS = Math.min(1.4, Math.max(0.7, H / 800))
    }

    let dust: Array<{ x: number; y: number; r: number; vy: number; sway: number; swaySpd: number; hue: number; tw: number }> = []
    const initDust = () => {
      const n = Math.min(90, Math.floor((W * H) / 22000))
      dust = Array.from({ length: n }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 0.6 + Math.random() * 1.5,
        vy: 0.08 + Math.random() * 0.28,
        sway: Math.random() * Math.PI * 2,
        swaySpd: 0.3 + Math.random() * 0.6,
        hue: WAVE_DUST_HUES[(Math.random() * WAVE_DUST_HUES.length) | 0]!,
        tw: Math.random() * Math.PI * 2,
      }))
    }

    resize()
    initDust()

    let mx = 0, my = 0, smx = 0, smy = 0
    const onMouse = (e: MouseEvent) => {
      mx = (e.clientX / W - 0.5) * 2
      my = (e.clientY / H - 0.5) * 2
    }
    window.addEventListener('mousemove', onMouse)

    let t = 0

    const waveY = (L: typeof WAVE_LAYERS[number], x: number, phaseShift: number, yOff: number) =>
      L.base * H + yOff
      + Math.sin(x * L.k[0] + t * L.s[0] + L.p[0] + phaseShift) * L.a[0] * HS
      + Math.sin(x * L.k[1] - t * L.s[1] + L.p[1] + phaseShift * 0.6) * L.a[1] * HS
      + Math.sin(x * L.k[2] + t * L.s[2] + L.p[2]) * L.a[2] * HS

    const drawFrame = () => {
      ctx.clearRect(0, 0, W, H)
      smx += (mx - smx) * 0.03
      smy += (my - smy) * 0.03

      ctx.globalCompositeOperation = 'lighter'

      const STEP = 6
      for (const L of WAVE_LAYERS) {
        const yOff = smy * L.par
        const phaseShift = smx * L.par * 0.02

        ctx.beginPath()
        ctx.moveTo(-10, waveY(L, -10, phaseShift, yOff))
        for (let x = 0; x <= W + STEP; x += STEP) {
          ctx.lineTo(x, waveY(L, x, phaseShift, yOff))
        }

        const top = L.base * H - 140 * HS + yOff
        const grad = ctx.createLinearGradient(0, top, 0, H)
        grad.addColorStop(0, `hsla(${L.hue}, 85%, 62%, ${L.alpha})`)
        grad.addColorStop(0.55, `hsla(${L.hue}, 80%, 55%, ${L.alpha * 0.35})`)
        grad.addColorStop(1, `hsla(${L.hue}, 80%, 50%, 0)`)
        ctx.lineTo(W + 10, H + 10)
        ctx.lineTo(-10, H + 10)
        ctx.closePath()
        ctx.fillStyle = grad
        ctx.fill()

        ctx.beginPath()
        ctx.moveTo(-10, waveY(L, -10, phaseShift, yOff))
        for (let x = 0; x <= W + STEP; x += STEP) {
          ctx.lineTo(x, waveY(L, x, phaseShift, yOff))
        }
        ctx.strokeStyle = `hsla(${L.hue}, 90%, 74%, ${L.alpha * 1.6})`
        ctx.lineWidth = 1.4
        ctx.stroke()
      }

      for (const d of dust) {
        d.y -= d.vy
        d.x += Math.sin(t * d.swaySpd + d.sway) * 0.25
        if (d.y < -12) { d.y = H + 12; d.x = Math.random() * W }
        if (d.x < -12) d.x = W + 12
        if (d.x > W + 12) d.x = -12
        const twinkle = 0.22 + 0.22 * Math.sin(t * 2 + d.tw)
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${d.hue}, 85%, 82%, ${twinkle})`
        ctx.fill()
      }

      ctx.globalCompositeOperation = 'source-over'
    }

    if (reduced) {
      drawFrame()
    } else {
      const loop = () => {
        t += 0.012
        drawFrame()
        animId = requestAnimationFrame(loop)
      }
      loop()
    }

    const handleResize = () => { resize(); initDust(); if (reduced) drawFrame() }
    window.addEventListener('resize', handleResize)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('mousemove', onMouse)
    }
  }, [])

  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }} />
}

// Mouse-spotlight only (no tilt) — used on the motion.div-based cards
// (GlassCard/GlassSummaryCard) whose hover lift is already driven by
// framer-motion's `whileHover`; writing raw `element.style.transform` from
// a separate rAF loop (as useTilt3D below does) would fight framer-motion's
// own transform management, so those two cards get the spotlight/silk/beam
// surface treatment but not the imperative 3D tilt.
function handleSpotlightMove(e: React.MouseEvent<HTMLElement>) {
  const el = e.currentTarget
  const r = el.getBoundingClientRect()
  const px = (e.clientX - r.left) / r.width
  const py = (e.clientY - r.top) / r.height
  el.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`)
  el.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`)
}

// Vanilla-JS 3D tilt + spotlight — for the plain-<div> cards (HappinessHeroCard,
// MindIndexCard) which don't go through framer-motion, so there's no
// competing transform system to fight. Small max angle (content-heavy cards
// with a radar chart/text, not a single stat number — a big tilt would be
// distracting, matching the demo's own gentler ".panel" tilt config rather
// than its small ".stat-card" tilt config).
function useTilt3D(maxDeg = 3, scale = 1.008) {
  const ref = useRef<HTMLDivElement>(null)
  const state = useRef({ rx: 0, ry: 0, trx: 0, try_: 0, hov: false, raf: 0 })

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const s = state.current
    const loop = () => {
      s.rx += (s.trx - s.rx) * 0.12
      s.ry += (s.try_ - s.ry) * 0.12
      const el = ref.current
      if (el) {
        const sc = s.hov ? scale : 1
        el.style.transform = `perspective(900px) rotateX(${s.rx.toFixed(2)}deg) rotateY(${s.ry.toFixed(2)}deg) scale3d(${sc},${sc},${sc})`
      }
      s.raf = requestAnimationFrame(loop)
    }
    s.raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(s.raf)
  }, [maxDeg, scale])

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width - 0.5
    const py = (e.clientY - r.top) / r.height - 0.5
    state.current.try_ = px * maxDeg
    state.current.trx = -py * maxDeg
    state.current.hov = true
    el.style.setProperty('--gx', `${((px + 0.5) * 100).toFixed(1)}%`)
    el.style.setProperty('--gy', `${((py + 0.5) * 100).toFixed(1)}%`)
  }, [maxDeg])

  const onMouseLeave = useCallback(() => {
    state.current.trx = 0
    state.current.try_ = 0
    state.current.hov = false
  }, [])

  return { ref, onMouseMove, onMouseLeave }
}

// `--card-hue` custom property lookup for the glass shell's silk/beam
// layers (portal.css) — React style objects allow custom properties via a
// plain string key, just needs a cast since CSSProperties doesn't type them.
function hueVar(hue: number): React.CSSProperties {
  return { '--card-hue': hue } as React.CSSProperties
}

function GlassCard({
  site,
  index,
  unlocked,
  onSelect,
}: {
  site: SiteData
  index: number
  unlocked: boolean
  onSelect: (site: SiteData) => void
}) {
  const [clicked, setClicked] = useState(false)
  const isLocked = site.isPrivate && !unlocked
  const accent = site.isPrivate ? '#c084fc' : '#00e5ff'
  const rgb = site.isPrivate ? '192,132,252' : '0,229,255'

  const handleClick = () => {
    if (clicked) return
    setClicked(true)
    setTimeout(() => { setClicked(false); onSelect(site) }, 280)
  }

  return (
    <motion.div
      className="glass-shell"
      initial={{ opacity: 0, y: 18, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.05, duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ scale: 1.05, y: -5, transition: { duration: 0.18 } }}
      onClick={handleClick}
      onMouseMove={handleSpotlightMove}
      style={{
        position: 'relative',
        cursor: 'pointer',
        background: 'rgba(255,255,255,0.055)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: `1px solid rgba(${rgb},0.22)`,
        borderRadius: '18px',
        padding: '1.2rem 1.3rem 1rem',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: `0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)`,
        zIndex: 2,
        ...hueVar(site.isPrivate ? CARD_HUE.purple : CARD_HUE.cyan),
      }}
    >
      <div className="silk"><i className="w1" /><i className="w2" /></div>
      <div className="beam" />
      {clicked && (
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '18px',
          background: `radial-gradient(circle at center, rgba(${rgb},0.32) 0%, transparent 70%)`,
          animation: 'fight-flash 0.28s ease forwards',
          pointerEvents: 'none', zIndex: 10,
        }} />
      )}
      {/* Top shimmer line */}
      <div style={{
        position: 'absolute', top: 0, left: '18%', right: '18%', height: '1px',
        background: `linear-gradient(90deg, transparent, rgba(${rgb},0.6), transparent)`,
      }} />

      {/* Icon */}
      <div style={{
        fontSize: 'clamp(1.8rem, 2.6vw, 2.4rem)',
        lineHeight: 1, marginBottom: '0.6rem',
        filter: `drop-shadow(0 0 8px rgba(${rgb},0.55))`,
      }}>
        {isLocked ? '🔒' : PORTAL_ICONS[index % PORTAL_ICONS.length]}
      </div>

      {/* Name */}
      <div style={{
        color: accent,
        fontSize: 'clamp(0.95rem, 1.3vw, 1.15rem)',
        fontWeight: '600',
        fontFamily: FONT_STACK,
        letterSpacing: '0.02em',
        marginBottom: '0.25rem',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        textShadow: `0 0 12px rgba(${rgb},0.55)`,
        lineHeight: 1.3,
      }}>{site.name}</div>

      {/* Subtitle */}
      {site.subtitle && (
        <div style={{
          color: 'rgba(255,255,255,0.4)',
          fontSize: 'clamp(0.75rem, 1vw, 0.85rem)',
          fontFamily: FONT_STACK,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          marginBottom: '0.5rem', lineHeight: 1.3,
        }}>{site.subtitle}</div>
      )}

      <div style={{ flex: 1 }} />

      {/* Footer */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        paddingTop: '0.6rem',
        borderTop: `1px solid rgba(${rgb},0.13)`,
        marginTop: '0.5rem',
      }}>
        <span style={{
          color: 'rgba(255,255,255,0.3)',
          fontSize: 'clamp(0.68rem, 0.9vw, 0.78rem)',
          fontFamily: FONT_STACK,
          letterSpacing: '0.06em',
        }}>
          {site.links.length} LINK{site.links.length !== 1 ? 'S' : ''}
        </span>
        <span style={{
          color: isLocked ? '#fbbf24' : `rgba(${rgb},0.8)`,
          fontSize: 'clamp(0.68rem, 0.9vw, 0.78rem)',
          fontFamily: FONT_STACK,
          letterSpacing: '0.05em', fontWeight: '500',
        }}>
          {isLocked ? '🔐 LOCKED' : (site.isPrivate ? 'PRIVATE' : 'PUBLIC')}
        </span>
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────
// Glass Summary Card — rich dashboard widget for subsystems with a
// /api/public/summary source (see lib/summarySources.ts on the api-server)
// ─────────────────────────────────────────────
function formatTWD(n: number): string {
  return `NT$ ${Math.round(n).toLocaleString('zh-TW')}`
}

function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '資料不足'
  const pct = n * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

function formatMinutesAgo(iso: string | null): string {
  if (!iso) return '尚未取得'
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return '剛剛更新'
  if (mins < 60) return `${mins} 分鐘前更新`
  return `${Math.round(mins / 60)} 小時前更新`
}

// ── Shared hero-index + supporting-stats layout ──
// Each subsystem card leads with one big composite index (the "so what" you
// can't get from glancing at the subsystem itself) and a few raw supporting
// numbers underneath. `invert` flips the color/label bands for indices where
// LOWER is better (e.g. a busyness score) instead of higher.
function heroTone(score: number | null, invert: boolean): { color: string; label: string } {
  if (score === null) return { color: 'rgba(255,255,255,0.4)', label: '資料不足' }
  const s = invert ? 100 - score : score
  if (s >= 80) return { color: '#34d399', label: invert ? '輕鬆' : '優異' }
  if (s >= 50) return { color: '#fbbf24', label: '普通' }
  return { color: '#f87171', label: invert ? '緊繃' : '待加強' }
}

// `formula` is NOT rendered here — hover tooltips don't work on touch, so
// every number's formula instead collects into a single tap-to-expand
// FormulaPanel per card (below), matching the HHI card's "展開明細" pattern.
function HeroIndex({ label, score, invert = false }: { label: string; score: number | null; invert?: boolean }) {
  const tone = heroTone(score, invert)
  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '5px' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
        <div style={{ fontSize: 'clamp(2.4rem, 4vw, 3.2rem)', fontWeight: '700', lineHeight: 1, color: tone.color, textShadow: `0 0 26px ${tone.color}66` }}>
          {score !== null ? score : '—'}
        </div>
        <div style={{ fontSize: '15px', fontWeight: '600', color: tone.color }}>{tone.label}</div>
      </div>
    </div>
  )
}

function SupportStats({ items }: { items: Array<{ label: string; value: string; color?: string; formula?: string; tier?: string }> }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.6rem 2rem' }}>
      {items.map(it => (
        <div key={it.label}>
          <div style={{ fontSize: '11.5px', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.05em', marginBottom: '3px' }}>{it.label}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
            <span style={{ fontSize: '18px', fontWeight: '600', color: it.color ?? 'rgba(255,255,255,0.9)' }}>{it.value}</span>
            {it.tier && <span style={{ fontSize: '10.5px', fontWeight: '600', color: it.color }}>{it.tier}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

// Tap-to-expand formula detail — same visual pattern as the HHI card's
// "展開明細": a footer toggle line, then a dashed-border panel of
// label/formula rows. Works identically on mouse and touch, unlike the
// native `title` hover tooltip this replaced (which never triggers on
// mobile since there's no hover state to trigger it).
function FormulaToggle({ expanded, onToggle }: { expanded: boolean; onToggle: (e: React.MouseEvent) => void }) {
  return (
    <div
      onClick={onToggle}
      style={{ marginTop: '0.6rem', textAlign: 'right', fontSize: '10.5px', color: 'rgba(192,132,252,0.7)', cursor: 'pointer' }}
    >
      {expanded ? '收起公式說明 ▲' : '公式說明 ▼'}
    </div>
  )
}

function FormulaPanel({ rows }: { rows: Array<{ label: string; formula?: string }> }) {
  const withFormula = rows.filter((r): r is { label: string; formula: string } => !!r.formula)
  if (withFormula.length === 0) return null
  return (
    <div style={{ marginTop: '0.6rem', paddingTop: '0.7rem', borderTop: '1px dashed rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {withFormula.map(r => (
        <div key={r.label} style={{ fontSize: '11px' }}>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontWeight: '600', marginBottom: '2px' }}>{r.label}</div>
          <div style={{ color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>{r.formula}</div>
        </div>
      ))}
    </div>
  )
}

function PfCwhSummaryBody({ data, expanded, onToggleExpand }: { data: Record<string, unknown>; expanded: boolean; onToggleExpand: (e: React.MouseEvent) => void }) {
  const lifeFreedomIndex = typeof data['lifeFreedomIndex'] === 'number' ? data['lifeFreedomIndex'] : null
  const totalAssetsTWD = typeof data['totalAssetsTWD'] === 'number' ? data['totalAssetsTWD'] : null
  const twrr = typeof data['twrr'] === 'number' ? data['twrr'] : null
  const mwrr = typeof data['mwrr'] === 'number' ? data['mwrr'] : null
  const pacingIndex = typeof data['pacingIndex'] === 'number' ? data['pacingIndex'] : null

  const items = [
    { label: '總資產', value: totalAssetsTWD !== null ? formatTWD(totalAssetsTWD) : '—', formula: '目前資產總市值（最新一筆快照）' },
    { label: 'TWRR', value: formatPct(twrr), color: twrr === null ? undefined : (twrr >= 0 ? '#34d399' : '#f87171'), formula: '時間加權報酬率——排除加減碼時機影響，純看資產本身的報酬表現' },
    { label: 'MWRR', value: formatPct(mwrr), color: mwrr === null ? undefined : (mwrr >= 0 ? '#34d399' : '#f87171'), formula: '金額加權報酬率——考慮加減碼金額與時機，反映實際到手的報酬' },
    { label: '休假配速', value: pacingIndex !== null ? `${Math.round(pacingIndex * 100)}%` : '—', formula: '休假進度 ÷ 年度時間進度，100% = 剛好照今年時間進度休假' },
  ]

  return (
    <div style={{ flex: 1 }}>
      <HeroIndex label="人生自由指數" score={lifeFreedomIndex} />
      <SupportStats items={items} />
      <FormulaToggle expanded={expanded} onToggle={onToggleExpand} />
      {expanded && (
        <FormulaPanel rows={[
          { label: '人生自由指數', formula: '資產分／報酬分／休假配速分，各自正規化到 0-100 後取平均（缺項就用剩下的取平均，不會整個是 0）' },
          ...items,
        ]} />
      )}
    </div>
  )
}

// Shared radar chart with axis labels + values — used by both the
// FitnessForge card's muscle-composite radar and the HHI card's 4-dimension
// radar. Absolute scale (0..maxValue, not "whatever's biggest right now"):
// self-relative scaling always fills the chart to 100% regardless of actual
// progress, which is both misleading and makes the shape barely change
// visit to visit. `baselineFraction` (0-1 of maxValue) optionally draws a
// dashed reference ring, matching FitnessForge's own "維持基準" dashed line.
function LabeledRadarChart({
  axes,
  maxValue,
  baselineFraction,
  size = 240,
  color,
}: {
  axes: Array<{ label: string; value: number | null }>
  maxValue: number
  baselineFraction?: number
  size?: number
  color: string
}) {
  const cx = size / 2, cy = size / 2
  const r = size * 0.30
  const n = axes.length
  const angleAt = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2
  const pointAt = (i: number, radius: number) => [cx + radius * Math.cos(angleAt(i)), cy + radius * Math.sin(angleAt(i))] as const
  const ringPoints = (frac: number) => axes.map((_, i) => pointAt(i, r * frac)).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const dataPoints = axes
    .map((a, i) => pointAt(i, r * (Math.max(0, Math.min(maxValue, a.value ?? 0)) / maxValue)))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0, overflow: 'visible' }}>
      <polygon points={ringPoints(1)} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
      <polygon points={ringPoints(0.5)} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
      {baselineFraction !== undefined && (
        <polygon points={ringPoints(baselineFraction)} fill="none" stroke={COLOR.gold} strokeWidth={1.3} strokeDasharray="4 3" />
      )}
      {axes.map((_, i) => {
        const [x, y] = pointAt(i, r)
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
      })}
      <polygon points={dataPoints} fill={`${color}33`} stroke={color} strokeWidth={2} />
      {axes.map((a, i) => {
        const ang = angleAt(i)
        const [x, y] = pointAt(i, r + 20)
        const cos = Math.cos(ang)
        const anchor = cos > 0.35 ? 'start' : cos < -0.35 ? 'end' : 'middle'
        return (
          <text key={a.label} x={x} y={y} textAnchor={anchor} dominantBaseline="middle" fontSize="11" fill="rgba(255,255,255,0.6)">
            {a.label}{a.value !== null ? ` ${Math.round(a.value)}` : ''}
          </text>
        )
      })}
    </svg>
  )
}

const MUSCLE_GROUP_AXES = ['胸', '背', '腿', '肩', '二头肌', '核心', '臀', '三头肌', '有氧']

function FitnessForgeSummaryBody({ data, expanded, onToggleExpand }: { data: Record<string, unknown>; expanded: boolean; onToggleExpand: (e: React.MouseEvent) => void }) {
  const habitIndex = typeof data['habitIndex'] === 'number' ? data['habitIndex'] : null
  const weeklyScore = typeof data['weeklyScore'] === 'number' ? data['weeklyScore'] : null
  const trendPct = typeof data['trendPct'] === 'number' ? data['trendPct'] : null
  const balanceScore = typeof data['balanceScore'] === 'number' ? data['balanceScore'] : null
  const coverageScore = typeof data['coverageScore'] === 'number' ? data['coverageScore'] : null
  const activityBonusPoints = typeof data['activityBonusPoints'] === 'number' ? data['activityBonusPoints'] : 0
  // 跟主站自己的雷達圖同一組複合分（0-150%，維持基準=100%），不是拿
  // muscleGroups 的原始組數/容量數字自己重新正規化——那樣每次都會填滿雷達圖，
  // 跟主站雷達圖對不上，也看不出真的有沒有進步（見 FitnessForge v3.15）。
  const muscleComposites = Array.isArray(data['muscleComposites'])
    ? data['muscleComposites'] as Array<{ name: string; composite: number }>
    : []
  const radarAxes = MUSCLE_GROUP_AXES.map(name => ({
    label: name,
    value: muscleComposites.find(m => m.name === name)?.composite ?? null,
  }))

  const items = [
    { label: '本週積分', value: weeklyScore !== null ? weeklyScore.toLocaleString('zh-TW') : '—', formula: '本週各筆訓練紀錄的加權分數總和（原始累積量，未經配速調整）' },
    { label: '趨勢', value: trendPct !== null ? `${trendPct >= 0 ? '+' : ''}${trendPct.toFixed(1)}%` : '—', color: trendPct === null ? undefined : (trendPct >= 0 ? '#34d399' : '#f87171'), formula: '本週至今 vs 上週同一段等長時間至今；上週那段時間剛好沒資料時，改比「目前配速 vs 個人平均配速」' },
    {
      label: '覆蓋率',
      value: coverageScore !== null ? `${coverageScore}%${activityBonusPoints > 0 ? `（含活動量 +${activityBonusPoints}%）` : ''}` : '—',
      formula: '本週肌群雷達圖多邊形面積 ÷ 每軸都達 100% 維持量時的面積，越高代表整體訓練量越飽滿；活動量（例如步數）另外加成，封頂 +10%，跟主站自己頁面同一套算法',
    },
    { label: '均衡度', value: balanceScore !== null ? `${balanceScore}%` : '—', formula: '最弱肌群複合分 ÷ 最強肌群複合分（複合分 = 組數 40% + 容量 60%），數字越低代表落差越大' },
  ]

  return (
    // FitnessForge 這張卡永遠是 wide（見 GlassPortalView 裡 wide={summary.subsystemId
    // === 'fitnessforge'}），獨佔一整列——原本雷達圖跟數字直式堆疊、雷達圖置中
    // 固定 230px 的排法是給正常 2 欄寬度卡片設計的，卡片變全寬之後兩側留白一大片、
    // 雷達圖相對顯得很小。改成左右並排（跟翰翰仔幸福指數卡片同一套 flex-wrap
    // 排法），雷達圖放大到 340px 把多出來的橫向空間用掉。
    <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: '2rem', alignItems: 'center' }}>
      <div style={{ flex: '1 1 320px', minWidth: 0 }}>
        <HeroIndex label="運動習慣指數" score={habitIndex} />
        <SupportStats items={items} />
        <FormulaToggle expanded={expanded} onToggle={onToggleExpand} />
        {expanded && (
          <FormulaPanel rows={[
            { label: '運動習慣指數', formula: '訓練量分／覆蓋分／均衡分／趨勢分，各自正規化到 0-100 後取平均（缺項就用剩下的取平均）；訓練量分等三項已依「本週已過幾分之幾」配速調整，不是單純比對整週終點' },
            ...items,
          ]} />
        )}
      </div>
      <LabeledRadarChart axes={radarAxes} maxValue={150} baselineFraction={100 / 150} size={340} color="#c084fc" />
    </div>
  )
}

// Field names match services/busyness-index's Postgres busyness_index_history
// row (see artifacts/api-server/src/lib/summarySources.ts's
// fetchVikunjaBusynessFromHistory) — four independently-computed 0-100
// sub-scores, any of which can be null when its own data is insufficient.
function VikunjaSummaryBody({ data, expanded, onToggleExpand }: { data: Record<string, unknown>; expanded: boolean; onToggleExpand: (e: React.MouseEvent) => void }) {
  const busyIndex = typeof data['busyIndex'] === 'number' ? data['busyIndex'] : null
  // 從容指數 = 100 - 忙碌指數，跟翰翰仔幸福指數卡片裡「生活從容」用的是同一個
  // calmScore 概念——顯示方向改成「越高越好」，跟另外兩張卡片（人生自由指數／
  // 運動習慣指數）視覺上一致，不用切換色階/文字方向的心智負擔。逾期壓力等四個
  // 子分數維持原本「數字越高代表這個問題越嚴重」的診斷語意不變，只有主指數翻轉。
  const calmIndex = busyIndex !== null ? Math.max(0, Math.min(100, 100 - busyIndex)) : null
  const overdueScore = typeof data['overdueScore'] === 'number' ? data['overdueScore'] : null
  const loadScore = typeof data['loadScore'] === 'number' ? data['loadScore'] : null
  const stagnationScore = typeof data['stagnationScore'] === 'number' ? data['stagnationScore'] : null
  const completionScore = typeof data['completionScore'] === 'number' ? data['completionScore'] : null

  // 這四個子分數都是「數字越高代表這個問題越嚴重」的診斷分數，用跟主指數同一套
  // heroTone 色階/字級（invert=true：0 分=輕鬆，100 分=緊繃），單看數字看不出
  // 是高是低的問題，級距標籤直接告訴你 100 分是「緊繃」還是「還好」。
  const diagItem = (label: string, score: number | null, formula: string) => {
    const tone = heroTone(score, true)
    return { label, value: score !== null ? String(score) : '—', formula, color: score !== null ? tone.color : undefined, tier: score !== null ? tone.label : undefined }
  }

  const items = [
    diagItem('逾期壓力', overdueScore, '目前逾期任務的嚴重程度（數量、逾期天數），對比近三個月基準'),
    diagItem('近期負荷', loadScore, '近期任務負荷 ÷ 長期平均負荷（ACWR 概念），比值越高代表最近突然變忙'),
    diagItem('停滯程度', stagnationScore, '任務長期沒有進展、卡住不動的程度'),
    diagItem('拖延程度', completionScore, '過去 90 天準時完成率的反向指標（指數衰減加權，越近期權重越高），數字越高代表越常拖延'),
  ]

  return (
    <div style={{ flex: 1 }}>
      <HeroIndex label="從容指數" score={calmIndex} />
      <SupportStats items={items} />
      <FormulaToggle expanded={expanded} onToggle={onToggleExpand} />
      {expanded && (
        <FormulaPanel rows={[
          { label: '從容指數', formula: '100 － 忙碌指數（忙碌指數 = 逾期壓力／近期負荷／停滯程度／拖延程度四項加權平均，每天由 Python 服務算一次）。數字越高代表越從容，跟其他卡片方向一致' },
          ...items,
        ]} />
      )}
    </div>
  )
}

// Field names match artifacts/api-server/src/lib/adventureLog.ts's
// fetchTravelIndex() return shape. travelScore null just means no completed
// visit exists yet (brand-new AdventureLog account, or every logged visit
// is still upcoming) — HeroIndex already renders that as "資料不足", same
// as every other card's missing-data state.
function AdventureLogSummaryBody({ data, expanded, onToggleExpand }: { data: Record<string, unknown>; expanded: boolean; onToggleExpand: (e: React.MouseEvent) => void }) {
  const travelScore = typeof data['travelScore'] === 'number' ? data['travelScore'] : null
  const daysSinceLastTrip = typeof data['daysSinceLastTrip'] === 'number' ? data['daysSinceLastTrip'] : null
  const lastTripEndDate = typeof data['lastTripEndDate'] === 'string' ? data['lastTripEndDate'] : null

  const items = [
    { label: '距上次旅行', value: daysSinceLastTrip !== null ? `${daysSinceLastTrip} 天` : '尚無紀錄', formula: '距離最近一次已結束行程的天數（還沒發生的計畫中行程不算）' },
    { label: '最近一次行程結束', value: lastTripEndDate ? new Date(lastTripEndDate).toLocaleDateString('zh-TW') : '—', formula: 'AdventureLog 裡最近一筆已結束行程的結束日期' },
  ]

  return (
    <div style={{ flex: 1 }}>
      <HeroIndex label="旅遊生活" score={travelScore} />
      <SupportStats items={items} />
      <FormulaToggle expanded={expanded} onToggle={onToggleExpand} />
      {expanded && (
        <FormulaPanel rows={[
          { label: '旅遊生活', formula: '3 天內剛玩回來 = 100 分，之後線性遞減，約 93 天沒出去玩 = 0 分；只看已結束的行程，反映「最近有沒有出去玩」，不是「有沒有計畫」' },
          ...items,
        ]} />
      )}
    </div>
  )
}

const SUMMARY_BODIES: Record<string, (props: { data: Record<string, unknown>; expanded: boolean; onToggleExpand: (e: React.MouseEvent) => void }) => React.ReactElement> = {
  'pf-cwh': PfCwhSummaryBody,
  'fitnessforge': FitnessForgeSummaryBody,
  'travel': AdventureLogSummaryBody,
  'vikunja': VikunjaSummaryBody,
}

// ─────────────────────────────────────────────
// 心智指標 — this card now shows TWO independently-sourced scores that used
// to be one:
//   1. dailyEngagementScore (hero number, 計入 HHI) — 純看當天日記篇數算出來
//      的基本分，2026-08-20 新增、2026-08-20 拿掉完成任務數（跟從容指數算的
//      東西重複了），由 HERMES 的 daily-life-score.py 算好一起 push 過來。
//      這才是翰翰仔幸福指數實際在用的「心智」維度。
//   2. score (知識庫健康度，不計入 HHI) — 原本唯一的心智指標，是 HERMES 自己
//      知識庫的健康度而不是翰翰仔本人的心智狀態，所以移出 HHI 計算，但數字
//      本身還有參考價值，保留顯示在卡片下半部，明確標註不計入幸福指數。
// 兩者都存在同一個 mind_index_history row，同一次 push，所以共用同一個
// stale/computedAt。No portal_sites row / external URL to link to (same
// situation as HHI), so it's a standalone card rendered directly into the
// bento grid rather than going through GlassSummaryCard + SUMMARY_BODIES.
// ─────────────────────────────────────────────
type Band = [threshold: number, color: string, label: string]

function bandTone(score: number | null, bands: Band[]): { color: string; label: string } {
  if (score === null) return { color: 'rgba(255,255,255,0.4)', label: '資料不足' }
  for (const [threshold, color, label] of bands) {
    if (score >= threshold) return { color, label }
  }
  return { color: 'rgba(255,255,255,0.4)', label: '資料不足' }
}

const MIND_SCORE_BANDS: Band[] = [[80, '#34d399', '優良'], [60, '#fbbf24', '普通'], [40, '#fb923c', '偏弱'], [0, '#f87171', '停滯']]
const CONVERSION_BANDS: Band[] = [[90, '#34d399', '順暢'], [70, '#fbbf24', '普通'], [0, '#f87171', '淤積']]
const LINK_HEALTH_BANDS: Band[] = [[90, '#34d399', '緊密'], [75, '#fbbf24', '普通'], [0, '#f87171', '孤立']]
const VITALITY_BANDS: Band[] = [[80, '#34d399', '活躍'], [40, '#fbbf24', '普通'], [0, '#f87171', '停滯']]
const RHYTHM_BANDS: Band[] = [[80, '#34d399', '穩定'], [40, '#fbbf24', '普通'], [0, '#f87171', '低迷']]

function MindIndexCard({
  summary,
  unlocked,
  unlockedPassword,
  onRequestUnlock,
}: {
  summary: DashboardSummary | undefined
  unlocked: boolean
  unlockedPassword: string | null
  onRequestUnlock: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [history, setHistory] = useState<MindIndexHistoryPoint[] | null>(null)
  const [historyError, setHistoryError] = useState(false)
  const tilt = useTilt3D()
  const isLocked = !unlocked

  // Lazy-loaded on first expand, same reasoning as HappinessHeroCard's own
  // history fetch: most page views never open this panel.
  useEffect(() => {
    if (!expanded || !unlockedPassword || history !== null) return
    let cancelled = false
    apiFetchMindIndexHistory(unlockedPassword)
      .then(rows => { if (!cancelled) setHistory(rows) })
      .catch(() => { if (!cancelled) setHistoryError(true) })
    return () => { cancelled = true }
  }, [expanded, unlockedPassword, history])

  const data = summary?.data
  const dailyEngagementScore = typeof data?.['dailyEngagementScore'] === 'number' ? data['dailyEngagementScore'] as number : null
  const diaryEntryCount = typeof data?.['diaryEntryCount'] === 'number' ? data['diaryEntryCount'] as number : null
  const score = typeof data?.['score'] === 'number' ? data['score'] as number : null
  const conversion = typeof data?.['conversion'] === 'number' ? data['conversion'] as number : null
  const linkHealth = typeof data?.['linkHealth'] === 'number' ? data['linkHealth'] as number : null
  const vitality = typeof data?.['vitality'] === 'number' ? data['vitality'] as number : null
  const rhythm = typeof data?.['rhythm'] === 'number' ? data['rhythm'] as number : null
  const stale = data?.['stale'] === true
  const partial = data?.['partial'] === true

  const cardStyle: React.CSSProperties = {
    position: 'relative',
    background: 'rgba(255,255,255,0.055)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid rgba(192,132,252,0.22)',
    borderRadius: '18px',
    padding: '1.5rem 1.6rem 1.2rem',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)',
    // 資料過期（HERMES 的計分腳本超過 36 小時沒跑）不當成錯誤或缺席，還是
    // 顯示最後已知分數，但整張卡降低飽和度/透明度，一眼就能看出「這是舊的」。
    opacity: stale ? 0.55 : 1,
    filter: stale ? 'saturate(0.5)' : undefined,
    ...hueVar(CARD_HUE.purple),
  }

  if (isLocked) {
    return (
      <div ref={tilt.ref} className="glass-shell" style={{ ...cardStyle, cursor: 'pointer' }} onClick={onRequestUnlock} onMouseMove={tilt.onMouseMove} onMouseLeave={tilt.onMouseLeave}>
        <div className="silk"><i className="w1" /><i className="w2" /></div>
        <div className="beam" />
        <div style={{ position: 'absolute', top: 0, left: '18%', right: '18%', height: '1px', background: 'linear-gradient(90deg, transparent, rgba(192,132,252,0.6), transparent)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.1rem' }}>
          <span style={{ fontSize: '26px', filter: 'drop-shadow(0 0 8px rgba(192,132,252,0.55))' }}>🔒</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: '#c084fc', fontSize: '16px', fontWeight: '600' }}>心智指標</div>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11.5px' }}>HERMES Knowledge Base</div>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '8px', padding: '1.2rem 0' }}>
          <div style={{ fontSize: '18px', letterSpacing: '0.3em', color: 'rgba(255,255,255,0.2)' }}>••••••</div>
          <div style={{ fontSize: '11.5px', color: '#fbbf24', letterSpacing: '0.05em' }}>🔒 解鎖後顯示</div>
        </div>
      </div>
    )
  }

  const tone = bandTone(dailyEngagementScore, MIND_SCORE_BANDS)
  const oldTone = bandTone(score, MIND_SCORE_BANDS)
  const conversionTone = bandTone(conversion, CONVERSION_BANDS)
  const linkHealthTone = bandTone(linkHealth, LINK_HEALTH_BANDS)
  const vitalityTone = bandTone(vitality, VITALITY_BANDS)
  const rhythmTone = bandTone(rhythm, RHYTHM_BANDS)
  const engagementItems = [
    { label: '日記篇數', value: diaryEntryCount !== null ? String(diaryEntryCount) : '—', formula: '100 × 篇數 ÷ (篇數 + 3)——前幾篇效用最大，篇數越多邊際效果越平緩，沒有硬性封頂' },
  ]
  const knowledgeItems = [
    { label: '轉化率', value: conversion !== null ? String(conversion) : '—', color: conversionTone.color, tier: conversion !== null ? conversionTone.label : undefined, formula: 'CREATE 層：100 × 近30天編譯進 wiki 的條目數 ÷ (近30天編譯數 + inbox 超過7天未編譯的積壓數)' },
    { label: '連結健康度', value: linkHealth !== null ? String(linkHealth) : '—', color: linkHealthTone.color, tier: linkHealth !== null ? linkHealthTone.label : undefined, formula: 'ENRICH 層：100 × (1 − 孤兒條目數 ÷ 總條目數)，孤兒 = wiki 連結出入度皆為 0（不含模板/索引）' },
    { label: '活化度', value: vitality !== null ? String(vitality) : '—', color: vitalityTone.color, tier: vitality !== null ? vitalityTone.label : undefined, formula: 'SYNTHESIZE 層：min(100, 近30天被修改條目比例 × 400)；近14天無 L3 綜整產出則 × 0.8' },
    { label: '本週節奏', value: rhythm !== null ? String(rhythm) : '—', color: rhythmTone.color, tier: rhythm !== null ? rhythmTone.label : undefined, formula: '近7天加權積分（豐化2分/新條目1分/新連結0.5分/L3綜整5分，每日上限20分）÷ 30 × 100' },
  ]

  return (
    <div ref={tilt.ref} className="glass-shell" style={cardStyle} onMouseMove={tilt.onMouseMove} onMouseLeave={tilt.onMouseLeave}>
      <div className="silk"><i className="w1" /><i className="w2" /></div>
      <div className="beam" />
      <div style={{ position: 'absolute', top: 0, left: '18%', right: '18%', height: '1px', background: `linear-gradient(90deg, transparent, ${tone.color}99, transparent)` }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.1rem' }}>
        <span style={{ fontSize: '26px', filter: `drop-shadow(0 0 8px ${tone.color}88)` }}>🧠</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: '#c084fc', fontSize: '16px', fontWeight: '600' }}>心智指標</div>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11.5px' }}>日記書寫</div>
        </div>
      </div>

      {dailyEngagementScore === null && score === null ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12.5px', color: 'rgba(255,255,255,0.3)', padding: '1.2rem 0' }}>
          {summary?.status === 'error' ? '暫時無法取得資料' : '資料準備中…'}
        </div>
      ) : (
        <div style={{ flex: 1 }}>
          {/* HHI 實際計入的分數——純看當天日記篇數，不看任務完成（任務完成度
              已經是從容指數在算的東西，兩個指標算同一件事就重複了）。
              dailyEngagementScore 還沒實作前這裡會是「資料準備中」，但下面的
              知識庫健康度區塊獨立運作，不受影響（兩個分數來源完全分開，不是
              同一件事）。 */}
          <div style={{ marginBottom: '1rem' }}>
            {dailyEngagementScore === null ? (
              <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.35)' }}>心智基本分：資料準備中…</div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ fontSize: 'clamp(2.4rem, 4vw, 3.2rem)', fontWeight: '700', lineHeight: 1, color: tone.color, textShadow: `0 0 26px ${tone.color}66` }}>{dailyEngagementScore}</div>
                <div style={{ fontSize: '15px', fontWeight: '600', color: tone.color }}>{tone.label}</div>
                <span style={{ fontSize: '10px', color: 'rgba(52,211,153,0.85)', border: '1px solid rgba(52,211,153,0.35)', borderRadius: '999px', padding: '2px 8px', letterSpacing: '0.03em' }}>計入幸福指數</span>
              </div>
            )}
            {stale && (
              <div style={{ fontSize: '11px', color: '#fbbf24', marginTop: '4px' }}>資料已超過 36 小時未更新</div>
            )}
          </div>
          <SupportStats items={engagementItems} />
          <FormulaToggle expanded={expanded} onToggle={() => setExpanded(x => !x)} />
          {expanded && (
            <FormulaPanel rows={[
              { label: '心智指標（計入幸福指數）', formula: 'dailyEngagementScore = round(100 × 日記篇數 ÷ (日記篇數 + 3))，前幾篇日記效用最大，篇數越多邊際效果越平緩（沒有完成任務數了——任務完成度已經是從容指數在算，不重複計）' },
              ...engagementItems,
            ]} />
          )}

          {/* 知識庫健康度——原本唯一的「心智指標」，2026-08-20 起移出 HHI，只
              保留顯示。獨立區塊、獨立虛線分隔，避免使用者誤以為這個數字也
              算進幸福指數。 */}
          <div style={{ marginTop: '1rem', paddingTop: '0.9rem', borderTop: '1px dashed rgba(255,255,255,0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11.5px', color: 'rgba(255,255,255,0.5)', fontWeight: '600' }}>知識庫健康度</span>
              <span style={{ fontSize: '9.5px', color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '999px', padding: '1px 7px' }}>不計入幸福指數</span>
            </div>
            {score === null ? (
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)' }}>資料準備中…</div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '0.8rem' }}>
                  <div style={{ fontSize: '1.6rem', fontWeight: '700', lineHeight: 1, color: oldTone.color }}>{score}</div>
                  <div style={{ fontSize: '12.5px', fontWeight: '600', color: oldTone.color }}>{oldTone.label}</div>
                  {partial && <span style={{ fontSize: '10.5px', color: '#fbbf24' }}>部分子分數缺項</span>}
                </div>
                <SupportStats items={knowledgeItems} />
                {expanded && (
                  <FormulaPanel rows={[
                    { label: '知識庫健康度', formula: 'score = round((轉化率 × 連結健康度 × 活化度 × 本週節奏) ^ 0.25)，幾何平均，任一維度崩壞會拖累總分；缺項用可用的算並標記 partial' },
                    ...knowledgeItems,
                  ]} />
                )}
              </>
            )}
          </div>

          {expanded && (
            <div style={{ marginTop: '0.6rem', paddingTop: '0.7rem', borderTop: '1px dashed rgba(255,255,255,0.1)' }}>
              <div style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.4)', marginBottom: '0.4rem' }}>知識庫健康度歷史趨勢</div>
              {historyError ? (
                <div style={{ fontSize: '11.5px', color: 'rgba(255,255,255,0.35)' }}>趨勢資料讀取失敗</div>
              ) : history === null ? (
                <div style={{ fontSize: '11.5px', color: 'rgba(255,255,255,0.35)' }}>載入中…</div>
              ) : (
                <TrendLineChart points={history.map(h => ({ date: h.date, value: h.score }))} color={oldTone.color} height={70} />
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.7rem', marginTop: '1rem', borderTop: '1px solid rgba(192,132,252,0.13)' }}>
        <span style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.04em' }}>{formatMinutesAgo(summary?.fetchedAt ?? null)}</span>
        <span style={{ fontSize: '10.5px', color: 'rgba(192,132,252,0.8)', letterSpacing: '0.05em', fontWeight: '500' }}>PRIVATE</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// 翰翰仔幸福指數 (Hanhan Happiness Index) — full-width hero card, top of the
// private zone. Not tied to any portal_sites row (there's no external
// system to link to), so it's rendered separately from the site-mapped
// bento grid rather than going through GlassSummaryCard. A reflective
// dashboard-navigation number, not a medical/psychological diagnosis.
// ─────────────────────────────────────────────
function hhiTone(score: number): { color: string; label: string } {
  if (score >= 80) return { color: '#00e5ff', label: '很幸福' }
  if (score >= 65) return { color: '#34d399', label: '穩定前進' }
  if (score >= 50) return { color: '#fbbf24', label: '尚可，需留意' }
  if (score >= 35) return { color: '#fb923c', label: '需調整' }
  return { color: '#f87171', label: '警報，先照顧自己' }
}

// Lightweight custom SVG line chart — no charting library, matching the
// muscle-radar chart elsewhere in this file. viewBox width is a fixed 100
// units with preserveAspectRatio="none" + CSS width:100%, so it stretches
// to whatever container width it's given without needing to measure the
// container in JS.
function TrendLineChart({ points, color = COLOR.purple, height = 90 }: { points: Array<{ date: string; value: number }>; color?: string; height?: number }) {
  if (points.length < 2) {
    return (
      <div style={{ fontSize: '11.5px', color: 'rgba(255,255,255,0.35)', padding: '0.6rem 0' }}>
        還沒有足夠的歷史資料可畫趨勢線（目前 {points.length} 天，至少需要 2 天）——每天會自動多記一筆，過幾天回來看就有線了
      </div>
    )
  }

  const width = 100
  const values = points.map(p => p.value)
  const minV = Math.min(...values)
  const maxV = Math.max(...values)
  const range = maxV - minV || 1
  const padY = 6
  const innerH = height - padY * 2
  const stepX = width / (points.length - 1)
  const coords = points.map((p, i) => {
    const x = i * stepX
    const y = padY + innerH - ((p.value - minV) / range) * innerH
    return [x, y] as const
  })
  const linePath = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const last = coords[coords.length - 1]!
  const areaPath = `${linePath} L${last[0].toFixed(2)},${height} L0,${height} Z`

  return (
    <div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <path d={areaPath} fill={`${color}22`} stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginTop: '4px' }}>
        <span>{points[0]!.date}</span>
        <span>最低 {minV} · 最高 {maxV}</span>
        <span>{points[points.length - 1]!.date}</span>
      </div>
    </div>
  )
}

function HappinessHeroCard({
  summary,
  unlocked,
  unlockedPassword,
  onRequestUnlock,
}: {
  summary: DashboardSummary | undefined
  unlocked: boolean
  unlockedPassword: string | null
  onRequestUnlock: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [history, setHistory] = useState<HappinessHistoryPoint[] | null>(null)
  const [historyError, setHistoryError] = useState(false)
  const tilt = useTilt3D()
  const isLocked = !unlocked // hhi is always isPrivate — see summarySources.ts

  // Lazy-load history only once the card is actually expanded — most page
  // views never open this panel, no reason to fetch 30 days of history on
  // every load just in case.
  useEffect(() => {
    if (!expanded || !unlockedPassword || history !== null) return
    let cancelled = false
    apiFetchHappinessHistory(unlockedPassword)
      .then(rows => { if (!cancelled) setHistory(rows) })
      .catch(() => { if (!cancelled) setHistoryError(true) })
    return () => { cancelled = true }
  }, [expanded, unlockedPassword, history])

  const data = summary?.data
  const displayedScore = typeof data?.['displayedScore'] === 'number' ? data['displayedScore'] as number : null
  const finalScore = typeof data?.['finalScore'] === 'number' ? data['finalScore'] as number : null
  const baseScore = typeof data?.['baseScore'] === 'number' ? data['baseScore'] as number : null
  const weakestScore = typeof data?.['weakestScore'] === 'number' ? data['weakestScore'] as number : null
  const weakestComponent = typeof data?.['weakestComponent'] === 'string' ? data['weakestComponent'] as string : null
  const lifeFreedomScore = typeof data?.['lifeFreedomScore'] === 'number' ? data['lifeFreedomScore'] as number : null
  const fitnessHabitScore = typeof data?.['fitnessHabitScore'] === 'number' ? data['fitnessHabitScore'] as number : null
  const calmScore = typeof data?.['calmScore'] === 'number' ? data['calmScore'] as number : null
  const mindScore = typeof data?.['mindScore'] === 'number' ? data['mindScore'] as number : null
  const travelScore = typeof data?.['travelScore'] === 'number' ? data['travelScore'] as number : null
  const usingStaleData = data?.['usingStaleData'] === true
  const weights = data?.['weights'] as { lifeFreedomWeight?: number; fitnessWeight?: number; calmWeight?: number; mindWeight?: number; travelWeight?: number } | undefined

  const cardStyle: React.CSSProperties = {
    position: 'relative',
    cursor: isLocked ? 'pointer' : (data ? 'pointer' : 'default'),
    background: 'rgba(255,255,255,0.055)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid rgba(192,132,252,0.28)',
    borderRadius: '20px',
    padding: '1.6rem 1.8rem',
    marginBottom: '1.2rem',
    boxShadow: '0 4px 28px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
    ...hueVar(CARD_HUE.purple),
  }

  if (isLocked) {
    return (
      <div ref={tilt.ref} className="glass-shell" style={cardStyle} onClick={onRequestUnlock} onMouseMove={tilt.onMouseMove} onMouseLeave={tilt.onMouseLeave}>
        <div className="silk"><i className="w1" /><i className="w2" /></div>
        <div className="beam" />
        <div style={{ position: 'absolute', top: 0, left: '18%', right: '18%', height: '1px', background: 'linear-gradient(90deg, transparent, rgba(192,132,252,0.6), transparent)' }} />
        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.6rem' }}>
          翰翰仔幸福指數 · Hanhan Happiness Index
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0.6rem 0' }}>
          <span style={{ fontSize: '20px', letterSpacing: '0.3em', color: 'rgba(255,255,255,0.2)' }}>••••••</span>
          <span style={{ fontSize: '12px', color: '#fbbf24', letterSpacing: '0.05em' }}>🔒 解鎖後顯示</span>
        </div>
      </div>
    )
  }

  if (!data || displayedScore === null) {
    return (
      <div ref={tilt.ref} className="glass-shell" style={cardStyle} onMouseMove={tilt.onMouseMove} onMouseLeave={tilt.onMouseLeave}>
        <div className="silk"><i className="w1" /><i className="w2" /></div>
        <div className="beam" />
        <div style={{ position: 'absolute', top: 0, left: '18%', right: '18%', height: '1px', background: 'linear-gradient(90deg, transparent, rgba(192,132,252,0.6), transparent)' }} />
        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.6rem' }}>
          翰翰仔幸福指數 · Hanhan Happiness Index
        </div>
        <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.35)' }}>資料準備中…</div>
      </div>
    )
  }

  const tone = hhiTone(displayedScore)
  const contributions: Array<{ label: string; value: number | null; weightPct: number }> = [
    { label: '人生自由', value: lifeFreedomScore, weightPct: Math.round((weights?.lifeFreedomWeight ?? 0.31) * 100) },
    { label: '健身習慣', value: fitnessHabitScore, weightPct: Math.round((weights?.fitnessWeight ?? 0.20) * 100) },
    { label: '生活從容', value: calmScore, weightPct: Math.round((weights?.calmWeight ?? 0.17) * 100) },
    { label: '心智指標', value: mindScore, weightPct: Math.round((weights?.mindWeight ?? 0.17) * 100) },
    { label: '旅遊生活', value: travelScore, weightPct: Math.round((weights?.travelWeight ?? 0.15) * 100) },
  ]

  const radarAxes = contributions.map(c => ({ label: c.label, value: c.value }))

  return (
    <div ref={tilt.ref} className="glass-shell" style={cardStyle} onClick={() => setExpanded(x => !x)} onMouseMove={tilt.onMouseMove} onMouseLeave={tilt.onMouseLeave}>
      <div className="silk"><i className="w1" /><i className="w2" /></div>
      <div className="beam" />
      <div style={{ position: 'absolute', top: 0, left: '18%', right: '18%', height: '1px', background: `linear-gradient(90deg, transparent, ${tone.color}99, transparent)` }} />

      <div className="hhi-top-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '2.4rem', alignItems: 'center', justifyContent: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: '0 1 260px' }}>
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
            翰翰仔幸福指數 · Hanhan Happiness Index
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 'clamp(2.8rem, 5vw, 4rem)', fontWeight: '700', lineHeight: 1, color: tone.color, textShadow: `0 0 28px ${tone.color}66` }}>
              {displayedScore}
            </div>
            <div style={{ fontSize: '16px', fontWeight: '600', color: tone.color }}>{tone.label}</div>
          </div>
          {weakestComponent && (
            <div style={{ fontSize: '12.5px', color: 'rgba(255,255,255,0.5)', marginTop: '0.5rem' }}>
              目前最需要照顧：<span style={{ color: '#fbbf24', fontWeight: '600' }}>{weakestComponent}</span>
            </div>
          )}
          <div className="hhi-contributions" style={{ display: 'flex', gap: '1.4rem', flexWrap: 'wrap', marginTop: '1.2rem' }}>
            {contributions.map(c => (
              <div key={c.label}>
                <div style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.04em', marginBottom: '3px' }}>
                  {c.label} · {c.weightPct}%
                </div>
                <div style={{ fontSize: '19px', fontWeight: '600', color: 'rgba(255,255,255,0.9)' }}>
                  {c.value !== null ? Math.round(c.value) : '—'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 四個維度標軸名稱＋分數，跟運動 APP 系統卡片同一套 LabeledRadarChart。
            固定 0-100 絕對刻度（不像肌群雷達圖那樣依本週最大值重新縮放）——
            同一個分數在不同天看起來大小要一致，才看得出真的有沒有變化。 */}
        <LabeledRadarChart axes={radarAxes} maxValue={100} size={260} color={tone.color} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.8rem', marginTop: '1.1rem', borderTop: '1px solid rgba(192,132,252,0.15)' }}>
        <span style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.3)' }}>
          {formatMinutesAgo(summary?.fetchedAt ?? null)}
          {usingStaleData ? <span style={{ color: '#fbbf24', marginLeft: '8px' }}>· 部分資料為最近可用值</span> : null}
        </span>
        <span style={{ fontSize: '10.5px', color: 'rgba(192,132,252,0.7)' }}>{expanded ? '收起 ▲' : '展開明細 ▼'}</span>
      </div>

      {expanded && (
        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px dashed rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {[
            ['基礎分（三項加權平均）', baseScore !== null ? baseScore.toFixed(2) : '—'],
            ['最弱項分數', weakestScore !== null ? weakestScore.toFixed(2) : '—'],
            ['短板修正後（平滑前）', finalScore !== null ? String(finalScore) : '—'],
            ['平滑後（目前顯示值）', String(displayedScore)],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px' }}>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</span>
              <span style={{ color: 'rgba(255,255,255,0.75)', fontWeight: '500' }}>{value}</span>
            </div>
          ))}

          <div style={{ marginTop: '0.6rem', paddingTop: '0.8rem', borderTop: '1px dashed rgba(255,255,255,0.1)' }}>
            <div style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.4)', marginBottom: '0.4rem' }}>近 30 天趨勢（每日顯示值）</div>
            {historyError ? (
              <div style={{ fontSize: '11.5px', color: 'rgba(255,255,255,0.35)' }}>趨勢資料讀取失敗</div>
            ) : history === null ? (
              <div style={{ fontSize: '11.5px', color: 'rgba(255,255,255,0.35)' }}>載入中…</div>
            ) : (
              <TrendLineChart points={history.map(h => ({ date: h.date, value: h.displayedScore }))} color={tone.color} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function GlassSummaryCard({
  site,
  summary,
  index,
  unlocked,
  onSelect,
  wide = false,
}: {
  site: SiteData
  summary: DashboardSummary
  index: number
  unlocked: boolean
  onSelect: (site: SiteData) => void
  wide?: boolean
}) {
  const isLocked = site.isPrivate && !unlocked
  const rgb = site.isPrivate ? '192,132,252' : '0,229,255'
  const accent = site.isPrivate ? '#c084fc' : '#00e5ff'
  const Body = SUMMARY_BODIES[summary.subsystemId]
  const [expanded, setExpanded] = useState(false)
  // The whole card navigates to the site on click — the formula toggle
  // needs stopPropagation so tapping it doesn't also trigger that navigation.
  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation()
    setExpanded(x => !x)
  }

  return (
    <motion.div
      className="glass-shell"
      initial={{ opacity: 0, y: 18, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.05, duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ scale: 1.03, y: -5, transition: { duration: 0.18 } }}
      onClick={() => onSelect(site)}
      onMouseMove={handleSpotlightMove}
      style={{
        position: 'relative',
        cursor: 'pointer',
        background: 'rgba(255,255,255,0.055)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: `1px solid rgba(${rgb},0.22)`,
        borderRadius: '18px',
        padding: '1.5rem 1.6rem 1.2rem',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)',
        ...(wide ? { gridColumn: '1 / -1' } : {}),
        ...hueVar(site.isPrivate ? CARD_HUE.purple : CARD_HUE.cyan),
      }}
    >
      <div className="silk"><i className="w1" /><i className="w2" /></div>
      <div className="beam" />
      <div style={{
        position: 'absolute', top: 0, left: '18%', right: '18%', height: '1px',
        background: `linear-gradient(90deg, transparent, rgba(${rgb},0.6), transparent)`,
      }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.1rem' }}>
        <span style={{ fontSize: '26px', filter: `drop-shadow(0 0 8px rgba(${rgb},0.55))` }}>
          {isLocked ? '🔒' : PORTAL_ICONS[index % PORTAL_ICONS.length]}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: accent, fontSize: '16px', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{site.name}</div>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{site.subtitle}</div>
        </div>
      </div>

      {isLocked ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '8px', padding: '1.2rem 0' }}>
          <div style={{ fontSize: '18px', letterSpacing: '0.3em', color: 'rgba(255,255,255,0.2)' }}>••••••</div>
          <div style={{ fontSize: '11.5px', color: '#fbbf24', letterSpacing: '0.05em' }}>🔒 解鎖後顯示</div>
        </div>
      ) : summary.status === 'pending' ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12.5px', color: 'rgba(255,255,255,0.3)', padding: '1.2rem 0' }}>資料準備中…</div>
      ) : summary.data && Body ? (
        <Body data={summary.data} expanded={expanded} onToggleExpand={handleToggleExpand} />
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12.5px', color: 'rgba(255,255,255,0.3)', padding: '1.2rem 0' }}>暫時無法取得資料</div>
      )}

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        paddingTop: '0.7rem', marginTop: '1rem',
        borderTop: `1px solid rgba(${rgb},0.13)`,
      }}>
        <span style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.04em' }}>
          {isLocked ? '——' : formatMinutesAgo(summary.fetchedAt)}
        </span>
        <span style={{ fontSize: '10.5px', color: isLocked ? '#fbbf24' : `rgba(${rgb},0.8)`, letterSpacing: '0.05em', fontWeight: '500' }}>
          {isLocked ? '🔐 LOCKED' : (site.isPrivate ? 'PRIVATE' : 'PUBLIC')}
        </span>
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────
// HERMES 戰情室 — operational monitoring (CPU/RAM/disk, container health,
// scheduled-task results, recent deploy/backup activity), collected by
// services/hermes-status/collect.ps1 on the deploy host and POSTed to
// /api/admin/hermes-status + /api/admin/hermes-activity. Not a
// SUMMARY_SOURCES entry / doesn't feed the HHI composite — this is
// infrastructure monitoring, not a happiness dimension, so it's a standalone
// section rendered directly into GlassPortalView rather than going through
// GlassSummaryCard.
// ─────────────────────────────────────────────
function formatGb(n: number): string {
  return `${n.toFixed(1)} GB`
}

function pctTone(pct: number | null): string {
  if (pct === null) return 'rgba(255,255,255,0.4)'
  if (pct >= 90) return COLOR.red
  if (pct >= 75) return COLOR.amber
  return COLOR.green
}

function HermesStatCard({ icon, label, value, sub, hue, valueColor }: { icon: string; label: string; value: string; sub?: string; hue: number; valueColor?: string }) {
  return (
    <div
      className="glass-shell"
      style={{
        position: 'relative',
        background: 'rgba(255,255,255,0.055)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: `1px solid hsla(${hue}, 70%, 65%, 0.25)`,
        borderRadius: '16px',
        padding: '1.1rem 1.2rem',
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)',
        ...hueVar(hue),
      }}
    >
      <div className="silk"><i className="w1" /><i className="w2" /></div>
      <div className="beam" />
      <div style={{
        width: '46px', height: '46px', borderRadius: '12px', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px',
        background: `hsla(${hue}, 80%, 60%, 0.15)`,
        boxShadow: `0 0 20px hsla(${hue}, 80%, 60%, 0.3)`,
      }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.05em', marginBottom: '2px' }}>{label}</div>
        <div style={{ fontSize: '20px', fontWeight: '700', color: valueColor ?? 'rgba(255,255,255,0.92)' }}>{value}</div>
        {sub && <div style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.35)', marginTop: '2px' }}>{sub}</div>}
      </div>
    </div>
  )
}

function HermesPanel({ title, sub, hue, children }: { title: string; sub: string; hue: number; children: React.ReactNode }) {
  return (
    <div
      className="glass-shell"
      style={{
        position: 'relative',
        background: 'rgba(255,255,255,0.055)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: `1px solid hsla(${hue}, 70%, 65%, 0.22)`,
        borderRadius: '18px',
        padding: '1.3rem 1.4rem',
        boxShadow: '0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)',
        ...hueVar(hue),
      }}
    >
      <div className="silk"><i className="w1" /><i className="w2" /></div>
      <div className="beam" />
      <div style={{ fontSize: '14px', fontWeight: '600', color: 'rgba(255,255,255,0.85)', marginBottom: '2px' }}>{title}</div>
      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginBottom: '0.9rem' }}>{sub}</div>
      {children}
    </div>
  )
}

// Windows Task Scheduler result codes that mean "not actually done yet",
// not a failure -- 0x41301 (still running) is the common one a poller can
// catch mid-execution; 0x41303 (task has not yet run) shows up right after
// registration, before its first trigger fires. Anything else non-zero is a
// genuine failure/exit code.
const TASK_RUNNING_RESULT = 267009 // 0x41301 SCHED_S_TASK_RUNNING
const TASK_NOT_YET_RUN_RESULT = 267011 // 0x41303 SCHED_S_TASK_HAS_NOT_RUN

function HermesTaskRow({ name, lastRunTime, lastTaskResult }: HermesScheduledTaskInfo) {
  const isRunning = lastTaskResult === TASK_RUNNING_RESULT
  const isPending = lastTaskResult === TASK_NOT_YET_RUN_RESULT
  const isFailed = lastTaskResult !== null && !isRunning && !isPending && lastTaskResult !== 0
  const dotClass = isRunning ? 'dot-run' : isFailed ? 'dot-warn' : 'dot-ok'
  const statusSuffix = isRunning ? ' · 執行中' : isPending ? ' · 尚未觸發過' : isFailed ? ` · 失敗 (${lastTaskResult})` : ''
  return (
    <div className="list-item" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0.55rem 0.2rem', fontSize: '12.5px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <span className={`dot ${dotClass}`} />
      <span style={{ color: 'rgba(255,255,255,0.8)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', flexShrink: 0 }}>
        {lastRunTime ? formatMinutesAgo(lastRunTime) : '尚未執行'}
        {statusSuffix}
      </span>
    </div>
  )
}

function HermesActivityRow({ occurredAt, source, message }: HermesActivityEntry) {
  return (
    <div className="list-item" style={{ display: 'flex', alignItems: 'baseline', gap: '10px', padding: '0.55rem 0.2rem', fontSize: '12.5px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <span style={{ color: 'rgba(255,255,255,0.8)', flex: 1, minWidth: 0 }}>
        <span style={{ color: COLOR.cyan, fontWeight: 600 }}>{source}</span> {message}
      </span>
      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', flexShrink: 0 }}>{formatMinutesAgo(occurredAt)}</span>
    </div>
  )
}

function HermesContainerRow({ name, status, health }: HermesContainerInfo) {
  const isFailed = !/up/i.test(status)
  const isUnhealthy = health === 'unhealthy'
  const dotClass = isFailed || isUnhealthy ? 'dot-warn' : 'dot-ok'
  return (
    <div className="list-item" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0.55rem 0.2rem', fontSize: '12.5px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <span className={`dot ${dotClass}`} />
      <span style={{ color: 'rgba(255,255,255,0.8)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', flexShrink: 0 }}>
        {status}{health ? ` · ${health}` : ''}
      </span>
    </div>
  )
}

function HermesWarRoomSection({
  unlocked,
  unlockedPassword,
  onRequestUnlock,
}: {
  unlocked: boolean
  unlockedPassword: string | null
  onRequestUnlock: () => void
}) {
  const [status, setStatus] = useState<HermesStatusData | null>(null)
  const [statusError, setStatusError] = useState(false)
  const [activity, setActivity] = useState<HermesActivityEntry[] | null>(null)
  const [activityError, setActivityError] = useState(false)

  useEffect(() => {
    if (!unlocked || !unlockedPassword) return
    let cancelled = false
    apiFetchHermesStatus(unlockedPassword)
      .then(d => { if (!cancelled) setStatus(d) })
      .catch(() => { if (!cancelled) setStatusError(true) })
    apiFetchHermesActivity(unlockedPassword)
      .then(d => { if (!cancelled) setActivity(d) })
      .catch(() => { if (!cancelled) setActivityError(true) })
    return () => { cancelled = true }
  }, [unlocked, unlockedPassword])

  if (!unlocked) {
    return (
      <div
        className="glass-shell"
        style={{
          position: 'relative', cursor: 'pointer',
          background: 'rgba(255,255,255,0.055)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(192,132,252,0.28)',
          borderRadius: '20px',
          padding: '1.6rem 1.8rem',
          boxShadow: '0 4px 28px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
          ...hueVar(CARD_HUE.purple),
        }}
        onClick={onRequestUnlock}
      >
        <div className="silk"><i className="w1" /><i className="w2" /></div>
        <div className="beam" />
        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.6rem' }}>
          HERMES 戰情室
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0.6rem 0' }}>
          <span style={{ fontSize: '20px', letterSpacing: '0.3em', color: 'rgba(255,255,255,0.2)' }}>••••••</span>
          <span style={{ fontSize: '12px', color: '#fbbf24', letterSpacing: '0.05em' }}>🔒 解鎖後顯示</span>
        </div>
      </div>
    )
  }

  if (statusError || !status || !status.available) {
    return (
      <div style={{ fontSize: '12.5px', color: 'rgba(255,255,255,0.3)', padding: '1rem 0.2rem' }}>
        {statusError ? 'HERMES 戰情室：暫時無法取得資料' : 'HERMES 戰情室：尚無資料，collect.ps1 還沒在主機上跑過'}
      </div>
    )
  }

  const worstDisk = status.disks.reduce<HermesDiskInfo | null>(
    (worst, d) => (!worst || d.percentUsed > worst.percentUsed ? d : worst),
    null,
  )
  const containersOk = status.containers.filter(c => /up/i.test(c.status) && c.health !== 'unhealthy').length
  const opacity = status.stale ? 0.55 : 1
  const filter = status.stale ? 'saturate(0.5)' : undefined

  return (
    <div style={{ opacity, filter }}>
      <div className="hermes-stats-grid" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '0.9rem',
        marginBottom: '0.9rem',
      }}>
        <HermesStatCard icon="🖥️" label="CPU 負載" value={status.cpuPercent !== null ? `${Math.round(status.cpuPercent)}%` : '—'} valueColor={pctTone(status.cpuPercent)} hue={CARD_HUE.cyan} />
        <HermesStatCard icon="🧠" label="記憶體" value={status.memPercent !== null ? `${Math.round(status.memPercent)}%` : '—'} valueColor={pctTone(status.memPercent)} hue={210} />
        <HermesStatCard
          icon="💾"
          label={worstDisk ? `磁碟 ${worstDisk.drive}` : '磁碟'}
          value={worstDisk ? `${Math.round(worstDisk.percentUsed)}%` : '—'}
          sub={worstDisk ? `剩餘 ${formatGb(worstDisk.freeGb)}` : undefined}
          valueColor={worstDisk ? pctTone(worstDisk.percentUsed) : undefined}
          hue={255}
        />
        <HermesStatCard
          icon="📦"
          label="容器健康"
          value={`${containersOk} / ${status.containers.length}`}
          sub={status.containers.length > 0 && containersOk < status.containers.length ? '有容器異常' : undefined}
          hue={CARD_HUE.purple}
        />
      </div>

      <div className="hermes-panels-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.9rem' }}>
        <HermesPanel title="排程任務狀態" sub="Windows Task Scheduler · 最近執行" hue={CARD_HUE.cyan}>
          {status.scheduledTasks.length === 0
            ? <div style={{ fontSize: '11.5px', color: 'rgba(255,255,255,0.3)', padding: '0.6rem 0' }}>尚無排程任務資料</div>
            : status.scheduledTasks.map(t => <HermesTaskRow key={t.name} {...t} />)}
        </HermesPanel>
        <HermesPanel title="近期活動" sub="部署 / 備份紀錄" hue={CARD_HUE.purple}>
          {activityError
            ? <div style={{ fontSize: '11.5px', color: 'rgba(255,255,255,0.3)', padding: '0.6rem 0' }}>活動紀錄讀取失敗</div>
            : activity === null
              ? <div style={{ fontSize: '11.5px', color: 'rgba(255,255,255,0.3)', padding: '0.6rem 0' }}>載入中…</div>
              : activity.length === 0
                ? <div style={{ fontSize: '11.5px', color: 'rgba(255,255,255,0.3)', padding: '0.6rem 0' }}>尚無活動紀錄</div>
                : activity.map(a => <HermesActivityRow key={a.id} {...a} />)}
        </HermesPanel>
      </div>

      {/* 容器清單獨立一個全寬面板——原本只在 stat 卡顯示 9/9 這種計數，看不出
          是「哪些」容器，跟排程任務/近期活動一樣改成列表顯示名稱＋狀態。 */}
      <div style={{ marginTop: '0.9rem' }}>
        <HermesPanel title="容器清單" sub="Docker · 目前執行狀態" hue={CARD_HUE.purple}>
          {status.containers.length === 0
            ? <div style={{ fontSize: '11.5px', color: 'rgba(255,255,255,0.3)', padding: '0.6rem 0' }}>尚無容器資料</div>
            : status.containers.map(c => <HermesContainerRow key={c.name} {...c} />)}
        </HermesPanel>
      </div>

      <div style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.3)', marginTop: '0.7rem', textAlign: 'right' }}>
        {status.computedAt ? formatMinutesAgo(status.computedAt) : ''}
        {status.stale ? <span style={{ color: '#fbbf24', marginLeft: '8px' }}>· 資料已超過 30 分鐘未更新</span> : null}
      </div>
    </div>
  )
}

function GlassPortalView({
  sites,
  dashboard,
  unlocked,
  unlockedPassword,
  onSiteSelect,
  onRequestUnlock,
}: {
  sites: SiteData[]
  dashboard: DashboardSummary[]
  unlocked: boolean
  unlockedPassword: string | null
  onSiteSelect: (site: SiteData) => void
  onRequestUnlock: () => void
}) {
  const publicSites = sites.filter(s => !s.isPrivate)
  const privateSites = sites.filter(s => s.isPrivate)

  // Comet-border beam animation needs `--angle` registered as a proper
  // <angle> custom property (so the browser can smoothly interpolate it in
  // the conic-gradient) — unsupported browsers just keep `.beam` at
  // opacity:0 (no `beam-on` class added), a silent no-op degrade rather
  // than a broken/frozen gradient.
  const [beamSupported, setBeamSupported] = useState(false)
  useEffect(() => {
    try {
      CSS.registerProperty({ name: '--angle', syntax: '<angle>', initialValue: '0deg', inherits: false })
      setBeamSupported(true)
    } catch {
      // older browsers: comet border stays hidden, silk sweep + spotlight still work
    }
  }, [])

  const ZoneLabel = ({ label, color, rgb }: { label: string; color: string; rgb: string }) => (
    <div style={{
      color, letterSpacing: '0.32em',
      fontSize: 'clamp(0.58rem, 0.9vw, 0.72rem)',
      fontWeight: '300',
      fontFamily: FONT_STACK,
      textTransform: 'uppercase',
      textAlign: 'center',
      paddingBottom: '0.5rem',
      marginBottom: '0.7rem',
      flexShrink: 0,
      borderBottom: `1px solid rgba(${rgb},0.18)`,
      textShadow: `0 0 14px rgba(${rgb},0.55)`,
    }}>{label}</div>
  )

  return (
    <div className={beamSupported ? 'beam-on' : undefined} style={{
      width: '100%', height: '100%',
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      background: COLOR.bg,
    }}>
      {/* 深色漸層 + 兩顆模糊光暈球，取代原本的 pixel grid 疊層——跟新的絲綢玻璃
          卡片殼是同一套柔和光暈語彙，8-bit 網格線的復古電玩感留在舊版就好。 */}
      <div className="bg-gradient" />
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <ParticleCanvas />

      {/* Header */}
      <div style={{
        position: 'relative', zIndex: 3, flexShrink: 0,
        padding: '1rem 2rem 0.85rem',
        textAlign: 'center',
        background: 'rgba(5,8,20,0.55)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderBottom: '1px solid rgba(255,255,255,0.055)',
      }}>
        <h1 style={{
          color: '#00e5ff', margin: 0,
          fontSize: 'clamp(1rem, 2.2vw, 1.4rem)',
          fontWeight: '200',
          fontFamily: FONT_STACK,
          letterSpacing: '0.38em',
          textTransform: 'uppercase',
          textShadow: '0 0 28px rgba(0,229,255,0.7), 0 0 56px rgba(0,229,255,0.3)',
          animation: 'header-flicker 10s infinite',
        }}>AI 工具入口網</h1>
        <p style={{
          margin: '0.3rem 0 0',
          color: 'rgba(255,255,255,0.26)',
          fontSize: 'clamp(0.48rem, 0.85vw, 0.6rem)',
          fontFamily: FONT_STACK,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
        }}>
          {sites.length > 0 ? `${sites.length} portals available` : 'connecting...'}
        </p>
      </div>

      {/* Vertical layout: private dashboard cards get the full width up top,
          plain public links sit in a smaller row below — matches the
          reference concept (dashboard.html), not a half-width split. */}
      <div className="glass-portal-zones" style={{
        flex: 1, zIndex: 3,
        display: 'flex', flexDirection: 'column', gap: '1.6rem',
        padding: '1.2rem 1.4rem 4.5rem',
        overflowY: 'auto', overflowX: 'hidden',
      }}>
        {/* Private zone / system-overview dashboard */}
        <div className="glass-portal-zone">
          <ZoneLabel label="▶  私  領  域" color="#c084fc" rgb="192,132,252" />
          <HappinessHeroCard
            summary={dashboard.find(d => d.subsystemId === 'hhi')}
            unlocked={unlocked}
            unlockedPassword={unlockedPassword}
            onRequestUnlock={onRequestUnlock}
          />
          {(() => {
            // 分成兩群，不是把所有私領域項目塞進同一個 2 欄 grid——有雷達圖的
            // 卡片（目前只有運動 APP 系統）內容天生就比其他卡片高很多，跟旁邊
            // 矮卡片同一列會空出一大片沒對齊的空白；純連結卡（沒有 summary
            // body，例如 Duplicati 狀態）內容天生就短很多，跟中等高度的摘要卡
            // 放一起也不對齊。改成：有雷達圖的卡片自己獨佔一整列；其餘摘要卡
            // （HeroIndex + 4 個支援數字，高度天生就接近）留在 2 欄 grid 裡；
            // 純連結卡另外用跟公領域一樣的緊湊 2 欄格線，彼此高度也接近。
            const richSites: SiteData[] = []
            const plainSites: SiteData[] = []
            privateSites.forEach(s => {
              const summary = s.subsystemId ? dashboard.find(d => d.subsystemId === s.subsystemId) : undefined
              if (summary && SUMMARY_BODIES[summary.subsystemId]) richSites.push(s)
              else plainSites.push(s)
            })
            // 排序照翰翰仔幸福指數的維度順序（人生自由／健身習慣／生活從容／
            // 旅遊生活——心智指標是 MindIndexCard，固定排在 richSites 後面，不
            // 用排進這個清單），不依賴資料庫的插入順序，確保「有計入 HHI 的
            // 系統」永遠照同一個順序排最前面。
            const HHI_SITE_PRIORITY: Record<string, number> = { 'pf-cwh': 0, fitnessforge: 1, vikunja: 2, travel: 3 }
            richSites.sort((a, b) => (HHI_SITE_PRIORITY[a.subsystemId ?? ''] ?? 99) - (HHI_SITE_PRIORITY[b.subsystemId ?? ''] ?? 99))
            return (
              <>
                {/* alignItems: 'start' — 沒有這行，同一列的卡片預設會被拉伸成一樣高
                    （grid 預設 align-items: stretch）。改成 start 後每張卡各自長到
                    自己內容需要的高度就好。 */}
                <div className="glass-portal-bento" style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gridAutoRows: 'auto',
                  gap: '0.9rem',
                  alignItems: 'start',
                  // dense：沒有這個，全寬卡片（運動 APP 系統）夾在兩張一般卡片
                  // 中間時，瀏覽器會直接把它後面那張卡片推到下一列，前面那張卡
                  // 旁邊留一整格空白（例如人生自由指數卡片旁邊空出一大塊）——
                  // grid 預設不會「回頭」把後面的卡片填進這個空格。dense 讓瀏覽
                  // 器優先填滿前面留下的空格，全寬卡片改成自己找下一個空列插入。
                  gridAutoFlow: 'dense',
                }}>
                  {richSites.map((s, i) => {
                    const summary = dashboard.find(d => d.subsystemId === s.subsystemId)!
                    return (
                      <GlassSummaryCard
                        key={s.id}
                        site={s}
                        summary={summary}
                        index={i + publicSites.length}
                        unlocked={unlocked}
                        onSelect={onSiteSelect}
                        wide={summary.subsystemId === 'fitnessforge'}
                      />
                    )
                  })}
                  {/* 心智指標沒有 portal_sites 對應列（沒有外部網址可連），所以不
                      透過上面 richSites 那條路徑，直接掛進同一個 bento grid 當
                      額外一格——跟其他摘要卡同樣是 HeroIndex + 支援數字的形狀，
                      高度天生接近，放在一起不會不對齊。 */}
                  <MindIndexCard
                    summary={dashboard.find(d => d.subsystemId === 'mind-index')}
                    unlocked={unlocked}
                    unlockedPassword={unlockedPassword}
                    onRequestUnlock={onRequestUnlock}
                  />
                </div>
                {plainSites.length > 0 && (
                  <div className="glass-portal-cards" style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gridAutoRows: 'auto',
                    gap: '0.7rem',
                    marginTop: '0.9rem',
                  }}>
                    {plainSites.map((s, i) => (
                      <GlassCard key={s.id} site={s} index={i + publicSites.length} unlocked={unlocked} onSelect={onSiteSelect} />
                    ))}
                  </div>
                )}
              </>
            )
          })()}
        </div>

        {/* Horizontal divider */}
        <div className="glass-portal-hr" style={{
          height: '1px', flexShrink: 0,
          background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.08), rgba(0,229,255,0.16), rgba(255,255,255,0.08), transparent)',
        }} />

        {/* HERMES 戰情室 — operational monitoring, not a happiness dimension,
            so it's its own zone rather than folded into 私領域's bento grid. */}
        <div className="glass-portal-zone">
          <ZoneLabel label="⬡  H E R M E S  戰  情  室" color="#c084fc" rgb="192,132,252" />
          <HermesWarRoomSection unlocked={unlocked} unlockedPassword={unlockedPassword} onRequestUnlock={onRequestUnlock} />
        </div>

        <div className="glass-portal-hr" style={{
          height: '1px', flexShrink: 0,
          background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.08), rgba(0,229,255,0.16), rgba(255,255,255,0.08), transparent)',
        }} />

        {/* Public zone */}
        <div className="glass-portal-zone">
          <ZoneLabel label="◆  公  領  域" color="#00e5ff" rgb="0,229,255" />
          <div className="glass-portal-cards" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gridAutoRows: 'auto',
            gap: '0.7rem',
          }}>
            {publicSites.length > 0
              ? publicSites.map((s, i) => (
                  <GlassCard key={s.id} site={s} index={i} unlocked={unlocked} onSelect={onSiteSelect} />
                ))
              : <div style={{ color: 'rgba(255,255,255,0.13)', fontSize: '0.72rem', fontFamily: FONT_STACK, letterSpacing: '0.18em', display: 'flex', alignItems: 'center', justifyContent: 'center', textTransform: 'uppercase', padding: '2rem 0' }}>No Data</div>
            }
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        position: 'absolute', bottom: '4.8rem', left: 0, right: 0,
        textAlign: 'center', pointerEvents: 'none', zIndex: 3,
      }}>
        <div style={{
          color: 'rgba(255,255,255,0.11)',
          fontSize: '0.58rem',
          fontFamily: FONT_STACK,
          letterSpacing: '0.18em', textTransform: 'uppercase',
        }}>
          Click to enter  ·  🔐 Private requires password
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// App
// ─────────────────────────────────────────────
export default function App() {
  const [sites, setSites] = useState<SiteData[]>([])
  const [dashboard, setDashboard] = useState<DashboardSummary[]>([])
  const [unlockedPassword, setUnlockedPassword] = useState<string | null>(() => localStorage.getItem(UNLOCK_KEY))
  const unlocked = !!unlockedPassword
  const [modal, setModal] = useState<{ visible: boolean; pendingUrl: string }>({ visible: false, pendingUrl: '' })
  const [adminAuth, setAdminAuth] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [adminPassword, setAdminPassword] = useState('')
  const [viewMode, setViewMode] = useState<'3d' | 'arcade'>('arcade')
  const [modeFlash, setModeFlash] = useState<string | null>(null)

  const refreshSites = useCallback(async () => {
    try {
      const data = await apiFetchSites()
      setSites(data)
    } catch {
      // silently keep whatever we have
    }
  }, [])

  useEffect(() => {
    apiFetchSites()
      .then(data => { setSites(data) })
      .catch(() => { /* keep empty sites on error */ })
  }, [])

  useEffect(() => {
    apiFetchDashboard(unlockedPassword)
      .then(({ summaries, unlocked }) => {
        setDashboard(summaries)
        // Trust the server's explicit `unlocked` flag, not "did some private
        // summary come back with data: null" — that used to be the proxy,
        // but it broke the moment any private SOURCE could fail on its own
        // for a correctly-unlocked caller (first hit by the travel/
        // AdventureLog source): a stale/misconfigured token there also
        // yields data: null, which was wrongly read as "the password must be
        // stale", clearing a perfectly valid stored password and re-locking
        // the UI. The server always knows for certain whether the header it
        // received matched ADMIN_PASSWORD, so ask it directly instead.
        if (unlockedPassword && !unlocked) {
          localStorage.removeItem(UNLOCK_KEY)
          setUnlockedPassword(null)
        }
      })
      .catch(() => { /* keep whatever we have */ })
  }, [unlockedPassword])

  const openUrl = useCallback((url: string, isPrivate: boolean) => {
    if (!isPrivate || unlocked) {
      window.open(url, '_blank', 'noopener,noreferrer')
    } else {
      setModal({ visible: true, pendingUrl: url })
    }
  }, [unlocked])

  const handleSiteClick = useCallback((site: SiteData) => {
    openUrl(site.links[0]?.url ?? '', site.isPrivate)
  }, [openUrl])

  const handleUrlClick = useCallback((url: string, isPrivate: boolean) => {
    openUrl(url, isPrivate)
  }, [openUrl])

  // HHI has no associated site/URL to navigate to, so unlocking it just opens
  // the password modal with an empty pendingUrl (PasswordModal already skips
  // window.open when pendingUrl is falsy).
  const handleRequestUnlock = useCallback(() => {
    setModal({ visible: true, pendingUrl: '' })
  }, [])

  const handleModalSuccess = useCallback((password: string) => {
    setUnlockedPassword(password)
    setModal({ visible: false, pendingUrl: '' })
  }, [])

  const handleAdminAuthSuccess = useCallback((pw: string) => {
    setAdminPassword(pw)
    setAdminAuth(false)
    setAdminOpen(true)
  }, [])

  const handleAdd = useCallback(async (data: Omit<SiteData, 'id'>) => {
    await apiAddSite(data, adminPassword)
    await refreshSites()
  }, [adminPassword, refreshSites])

  const handleEdit = useCallback(async (id: string, data: Partial<Omit<SiteData, 'id'>>) => {
    await apiUpdateSite(id, data, adminPassword)
    await refreshSites()
  }, [adminPassword, refreshSites])

  const handleDelete = useCallback(async (id: string) => {
    await apiDeleteSite(id, adminPassword)
    await refreshSites()
  }, [adminPassword, refreshSites])

  const handleViewToggle = useCallback(() => {
    const next = viewMode === '3d' ? 'arcade' : '3d'
    const label = next === 'arcade' ? 'PORTALS' : '3D MODE'
    setModeFlash(label)
    setTimeout(() => {
      setViewMode(next)
      setModeFlash(null)
    }, 280)
  }, [viewMode])

  const isArcade = viewMode === 'arcade'

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#050814', position: 'relative', overflow: 'hidden' }}>

      {/* ── Animated view layers ── */}
      <AnimatePresence mode="wait">
        {viewMode === '3d' ? (
          <motion.div
            key="view-3d"
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ duration: 0.38, ease: 'easeInOut' }}
            style={{ position: 'absolute', inset: 0 }}
          >
            <Canvas
              camera={{ position: [0, 10, 16], fov: 60, near: 0.1, far: 200 }}
              style={{ display: 'block' }}
              gl={{ antialias: true }}
              fallback={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#00e5ff', fontFamily: FONT_STACK, textAlign: 'center' }}>
                  <div>
                    <div style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>WebGL Not Available</div>
                    <div style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.5)' }}>Please use a modern browser with WebGL support.</div>
                  </div>
                </div>
              }
            >
              <Scene sites={sites} onSiteClick={handleSiteClick} onUrlClick={handleUrlClick} />
            </Canvas>

            {/* Header */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0,
              padding: '2rem 2rem 4rem', textAlign: 'center', pointerEvents: 'none',
              background: 'linear-gradient(to bottom, rgba(5,8,20,0.85) 0%, rgba(5,8,20,0.2) 70%, transparent 100%)',
            }}>
              <h1 style={{
                color: '#00e5ff', fontSize: 'clamp(1.2rem, 3vw, 2rem)',
                fontWeight: '300', letterSpacing: '0.3em', textTransform: 'uppercase',
                fontFamily: FONT_STACK,
                margin: 0, textShadow: '0 0 40px rgba(0, 229, 255, 0.45)',
              }}>
                AI工具入口網
              </h1>
              <p style={{
                color: 'rgba(255,255,255,0.38)', fontSize: '0.7rem',
                letterSpacing: '0.28em', textTransform: 'uppercase',
                fontFamily: FONT_STACK,
                marginTop: '0.55rem', marginBottom: 0,
              }}>
                點擊地標 · 立即進入
              </p>
            </div>

            {/* Bottom hint */}
            <div style={{ position: 'absolute', bottom: '1.5rem', left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
              <p style={{ color: 'rgba(255,255,255,0.18)', fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', fontFamily: FONT_STACK, margin: 0 }}>
                Drag to orbit · Scroll to zoom
              </p>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="view-arcade"
            initial={{ opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 60 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            style={{ position: 'absolute', inset: 0 }}
          >
            <GlassPortalView
              sites={sites}
              dashboard={dashboard}
              unlocked={unlocked}
              unlockedPassword={unlockedPassword}
              onSiteSelect={handleSiteClick}
              onRequestUnlock={handleRequestUnlock}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Mode flash overlay ── */}
      <AnimatePresence>
        {modeFlash && (
          <motion.div
            key="flash"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            style={{
              position: 'absolute', inset: 0, zIndex: 200,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: isArcade ? 'rgba(0,229,255,0.06)' : 'rgba(192,132,252,0.06)',
              backdropFilter: 'blur(4px)',
              pointerEvents: 'none',
            }}
          >
            <div style={{
              fontFamily: FONT_STACK,
              fontWeight: '100',
              fontSize: 'clamp(2rem, 5vw, 4rem)',
              color: isArcade ? '#c084fc' : '#00e5ff',
              textShadow: isArcade
                ? '0 0 40px rgba(192,132,252,0.9), 0 0 80px rgba(192,132,252,0.4)'
                : '0 0 40px rgba(0,229,255,0.9), 0 0 80px rgba(0,229,255,0.4)',
              letterSpacing: '0.35em',
              textTransform: 'uppercase',
            }}>
              {modeFlash}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Always-on-top chrome ── */}

      {/* Version history — bottom left */}
      <VersionHistory />

      {/* View mode toggle — bottom center */}
      <button
        onClick={handleViewToggle}
        title={isArcade ? '切換 3D 地標模式' : '切換街機清單模式'}
        style={{
          position: 'absolute', bottom: '1.5rem', left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 100,
          background: isArcade
            ? 'rgba(192,132,252,0.10)'
            : 'rgba(0,229,255,0.07)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: `1px solid ${isArcade ? 'rgba(192,132,252,0.35)' : 'rgba(0,229,255,0.28)'}`,
          borderRadius: '8px',
          color: isArcade ? '#c084fc' : '#00e5ff',
          fontFamily: FONT_STACK,
          fontWeight: '300',
          fontSize: 'clamp(0.6rem, 1vw, 0.72rem)',
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          padding: '9px 18px',
          cursor: 'pointer',
          lineHeight: 1,
          boxShadow: isArcade
            ? '0 0 12px rgba(192,132,252,0.3)'
            : '0 0 12px rgba(0,229,255,0.2)',
          transition: 'all 0.2s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.boxShadow = isArcade
            ? '0 0 22px rgba(192,132,252,0.55)'
            : '0 0 22px rgba(0,229,255,0.45)'
          e.currentTarget.style.transform = 'translateX(-50%) scale(1.05)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.boxShadow = isArcade
            ? '0 0 12px rgba(192,132,252,0.3)'
            : '0 0 12px rgba(0,229,255,0.2)'
          e.currentTarget.style.transform = 'translateX(-50%) scale(1)'
        }}
      >
        {isArcade ? '🌐  3D MODE' : '✦  PORTALS'}
      </button>

      {/* Admin button — bottom right */}
      <button
        onClick={() => setAdminAuth(true)}
        title="管理後台"
        style={{
          position: 'absolute', bottom: '1.5rem', right: '1.5rem', zIndex: 100,
          background: 'rgba(5,8,20,0.75)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px',
          color: 'rgba(255,255,255,0.4)', fontSize: '18px',
          padding: '8px 12px', cursor: 'pointer', lineHeight: 1,
          transition: 'color 0.2s, border-color 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'rgba(0,229,255,0.8)'; e.currentTarget.style.borderColor = 'rgba(0,229,255,0.3)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
      >
        ⚙
      </button>

      {/* Private site password modal */}
      {modal.visible && (
        <PasswordModal
          pendingUrl={modal.pendingUrl}
          onSuccess={handleModalSuccess}
          onCancel={() => setModal({ visible: false, pendingUrl: '' })}
        />
      )}

      {/* Admin auth */}
      {adminAuth && !adminOpen && (
        <AdminAuthModal
          onSuccess={handleAdminAuthSuccess}
          onCancel={() => setAdminAuth(false)}
        />
      )}

      {/* Admin panel */}
      {adminOpen && (
        <AdminPanel
          sites={sites}
          adminPassword={adminPassword}
          onAdd={handleAdd}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onClose={() => setAdminOpen(false)}
        />
      )}
    </div>
  )
}
