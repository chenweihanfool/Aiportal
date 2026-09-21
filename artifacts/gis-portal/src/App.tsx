import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { COLOR, FONT } from './theme'
import { apiFetchHermesGraph, type HermesGraphData, type HermesGraphPersonNode, type HermesGraphEventNode, type HermesGraphEdge } from './hermesGraphApi'
import { RelationshipUniverse } from './RelationshipUniverse'
import './portal.css'

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
// 2026-09-21 起這裡存的是後端 /api/auth/verify 發的有效期 session token，
// 不再是使用者輸入的密碼原文——名字沒改是因為「解鎖狀態」的語意沒變，變
// 的只是底下存的憑證種類（見 apiVerifyPassword 的說明）。
const UNLOCK_KEY = 'portal_unlocked'

// ─────────────────────────────────────────────
// Version History  (update this before each release)
// ─────────────────────────────────────────────
const VERSION_HISTORY = [
  {
    version: '2.8.0',
    date: '2026-09-21',
    summary: '關係宇宙洞察分頁新增「目前評價」：L5 每輪產生的第一人稱樞紐觀察快照',
    changes: [
      '選取人物/案件/物件節點時，洞察分頁最上面會顯示一段 L5 每天產生的第一人稱短評（≤300 字）——跟下面拓撲推導出來的洞察（共同參與、橋接風險…）不同，這段是 HERMES 從該樞紐的全鄰域語料（相關事件、既有敘事）直接寫出來的觀察評價，每輪整段覆蓋、只留最新一筆，不是累積時間軸',
      '涵蓋範圍不限於當天有寫新敘事的樞紐——L5 每類（人/案/物）挑分數最高的前 5 個常態樞紐刷新評價，點開大部分常出現的節點都該看得到，不會常常是空的',
      '純讀取既有資料：hermesGraphSnapshot 新增一個欄位存這份快照，HERMES 那邊 collect.ps1 掃樞紐檔新的「## 樞紐觀察評價」區塊送過來，沒有新 API',
    ],
  },
  {
    version: '2.7.9',
    date: '2026-09-21',
    summary: '清掉專案裡完全沒用到的舊版 UI 元件庫死碼，CSS 打包體積從 95KB 降到 1.4KB',
    changes: [
      '刪掉 components/ui/（52 個 shadcn 元件檔）、hooks/（use-mobile、use-toast）、lib/utils.ts、pages/not-found.tsx、index.css——這些是很早期版本（3D 小城鎮模式）留下的 scaffold，這個 app 改版成儀表板風格後就完全沒再被引用過，連 index.css 本身的顏色變數都還是沒填完的「red / *replace with H S L*」佔位符，從來沒真的生效過',
      '同步清掉 package.json 裡只有這些死碼在用的 30 幾個相依套件（Radix UI 系列、cmdk、recharts、react-hook-form、zod、wouter…），vite.config.ts／tsconfig.json 對應的 Tailwind 外掛與路徑別名一併移除——不影響任何現有功能，純粹是少扛一包從未執行過的程式碼',
      '效果：CSS 產物從 95.35KB 降到 1.38KB（少了從未使用的 Tailwind 工具類），JS 產物不受影響（那些套件從來沒被 import 進實際渲染路徑，本來就不會進 bundle）',
    ],
  },
  {
    version: '2.7.8',
    date: '2026-09-21',
    summary: '管理後台新增「匯出資料」：一鍵下載 HHI/心智/社交/生活從容歷史＋工具連結清單成 JSON',
    changes: [
      '管理後台（⚙）新增「匯出資料」按鈕，把幸福指數/心智指標/社交指標/生活從容四個每日歷史表 + 工具連結清單整包下載成一個 JSON 檔——自架的 DB 之外留一份可攜的個人資料備份，不需要另外連進資料庫手動 dump',
      '不含 HERMES 戰情室那幾張「只留最新一筆」的操作型監控表（不是要長期保存的個人資料），也不含任何第三方 API 憑證',
    ],
  },
  {
    version: '2.7.7',
    date: '2026-09-21',
    summary: '新增全站指令面板（⌘K / Ctrl+K）：任何畫面都能直接搜工具連結、跳關係宇宙',
    changes: [
      '按 ⌘K（Mac）或 Ctrl+K 隨時叫出全站搜尋，不用先滾到「工具連結」區塊展開才能搜——搜的是同一份工具連結資料（私領域＋公領域＋六維度裡本來就有連結的四個子系統），選中即開啟（私領域未解鎖會照舊跳密碼輸入），輸入「圖」／「關係」／「宇宙」／「graph」可以直接跳到完整關係宇宙頁面',
      '在關係宇宙頁面按 ⌘K/Ctrl+K 不會另外跳出一個搜尋框——直接把焦點跟游標丟給那一頁本來就有的人/事/案/物搜尋框，兩邊快捷鍵手感一致，不會疊出兩層搜尋介面',
    ],
  },
  {
    version: '2.7.6',
    date: '2026-09-21',
    summary: 'HERMES 戰情室新增每日歷史趨勢：CPU/記憶體/容器健康折線圖、L1~L5 管線健康色條',
    changes: [
      '「近期趨勢」新分頁：CPU 負載、記憶體、容器健康比例三條每日快照折線圖，跟幸福指數卡片用同一顆趨勢線元件——collect.ps1 本來就每 ~10 分鐘 push 一次，這次改成同時 upsert「今天」這一筆歷史，不需要另外開排程去抓',
      '知識萃取管線面板新增「近 14 天歷史」：L1~L5 每層一排色條，一眼看出最近哪一層常常出問題，不是只看「現在」這個時間點——色條存的是每次 push 當下算出來的健康狀態（不是原始 heartbeat 欄位），讀取歷史時不會因為時間過去太久而全部被誤判成異常',
      '兩個歷史面板都是懶載入：面板展開/點開才會真的發請求，平常收合不會多打 API',
    ],
  },
  {
    version: '2.7.5',
    date: '2026-09-21',
    summary: '入口網站健診第一批：生活從容補上資料過期警告；解鎖改發 session token；ADMIN_PASSWORD 未設定時拒絕啟動',
    changes: [
      '「生活從容」卡片新增資料過期警告（超過 36 小時未更新），跟心智指標/社交指標同一套機制——這是六個維度裡唯一原本沒有這層保護的，來源的 Python 每日排程如果哪天默默停了，之前會一直顯示舊分數、沒有任何提示',
      '解鎖私領域改成後端發一個 30 天效期的 session token，不再把密碼原文存進 localStorage——原本明碼永不過期，任何 XSS 或瀏覽器擴充套件只要能讀 storage 就等於拿到全部私領域＋admin 權限，改動對操作體驗沒有影響（一樣解鎖一次、裝置記住），只是底下存的憑證換了',
      'api-server 啟動時檢查 ADMIN_PASSWORD 環境變數，沒設定或等於舊版寫死在程式碼裡的預設值就直接拒絕啟動，不再靜默用弱密碼上線',
    ],
  },
  {
    version: '2.7.4',
    date: '2026-09-21',
    summary: '關係宇宙詳情面板可展開滿版閱讀，字級加大；敘事/事件合併成一條時間軸圖',
    changes: [
      '點節點後跳出的詳情面板新增「展開」鈕（⤢），點下去改成蓋滿整個視窗的全螢幕閱讀模式，不再是浮在畫面左下角、寬度只有 430px 的小卡片——展開時完全蓋住背景的 3D 關係宇宙，看資料不用再顧著背景場景轉來轉去；再點一次（⤡）收回原本的浮動小卡片',
      '全部字級改用同一個縮放係數控制（收合時比原本略大、展開時更大），不是只有展開模式才變大——原本浮動小卡片的字級本來就偏小，這次一併調整',
      '原本的「敘事」分頁改名「時間軸」，把這個節點自己關聯的事件跟 L5 圖譜敘事（編織/警報）合併成同一條依日期新到舊排序的視覺時間軸（左側色點＋連接線），不再是分開的純文字列表——這是敘事內容持續累積、原本的小卡片越來越難讀之後的呈現方式調整。洞察分頁維持不動：那裡的內容（橋接風險、二度人脈…）大多是拓撲推導出來的，沒有日期可以畫進時間軸',
    ],
  },
  {
    version: '2.7.3',
    date: '2026-09-21',
    summary: 'L4 原始檔班距調整為 11:35 / 17:15，同步修正心跳紅綠燈閾值',
    changes: [
      'L4（l4-agent-wrapper.py，RAW_INTAKE 掃描+消化）排程從 08:15/14:15 改為 11:35/17:15——11:35 班產出剛好趕上 L2 12:00 Pass 1 消化，不用等到 21:15 Pass 2；HERMES 端 cron 已同步改畢',
      'api-server 心跳紅綠燈閾值 PIPELINE_CADENCE_HOURS.l4 從 6 小時改 10 小時（stale 判定＝班距 ×2＝20 小時）：L4 改兩班後夜間間隔約 18 小時，舊閾值 12 小時會讓面板每晚 02:24 起必然假紅燈到早上 08:15；10 小時使閾值涵蓋夜間間隔，漏一班約 24 小時仍會確實轉紅',
      'L4 節點詳情卡的班表文字同步更新為 11:35 / 17:15',
    ],
  },
  {
    version: '2.7.2',
    date: '2026-09-20',
    summary: 'HERMES 戰情室新增「知識萃取管線（L1~L5）」可收合面板：互動式數據流向圖＋各環節即時健康監控',
    changes: [
      '新增一塊可收合面板，用互動式數據流向圖畫出「日記 → 知識」的完整萃取路徑：日記／RAW 原始檔兩個輸入來源 → L1 快掃／L4 原始檔 → L2 正規化 → L3 落地（唯一寫入 Events/People 正式檔的層）→ Events/People/Cases 正式檔 → L5 洞察讀取正式檔並把跨維度洞察寫回各檔案的「🧠」區塊，形成一個回饋迴圈。每個節點可點擊展開詳情卡（職責說明、對應腳本、排程），L1~L5 五個監控節點額外顯示最近執行時間、已處理/已入庫/失敗/待處理筆數',
      '各環節的規格（排程、輸入輸出、腳本檔名）是跟 HERMES 在控制頻道 PR 要來的（2026-09-20 回覆）：L1~L5 是 HERMES 內建 scheduler 的 cron job，不是 Windows 排程任務，Get-ScheduledTask 完全看不到，過去 Aiportal 這邊也從來沒有這些資料',
      '即時健康監控：HERMES 的 l{N}-agent-wrapper.py（N=1..5）每次跑完會寫一份 heartbeat 到 HERMES 主機本機的 heartbeat.json；collect.ps1 新增讀取這個檔案（跟主機上其他唯讀交接檔案同一套模式），逐層 passthrough 給 api-server 新的 /api/admin/hermes-pipeline，紅綠燈判定在讀取（GET /api/hermes-pipeline）時才算——某層失敗筆數 >0、有錯誤摘要、或最近執行時間超過該層預期班距的 2 倍未更新，就標紅；沒有 heartbeat 資料的層顯示「尚無資料」（灰），不會誤判成正常',
      'HERMES 特別提醒過 heartbeat 曾經發生過「job 照跑 ok 但心跳檔凍結」的斷鏈，所以紅綠燈只信 lastRun 的新鮮度，不是只看 status 欄位；processed==0 是正常狀態（當班沒有新內容），沒有被誤判成異常',
      '沒有跟 HERMES 要五層的 prompt 原文——面板要呈現的是資料流向跟目前健康狀態，不是每層內部的抽取邏輯細節，職責描述用 HERMES 給的架構摘要就夠寫清楚每個節點在做什麼；如果之後要在卡片裡放某一層的具體抽取邏輯，再回頭跟 HERMES 要那一層的 prompt 全文',
      '新增 hermes_pipeline_snapshot 資料表（DB migration）與對應的 POST /api/admin/hermes-pipeline／GET /api/hermes-pipeline 兩支路由，維持既有「latest 整包覆蓋、不存歷史」的模式，跟 hermes_status_snapshot 同一套',
    ],
  },
  {
    version: '2.7.1',
    date: '2026-09-20',
    summary: 'HERMES 戰情室的排程任務/近期活動/容器清單改成可收合，異常時標紅點',
    changes: [
      '排程任務狀態、近期活動、容器清單三塊子面板改成可收合、預設收起——平常這幾塊清單佔版面又沒什麼要看的，只有出狀況才需要點開；標題列點一下展開/收起，跟 HERMES 戰情室整區塊既有的收合互動同一套樣式',
      '收起狀態下，排程任務標題旁在有任務失敗時、容器清單標題旁在有容器不是 running 或 unhealthy 時，會加一顆紅點提醒——不用先展開才知道該打開查看；紅點判斷邏輯（isTaskFailed / isContainerFailed）跟原本畫每一列圖示用的判斷共用同一份，不是另外寫一次',
      '近期活動這塊沒有加紅點：這塊資料是 tail update.ps1 自己寫的 update.log，該腳本只在成功收尾時才寫一行「Done」，失敗一律在寫入前 exit 1，資料裡結構上就不存在「失敗」這個狀態可以判斷，硬加規則只會是假訊號',
    ],
  },
  {
    version: '2.7.0',
    date: '2026-09-19',
    summary: '關係宇宙接上 L5「圖譜編織層」：樞紐節點新增「敘事」分頁',
    changes: [
      'HERMES 後端 L5 於 2026-09-19 轉型為「圖譜編織層」：People/Objects/Cases 樞紐檔新增「## 圖譜敘事」區塊（增補式編織、永不收斂），原本的「## 🧠 脈絡洞察」／「## 🧠 案件脈絡與目前進度」則改成只放時效性警報。詳情卡新增「敘事」分頁（人物／案件／物件三種樞紐節點才有，事件節點沒有），把兩段內容合併成一個依日期排序的時間軸，用標籤區分「編織」與「警報」——圖譜敘事這層才剛啟用，目前 vault 裡幾乎是空的，所以把既有的 23 則警報內容一起併進來，一上線就有實質內容可看',
      '敘事文字裡的 [[wikilink]] 解析成可點連結，點下去直接跳到圖上對應的人／案／物／事件節點並置中——解析不到對應節點（連結指到圖上沒有的東西）就原樣顯示文字，不保證每個連結都能點',
      'collect.ps1 新增 Get-HermesHubNarratives：分別用 People/Objects 的「## 🧠 脈絡洞察」跟 Cases 的「## 🧠 案件脈絡與目前進度」兩種不同標題抓警報段落，加上三者共用的「## 圖譜敘事」抓編織段落；每個樞紐只送最新 20 則，防止敘事「永不收斂」的特性長期把整包 payload 撐大到頂到 body limit',
      'DB 新增 hub_narratives 欄位，API 直接整包 passthrough 給前端——沿用既有的「Events frontmatter 是唯一真相來源，其他都在讀取時反推」原則的既有例外（跟 personRelations 同一種：樞紐檔本文才有的敘述文字，Events 完全沒有這個資訊，沒有替代方案）',
    ],
  },
  {
    version: '2.6.1',
    date: '2026-09-18',
    summary: '「這陣子最活躍」排除本人',
    changes: [
      '這個人幾乎是每一筆事件的參與者，「這陣子最活躍」原本每次都是他自己奪冠——這個指標的意義是「最近誰跟我互動最多」，不是「我自己最活躍」，本人自己奪冠對這個問題沒有任何資訊量。改成只在算這一項指標時把他濾掉，人物節點本身、人數統計、圖上的其他地方都不受影響',
    ],
  },
  {
    version: '2.6.0',
    date: '2026-09-16',
    summary: '關係宇宙加上搜尋、串聯導航與關係洞察，並修掉尺度天花板',
    changes: [
      '新增搜尋框：跨人／事／案件／物件四類搜尋（不限目前核心，因為常常不知道要找的東西被歸在哪一類），同類型內把目前核心排前面；選中即選取並置中。364 個事件在球面上用眼睛根本找不到，這是能不能實際用起來的關鍵',
      '詳情卡從唯讀顯示改成可以一路串下去：以前走到事件就是死路（只印標題/日期/狀態，案件是純文字不能點，參與者和物件根本沒列），現在每一類都把所有相鄰實體列成可點的 chip；加上麵包屑記錄走過的節點鏈可回跳；順便把 L5 寫在 People/*.md「## 關係人物」的關係描述文字接進來，那段文字先前完全沒被用到',
      '新增「關聯路徑」：任兩個節點之間用 BFS 找最短路徑，回答「這兩個東西到底怎麼扯上關係的」，路徑同時在圖上打亮成琥珀色連線——是走真實的邊，不是推測',
      '詳情卡新增「洞察」分頁，全部是從圖的拓撲推導出來、資料庫裡沒有直接存的東西：最常同場的人、二度人脈（沒同場過但有共同的人）、關係缺漏（有共同事件但 L3 TASK C5 還沒寫進「## 關係人物」的配對）、橋接風險（拿掉這個人之後他的協作者會裂成幾群，也就是單一窗口／知識單點）、案件的班底與一次性參與者、案件停滯天數與最長空窗、事件在案件時序中的位置與前後事件',
      '修掉尺度天花板：coreR 原本封頂 265、外兩層又是固定偏移（+180/+130），核心節點超過約 194 個之後就只會越擠越密，上千個節點必然糊掉。改成半徑全部隨 √n 成長且不封頂、外兩層改成比例、衛星球冠角隨衛星數成長，並在每次重算佈局後自動把鏡頭拉到剛好框住整個宇宙',
      '縮放範圍放寬並改成乘法縮放：上下限從寫死的 480~2400 改成綁在宇宙半徑上（0.25~8 倍），滾輪改成指數縮放，不管宇宙多大每一格的手感都一致',
      '以上全部在前端完成，零後端／零 collect.ps1／零 DB 改動——整包圖早就在瀏覽器裡，幾百個節點的 BFS 與共現統計是微秒級',
    ],
  },
  {
    version: '2.5.0',
    date: '2026-09-16',
    summary: '關係宇宙改用確定性佈局重做：不再糊、不再亂竄、核心切換一眼看得出來',
    changes: [
      '上一版在正式資料規模（58 人物／364 事件／12 案件／54 物件）下實際上不能用，三個結構性原因：(1) 手刻的 3D 力導向模擬用 charge/dist² 且最近距離只夾到 1，密集區一重疊就生出巨大推力把節點甩出去，alpha 要十幾秒才冷卻，期間整張圖都在亂竄；(2) 深度淡出把整個球體深度線性映到 0.05~1，球心附近的節點只剩三成不透明度，幾百顆半透明圓疊起來就糊成一片霧；(3) 非核心的人物用 amberDim（偏橘），切到別的核心時人物看起來還是黃的，等於看不出核心換了誰',
      '佈局改成完全確定性、零力學迭代：核心類型的節點用黃金角均分在內層球面，其餘節點掛到自己主要核心鄰居的方向上、在該方向的球冠內散開成花瓣狀衛星群，沒有任何核心鄰居的落到最外層球殼。每幀只做「往目標座標補間 → 投影 → 畫」，所以畫面不會抖也不會亂竄，切換核心看到的是一次乾淨的重新排列動畫',
      '深度淡出的下限從 0.05 拉到 0.32，節點一律畫實心不透明的圓，整張圖從灰濛濛變成清晰銳利',
      '非核心的三類一律改用中性灰（刻意都不帶橘黃），amber 專門代表「目前的核心類型」，切換人／事／物／案件時顏色一眼就看得出換了誰，右上角圖例的色點也跟著換',
      '標籤加上螢幕空間碰撞排除：依「選取中 > 半徑大 > 離鏡頭近」的優先序逐一放置，跟已放好的標籤重疊就不畫，密集的核心球面不會再疊成一團看不懂的字',
      '點擊節點會固定在畫面正中央（旋轉軸心換成該節點），同時停掉自轉讓整個場景凍住，該節點加上光暈、只點亮它的直接鄰居並標出名字——密集圖裡要看清楚一個節點的關係，這是最有效的方式',
    ],
  },
  {
    version: '2.4.1',
    date: '2026-09-16',
    summary: '修正核心切換不變色、點節點自動置中，新增「案件為核心」',
    changes: [
      '上一版「人/事/物為核心」切換時佈局真的會變，但顏色沒有跟著換——nodeColor() 沒吃 isCore 參數，person 永遠畫 amber、event 永遠 steelDim，畫面上完全看不出核心換了誰。改成核心那個類型統一畫 amber，其餘三種各自固定一個好分辨的暗色（不動用 ok/warn/concern/crit 這幾個保留給狀態語意的顏色）',
      '同一個 bug 也讓「點擊節點變色/hover 高亮」實際上從沒真的生效過：畫布的 render/tick 迴圈只在資料變動時掛上，內部 draw() 卻直接 closure 住 hoveredId/selection 這兩個 state，只抓得到迴圈掛上那一刻的舊值（通常是 null）。改成讀對應的 ref（hoveredIdRef/selectionRef），每幀都能拿到最新值',
      '新增「案件為核心」，跟人/事/物並列成 4 個可切換的核心類型——案件（脈絡層）本來就是圖上獨立的一種節點，沒理由被排除在核心選項外',
      '點擊節點會「慢慢置中」：整個宇宙的旋轉軸心從世界原點改成緩緩向選取節點目前座標逼近的 pivot（lerp，不是瞬移），pivot 追上後該節點的座標減掉 pivot 恆為零，不管鏡頭怎麼轉、物理怎麼跑，投影都精確落在畫面正中央——資料量大時（364 事件／54 物件）圖會糊成一團，先點一個節點置中，其他節點會繞著它公轉，比整團亂轉好辨認得多',
    ],
  },
  {
    version: '2.4.0',
    date: '2026-09-16',
    summary: '關係圖追上事人物三實體架構，改成獨立全頁 3D 關係宇宙',
    changes: [
      '入口網原本的關係圖只有「人-事」兩種節點——但 9/5 起 HERMES 架構已經擴大成「事人物三實體 + 案件脈絡層」（L1~L5 pipeline），Events frontmatter 多了 case／objects 欄位、People/*.md 多了「## 關係人物」人際關係區塊、Cases/*.md 記錄案件狀態，這些全部沒進圖，數字又開始跟架構脫鉤',
      'hermes_graph_snapshot 新增 objects（Events 自己的欄位，跟 case 同一批直接反推）、personRelations（People/*.md「## 關係人物」，Events 完全沒有這個資訊，獨立掃）、cases（Cases/*.md 的 name/status，純顯示用）三塊資料；/api/hermes-graph 新增案件節點、物件節點、事件↔案件邊、事件↔物件邊、人↔人邊（同一段關係兩邊 People 檔案各記一筆，讀取時用排序過的 [from,to] 去重）',
      'collect.ps1 新增 objects YAML block 解析（跟既有 participants 的 person/role 同一套兩行一組 pairing 手法）、Get-HermesPersonRelations（正則解析「- [[人名]]（描述，共同參與：...）」這種夾雜 wikilink 的自然語言，格式對不上的行直接跳過不影響其他關係）、Get-HermesCases；全部用真實 vault 資料（290 事件／36 人物／11 案件／21 物件）跑過驗證，全數正確解析零錯誤',
      '關係圖從戰情室裡的小面板獨立成全頁（#graph hash route）：可拖拉旋轉、滾輪縮放的假 3D 球體宇宙（手刻的簡化 3D 力學模擬＋透視投影，不是重新引入 three.js），節點無邊框、依鏡頭距離自動淡出；新增「人／事／物為核心」切換，核心類型節點放大並被力學往中心拉近、其餘類型散佈成外層球殼；戰情室裡的原面板縮成精簡摘要卡（人物／事件／案件／物件數量等關鍵指標）＋一個「展開完整關係宇宙 →」按鈕，不再塞下整張圖',
      '拿掉 d3-force 依賴（舊的平面力導向圖改寫成全頁版的手刻 3D 模擬，不再需要這個函式庫）',
    ],
  },
  {
    version: '2.3.3',
    date: '2026-09-14',
    summary: '孤兒事件率改成「真孤兒」口徑：已掛案件鏈的事件不再被算成孤兒',
    changes: [
      '原本「孤兒事件率」只看 participants（人物關聯），但 C4 孤兒補鏈每天補的主要是案件（case）連結——補了案件也不會讓指標下降，73% 裡有 31 筆其實已掛案件鏈，指標永遠卡在結構性下限',
      '改算「真孤兒」＝無人物關聯且無案件歸屬（目前 108/191 ≈ 57%），C4 每輪補案件鏈會真實反映在數字下降上；原孤兒率（無人物）移到指標下方小字繼續可見',
      'collect.ps1 的 Get-HermesEvents 新增解析 frontmatter 的 case: "[[案件名]]" wikilink 欄位，隨事件整批上傳；API 層以「participants 為空且 case 為空」判定真孤兒',
    ],
  },
  {
    version: '2.3.2',
    date: '2026-09-09',
    summary: '孤立節點改成 Obsidian 式圓形散佈，並加上顯示開關',
    changes: [
      '孤兒事件（沒有任何 participants 的事件）以前跟其他節點共用同一組 charge／center 力，沒有連線拉著，會被斥力一路推到 viewBox 邊界被夾住，一整排疊在四個邊上變成一個很明顯的方框，跟 Obsidian 完全不像',
      '改用 forceRadial 把孤兒節點統一拉到「以圖中心為圓心的固定半徑」圓周上，配合節點間的斥力自然沿圓周散開，變成 Obsidian 那種孤立節點圍成一圈的觀感，不再貼著方形邊界',
      '新增「孤立節點」顯示開關（預設關閉，跟 Obsidian Graph View 預設一致），開關上會顯示目前孤立節點的數量；全部資料都被篩掉時開關仍會留著，方便隨時打開找回來',
    ],
  },
  {
    version: '2.3.1',
    date: '2026-09-06',
    summary: '人物節點也能點——列出該人物的所有關聯事件',
    changes: [
      '上一版只有事件節點能點開詳情，人物節點點了沒反應——現在點人物節點會在圖下方列出該人物參與的所有事件（日期＋標題，依日期新到舊排序），跟點事件節點的詳情卡二選一顯示',
      '人物詳情卡裡的每個事件都可以再點一次，直接切換成該事件的詳情卡（標題／日期／狀態／標籤）',
      '被選取的人物節點加一圈外框標示，跟事件節點被選取時變色的視覺邏輯一致',
    ],
  },
  {
    version: '2.3.0',
    date: '2026-09-06',
    summary: 'HERMES 人-事網路圖改成可拖拉的即時力導向動態圖',
    changes: [
      '節點改成可拖拉：按住拖動時暫時釘住該節點（fx/fy），力導向模擬即時重新計算其他節點位置，放開後立刻回到正常物理模擬，跟真正的 Obsidian Graph View 手感一致',
      '圖一載入就用即時模擬跑（d3-force 的 tick 事件直接驅動畫面重繪），不是預先算好定格再畫成靜態 SVG，會看到節點從隨機起始位置逐漸展開、收斂穩定的動畫過程',
      '滑鼠移到節點上會高亮相關聯的節點與連線，其餘淡化——人-事二分圖只有人物↔事件邊，單純抓一層鄰居只會亮到自己參加的事件，抓不到同場的其他人，所以額外多一層：把直接相連事件的「其他參與者」也一併納入高亮範圍',
      '點擊事件節點會在圖下方彈出詳細卡片（標題／日期／狀態／標籤），再點一次或按 ✕ 收合',
    ],
  },
  {
    version: '2.2.0',
    date: '2026-09-06',
    summary: 'HERMES 戰情室改成人-事關係網路圖，搬到幸福指數上方、預設展開',
    changes: [
      '知識庫健康度原本的 4 項分數（轉化率／連結健康度／活化度／本週節奏）量測的是 AI/知識/ 舊管線，9/1 HERMES 事人雙實體改版（Events/People）後新架構完全不在計算範圍內，數字早就脫鉤——與其修那 4 個公式，改成直接把 Events/*.md frontmatter 的 participants 關聯畫成類似 Obsidian Graph View 的人-事網路圖，管線一旦停止寫入，圖立刻是空的或不再長大，不會再有「看不出脫鉤」的問題',
      '新增人物數量／事件數量／平均關聯人數／孤兒事件率／本週新增事件／本週新增人物／最活躍人物幾項指標，全部從 Events 原始資料即時反推，不是另外預先算好存死的數字',
      'collect.ps1 新增 Get-HermesEvents：唯讀掃描 Events/*.md 的 frontmatter（跟既有 people.yaml 解析同一套「正則夠用就好」原則），整批 POST 給新的 /api/admin/hermes-graph；後端存最新一份快照，GET 時才計算節點/邊與所有衍生指標',
      '網路圖用 d3-force 算力導向佈局後畫成固定 SVG（不是可拖拉的即時模擬），人物節點大小依關聯事件數決定；HERMES 戰情室整節搬到幸福指數卡片上方、預設展開，圖盡量放大顯示',
      '順手修正 apiFetchHermesStatus／apiFetchHermesActivity 呼叫路徑打錯字的舊 bug（一直打成 /api/admin/hermes-status，實際後端路徑是 /api/hermes-status，兩支 GET 一直是 404，CPU/RAM/磁碟/容器狀態面板其實從沒真的讀到過資料）',
    ],
  },
  {
    version: '2.1.0',
    date: '2026-09-03',
    summary: '六維度改用百分位正規化分數：每個維度的「80 分」現在都代表同一件事',
    changes: [
      '六個維度來自四套完全獨立設計的公式，尺度差很大——有些正常使用下很難超過 60-70（例如運動、心智），有些輕鬆就上 90，直接把原始分數加權平均，「80 分」在每個維度代表完全不同的意義，強行加權平均得出的幸福指數其實很難解讀',
      '改成每個維度都拿「今天的原始分數」對照自己過去 90 天同一維度的分數排百分位（少於 10 天歷史時先用原始分數頂著，避免用太少樣本硬算出誤導性的 0 或 100）——現在六個維度的「80 分」統一代表「這是你自己在這個面向相對表現不錯的一天」，不再糾結某個維度的公式本身好不好拉高',
      '六維度指針錶、幸福指數卡片的雷達圖跟權重佔比，全部改讀正規化後的分數；每張卡片的「詳細數據」裡新增一行「原始分數（未正規化）→ 對照近 90 天百分位」，原始的公式輸出還是看得到，只是不再直接進幸福指數的計算',
      '沒有動任何一個子系統自己的公式（運動、社交 5 人封頂等既有公式都維持原樣）——正規化在 Aiportal 這邊統一做，不用動四套分別維護的計分邏輯',
    ],
  },
  {
    version: '2.0.2',
    date: '2026-08-31',
    summary: '六維度指針錶卡片補回點擊連到對應系統，並在卡片上明確標示',
    changes: [
      '人生進度管理系統／健身追蹤／任務追蹤系統／旅遊生活這四張指針錶卡片，v2.0.0 改版時只留了卡片名稱那一行文字可以點擊，點擊區域比舊版整張卡片小很多、也沒有任何視覺提示看得出來可以點——這次改成整張卡片都能點擊，並在卡片下方新增「前往系統 ↗」標示，跟舊版一樣一眼就能看出這是可以連過去的系統',
      '卡片內「詳細數據」展開/收起的點擊區域補上事件阻止冒泡，避免點開詳細數據時被外層卡片的點擊一起觸發、意外跳轉到外部系統',
    ],
  },
  {
    version: '2.0.1',
    date: '2026-08-31',
    summary: '幸福指數卡片改回雷達圖；修正手機上六維度數字被裁掉的排版問題',
    changes: [
      '幸福指數的六維度改回顯示雷達圖（保留下方的權重佔比說明），不是只有 v2.0.0 的每維度分數文字條——原本用來取代雷達圖的做法被使用者否決，雷達圖跟這幾個分數本來就有其存在理由',
      '修正手機窄螢幕上「指針錶＋六維度數字」左右並排的版面沒有響應式收合規則，導致固定寬度的指針錶＋雷達圖擠在同一列，右側內容被推出可視範圍外、完全看不到——原本在設計預覽裡就有這條 CSS 規則，正式重寫成 React 版時漏掉了，補上手機斷點改成上下堆疊',
    ],
  },
  {
    version: '2.0.0',
    date: '2026-08-31',
    summary: '首頁全面改版：玻璃卡片換成儀表板面板——指針錶、蝕刻刻度、電文式狀態板',
    changes: [
      '整個入口網從玻璃卡片＋粒子背景，改成一塊真正的儀表板面板：翰翰仔幸福指數跟六維度都改用指針錶顯示（開頁時指針會從歸零掃到實際數值），HERMES 戰情室改成電文式狀態讀數板，工具連結改成控制面板開關格＋頻率調諧式搜尋框',
      '拿掉切換用的 3D 小城鎮模式——兩套完全不同的視覺語言同時存在，會削弱新設計「一套儀器語言貫到底」的方向；連帶移除 @react-three/fiber／@react-three/drei／three 這三個只給 3D 模式用的相依套件',
      '幸福指數卡片拿掉跟六維度重複的雷達圖（下面本來就有六個指針錶各自顯示分數，雷達圖只是同一份資料的另一種畫法，不需要兩份），改成每個維度的權重佔比長條',
      '字體換成 Noto Sans TC（中文本文）＋ IBM Plex Mono（所有數字，等寬對齊）＋ Big Shoulders Display（純英文小標籤），配色換成暖灰儀表板金屬感的石墨／琥珀，不再是青紫霓虹玻璃殼',
    ],
  },
  {
    version: '1.36.0',
    date: '2026-08-31',
    summary: '社交指標計分對象改顯示中文名字，不再是英文 person_id',
    changes: [
      '上一版只把 person_id（例如 wife、brother_in_law_elder）原樣列出來，是英文代稱不是中文名字——這次改成 collect.ps1 直接唯讀查 HERMES 的 people.yaml（跟它已經在讀的 social_interactions.jsonl 同一份 NAS 存取權限），拿 person_id 換回 aliases 陣列的第一個當中文顯示名稱，一路送到卡片上；查不到對照的 id 才 fallback 顯示原始英文，不會壞掉',
      '刻意不在前端另外維護一份 person_id → 中文名字的複本——中文名字只有 people.yaml 這一份正確來源，兩邊各存一份遲早會失聯，所以選擇讓 collect.ps1 多讀一個它已經摸得到的檔案，而不是在 Aiportal 這邊手動謄一份',
    ],
  },
  {
    version: '1.35.0',
    date: '2026-08-31',
    summary: '社交指標新增計分對象名單；修正版本徽章手機排版',
    changes: [
      '社交指標卡片新增「計分對象（近 7 天）」——原本 collect.ps1 只把不重複人數（distinctPersonCount）送上伺服器，完整的 person_id 名單從來沒離開過 HERMES 主機；現在 collect.ps1／api-server／social_index_history 表／前端四邊都改成一起傳遞 person_id 陣列，卡片上直接列出這幾天被算進分數的對象',
      '版本徽章收合狀態不再把整行版本說明塞進按鈕——手機窄螢幕上原本會蓋住畫面中間的 3D MODE 按鈕、右邊的 ⚙ 齒輪，甚至超出螢幕邊緣。改成收合時只顯示版本號，完整說明搬進展開面板',
    ],
  },
  {
    version: '1.34.0',
    date: '2026-08-31',
    summary: '首頁改版：知識庫健康度併入 HERMES 戰情室、其餘區塊改可折疊、工具連結加搜尋',
    changes: [
      '知識庫健康度從心智指標卡片搬到 HERMES 戰情室，當作跟排程任務/近期活動/容器清單同一層級的第 4 個面板——兩者資料來源完全獨立，其中一個沒資料不擋住另一個',
      'HHI 六維度（人生自由/健身習慣/從容指數/旅遊生活/心智指標/社交指標）維持永遠展開，其餘區塊（HERMES 戰情室、工具連結）改成預設收合、點標題展開——首頁內容越堆越多，找特定資料越來越難找',
      '私領域純連結卡（例如 Duplicati 狀態）跟公領域合併成單一「工具連結」區塊，加上一個永遠可見的搜尋框，輸入關鍵字即時過濾兩邊的連結並自動展開',
    ],
  },
  {
    version: '1.33.0',
    date: '2026-08-21',
    summary: '翰翰仔幸福指數 v2：新增「社交指標」第六維度，心智指標改滾動窗口，旅遊生活加頻率與期待加分，權重全面調整',
    changes: [
      '新增社交指標（權重 13%）：全被動日記萃取，不用問卷——廣度（近 7 天不重複互動人數，5 人封頂）、互動強度（面對面/通話/訊息加權，見面分量最重）、連結率（有互動的天數佔觀測天數比例）三項合成，資料源自 HERMES 自己的 L1/L2 日記處理流程額外寫出的 social_interactions.jsonl（collect.ps1 只讀不寫）',
      '心智指標改成滾動 3 天窗口（今天+前 2 天日記篇數總和），不再每天歸零重算——原本每天歸零，寫日記較少的那天最弱項修正會把心智指標的有效權重放大到接近 30%，過度主導總分',
      '旅遊生活加入「頻率分」（180 天內累積行程天數，20 天封頂）跟「期待加分」（有已排定但還沒發生的行程 +5 分），不再只看距上次行程結束天數這單一維度',
      '六維權重全面調整：人生自由 31→27／健身習慣 20→18／生活從容 17→15／心智指標 17→15／旅遊生活 15→12／社交指標新增 13（最弱項修正 15% 與日對日平滑 70/30 不變）',
      '每日快照時機從「每次開頁面即時寫入歷史」改成 api-server 容器內常駐計時器固定 23:55（台北時間）觸發——23:55 之前卡片顯示的是即時重算、尚未寫入歷史的「今日暫定」值（有明確標籤），過了才凍結成當天最終分數，之後不再跳動，也不會被開頁面的時間點影響歷史紀錄',
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
  weakestComponent: string | null
}

async function apiFetchHappinessHistory(adminPassword: string, days = 30): Promise<HappinessHistoryPoint[]> {
  const r = await fetch(`${API_BASE}api/happiness/history?days=${days}`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch happiness history')
  const data = await r.json() as { history: HappinessHistoryPoint[] }
  return data.history
}

interface SocialIndexHistoryPoint {
  date: string
  socialScore: number
}

async function apiFetchSocialIndexHistory(adminPassword: string, days = 30): Promise<SocialIndexHistoryPoint[]> {
  const r = await fetch(`${API_BASE}api/social-index/history?days=${days}`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch social-index history')
  const data = await r.json() as { history: SocialIndexHistoryPoint[] }
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
  // 這兩支 GET 掛在後端的 /api/hermes-status（沒有 /admin 前綴——只有寫入用
  // 的 POST 才在 /admin/ 底下，見 routes/hermesStatus.ts），這裡先前一直錯打
  // 成 /api/admin/hermes-status，兩支 fetch 從沒真的成功過（一律 404 →
  // catch 到 statusError，面板一直顯示「暫時無法取得資料」）。2026-09-06
  // 趁重寫 HERMES 戰情室順手修正。
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

// L1~L5 日記→知識萃取管線監控（2026-09-20 起）。資料源自 HERMES 自己在
// NAS 上跑的 l{N}-agent-wrapper.py 寫出的 heartbeat.json，collect.ps1 逐
// 層 passthrough 給 api-server，health 是 api-server 讀取時依 lastRunTs +
// 預期班距換算出來的，不是這支腳本自己算——跟其他 Hermes 面板同一個「原
// 始資料 passthrough、衍生值讀取時算」原則。
type HermesPipelineHealth = 'ok' | 'crit' | 'unknown'
interface HermesPipelineLayerData {
  status: string | null
  lastRun: string | null
  lastRunTs: number | null
  processed: number | null
  committed: number | null
  failed: number | null
  backlog: number | null
  errorSummary: string | null
  durationSeconds: number | null
  health: HermesPipelineHealth
}
interface HermesPipelineData {
  available: boolean
  computedAt: string | null
  layers: Record<'L1' | 'L2' | 'L3' | 'L4' | 'L5', HermesPipelineLayerData>
}

async function apiFetchHermesPipeline(adminPassword: string): Promise<HermesPipelineData> {
  const r = await fetch(`${API_BASE}api/hermes-pipeline`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch hermes pipeline')
  return r.json() as Promise<HermesPipelineData>
}

// 每日一筆的操作型監控趨勢（2026-09-21 起）——collect.ps1 每次 push 就
// upsert「今天」那列，不是另外的排程快照，細節見後端 hermesStatusHistory.ts
// / hermesPipelineHistory.ts 的說明。兩支都是懶載入（面板展開/點開才 fetch），
// 跟既有的 30 天幸福指數歷史同一個節流考量。
interface HermesStatusHistoryPoint {
  date: string
  cpuPercent: number | null
  memPercent: number | null
  worstDiskPercent: number | null
  containersHealthy: number | null
  containersTotal: number | null
  tasksFailed: number | null
  tasksTotal: number | null
}

async function apiFetchHermesStatusHistory(adminPassword: string, days = 30): Promise<HermesStatusHistoryPoint[]> {
  const r = await fetch(`${API_BASE}api/hermes-status/history?days=${days}`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch hermes status history')
  const data = await r.json() as { history: HermesStatusHistoryPoint[] }
  return data.history
}

interface HermesPipelineHistoryPoint {
  date: string
  L1: HermesPipelineHealth | null
  L2: HermesPipelineHealth | null
  L3: HermesPipelineHealth | null
  L4: HermesPipelineHealth | null
  L5: HermesPipelineHealth | null
}

async function apiFetchHermesPipelineHistory(adminPassword: string, days = 14): Promise<HermesPipelineHistoryPoint[]> {
  const r = await fetch(`${API_BASE}api/hermes-pipeline/history?days=${days}`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch hermes pipeline history')
  const data = await r.json() as { history: HermesPipelineHistoryPoint[] }
  return data.history
}

// HermesGraph* types + apiFetchHermesGraph moved to ./hermesGraphApi.ts so
// RelationshipUniverse.tsx (the full-page #graph route) can share them
// without a circular import back into this file.

// 回傳一個有效期限的 session token，不是密碼本身——後端 /api/auth/verify
// 驗證密碼正確後發 token，前端只存這個 token（見 PasswordModal／
// AdminAuthModal 兩處呼叫端），不再把密碼原文留在 localStorage 裡。同一個
// token 之後就當「密碼」用，放進所有 API 呼叫的 x-admin-password header——
// 後端的 isAuthorized() 同時接受密碼原文（給 collect.ps1 這類伺服器對伺服
// 器呼叫）跟這裡發的 token（給瀏覽器），兩條路徑互不干擾。
async function apiVerifyPassword(password: string): Promise<string | null> {
  const r = await fetch(`${API_BASE}api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!r.ok) return null
  const data = await r.json() as { ok: boolean; token?: string }
  return data.ok && data.token ? data.token : null
}

async function apiAddSite(data: Omit<SiteData, 'id'>, adminPassword: string): Promise<SiteData> {
  const r = await fetch(`${API_BASE}api/admin/sites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
    body: JSON.stringify(data),
  })
  if (!r.ok) throw new Error('Failed to add site')
  return r.json() as Promise<SiteData>
}

async function apiUpdateSite(id: string, data: Partial<Omit<SiteData, 'id'>>, adminPassword: string): Promise<SiteData> {
  const r = await fetch(`${API_BASE}api/admin/sites/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
    body: JSON.stringify(data),
  })
  if (!r.ok) throw new Error('Failed to update site')
  return r.json() as Promise<SiteData>
}

async function apiDeleteSite(id: string, adminPassword: string): Promise<void> {
  const r = await fetch(`${API_BASE}api/admin/sites/${id}`, {
    method: 'DELETE',
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to delete site')
}

// 回傳 Blob 而不是先 parse 成 JSON 再重新 stringify——內容本來就是伺服器
// 端已經序列化好的 JSON 文字，直接轉存成檔案不需要多一趟解析/重組。
async function apiExportData(adminPassword: string): Promise<Blob> {
  const r = await fetch(`${API_BASE}api/export`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to export data')
  return r.blob()
}

// ─────────────────────────────────────────────
// Format helpers
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

// ─────────────────────────────────────────────
// Score bands — thresholds/labels are domain logic (kept verbatim from the
// glass-card version); only the returned colors changed, from the old
// cyan/green/amber/orange/red palette to this palette's ok/warn/concern/crit
// semantic tones (kept separate from the amber accent per design system).
// ─────────────────────────────────────────────
function heroTone(score: number | null, invert: boolean): { color: string; label: string } {
  if (score === null) return { color: COLOR.steelDim, label: '資料不足' }
  const s = invert ? 100 - score : score
  if (s >= 80) return { color: COLOR.ok, label: invert ? '輕鬆' : '優異' }
  if (s >= 50) return { color: COLOR.warn, label: '普通' }
  return { color: COLOR.crit, label: invert ? '緊繃' : '待加強' }
}

function hhiTone(score: number): { color: string; label: string } {
  if (score >= 80) return { color: COLOR.amber, label: '很幸福' }
  if (score >= 65) return { color: COLOR.ok, label: '穩定前進' }
  if (score >= 50) return { color: COLOR.warn, label: '尚可，需留意' }
  if (score >= 35) return { color: COLOR.concern, label: '需調整' }
  return { color: COLOR.crit, label: '警報，先照顧自己' }
}

type Band = [threshold: number, color: string, label: string]

function bandTone(score: number | null, bands: Band[]): { color: string; label: string } {
  if (score === null) return { color: COLOR.steelDim, label: '資料不足' }
  for (const [threshold, color, label] of bands) {
    if (score >= threshold) return { color, label }
  }
  return { color: COLOR.steelDim, label: '資料不足' }
}

function pctTone(pct: number | null): string {
  if (pct === null) return COLOR.steelDim
  if (pct >= 90) return COLOR.crit
  if (pct >= 75) return COLOR.warn
  return COLOR.ok
}

const MIND_SCORE_BANDS: Band[] = [[80, COLOR.ok, '優良'], [60, COLOR.warn, '普通'], [40, COLOR.concern, '偏弱'], [0, COLOR.crit, '停滯']]
const SOCIAL_SCORE_BANDS: Band[] = [[80, COLOR.ok, '熱絡'], [60, COLOR.warn, '普通'], [40, COLOR.concern, '偏冷'], [0, COLOR.crit, '疏離']]

// ─────────────────────────────────────────────
// 30-day happiness insights — pure function over existing history data, no
// new schema/accumulation period needed (weakestComponent etc. was already
// being computed/stored daily, just never surfaced).
// ─────────────────────────────────────────────
interface HappinessInsights {
  weakestFrequency: { label: string; count: number; total: number } | null
  bestDay: { date: string; score: number } | null
  worstDay: { date: string; score: number } | null
  streak: { direction: 'up' | 'down'; days: number } | null
  weekdayPattern: { bestWeekday: string; bestAvg: number; worstWeekday: string; worstAvg: number } | null
  volatility: { stdDev: number; label: string } | null
}

function computeHappinessInsights(history: HappinessHistoryPoint[]): HappinessInsights {
  if (history.length === 0) {
    return { weakestFrequency: null, bestDay: null, worstDay: null, streak: null, weekdayPattern: null, volatility: null }
  }

  const weakestCounts = new Map<string, number>()
  let weakestTotal = 0
  for (const h of history) {
    if (h.weakestComponent) {
      weakestCounts.set(h.weakestComponent, (weakestCounts.get(h.weakestComponent) ?? 0) + 1)
      weakestTotal += 1
    }
  }
  let weakestFrequency: HappinessInsights['weakestFrequency'] = null
  if (weakestCounts.size > 0) {
    const [label, count] = [...weakestCounts.entries()].sort((a, b) => b[1] - a[1])[0]!
    weakestFrequency = { label, count, total: weakestTotal }
  }

  const byScore = [...history].sort((a, b) => a.displayedScore - b.displayedScore)
  const worstDay = { date: byScore[0]!.date, score: byScore[0]!.displayedScore }
  const bestDay = { date: byScore[byScore.length - 1]!.date, score: byScore[byScore.length - 1]!.displayedScore }

  const chronological = [...history].sort((a, b) => a.date.localeCompare(b.date))
  let streak: HappinessInsights['streak'] = null
  if (chronological.length >= 2) {
    let direction: 'up' | 'down' | null = null
    let days = 1
    for (let i = chronological.length - 1; i > 0; i--) {
      const diff = chronological[i]!.displayedScore - chronological[i - 1]!.displayedScore
      if (diff === 0) break
      const dir: 'up' | 'down' = diff > 0 ? 'up' : 'down'
      if (direction === null) { direction = dir; days = 2 }
      else if (dir === direction) { days += 1 }
      else break
    }
    if (direction !== null) streak = { direction, days }
  }

  const weekdayNames = ['週日', '週一', '週二', '週三', '週四', '週五', '週六']
  const weekdaySums = new Array<number>(7).fill(0)
  const weekdayCounts = new Array<number>(7).fill(0)
  for (const h of history) {
    const wd = new Date(`${h.date}T00:00:00`).getDay()
    weekdaySums[wd] += h.displayedScore
    weekdayCounts[wd] += 1
  }
  const weekdayAverages = weekdayNames
    .map((_, wd) => ({ wd, avg: weekdayCounts[wd]! > 0 ? weekdaySums[wd]! / weekdayCounts[wd]! : null, count: weekdayCounts[wd]! }))
    .filter((w): w is { wd: number; avg: number; count: number } => w.avg !== null && w.count >= 2)
  let weekdayPattern: HappinessInsights['weekdayPattern'] = null
  if (weekdayAverages.length >= 2) {
    const best = weekdayAverages.reduce((a, b) => (b.avg > a.avg ? b : a))
    const worst = weekdayAverages.reduce((a, b) => (b.avg < a.avg ? b : a))
    if (best.wd !== worst.wd) {
      weekdayPattern = {
        bestWeekday: weekdayNames[best.wd]!,
        bestAvg: Math.round(best.avg),
        worstWeekday: weekdayNames[worst.wd]!,
        worstAvg: Math.round(worst.avg),
      }
    }
  }

  let volatility: HappinessInsights['volatility'] = null
  if (history.length >= 3) {
    const mean = history.reduce((sum, h) => sum + h.displayedScore, 0) / history.length
    const variance = history.reduce((sum, h) => sum + (h.displayedScore - mean) ** 2, 0) / history.length
    const stdDev = Math.round(Math.sqrt(variance) * 10) / 10
    const label = stdDev < 5 ? '穩定' : stdDev < 12 ? '普通' : '起伏大'
    volatility = { stdDev, label }
  }

  return { weakestFrequency, bestDay, worstDay, streak, weekdayPattern, volatility }
}

// ─────────────────────────────────────────────
// Gauge — the signature instrument of the redesign. A 270° arc dial (90°
// gap at the bottom, like a real analog speedometer) with tick marks and a
// needle. `value` drives both the amber fill arc and the needle rotation;
// both sweep in from zero exactly once, on first mount (not on every data
// refresh) — driven by a `swept` flag that flips true ~100ms after mount,
// which the CSS transition on transform/stroke-dashoffset then animates.
// Respects prefers-reduced-motion by starting already-swept.
// ─────────────────────────────────────────────
const GAUGE_START = -135
const GAUGE_SWEEP = 270
const REDUCE_MOTION = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function polarPoint(cx: number, cy: number, r: number, thetaDeg: number) {
  const rad = (thetaDeg * Math.PI) / 180
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) }
}

function gaugeArcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const s = polarPoint(cx, cy, r, startDeg)
  const e = polarPoint(cx, cy, r, endDeg)
  const large = endDeg - startDeg > 180 ? 1 : 0
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`
}

function Gauge({
  value,
  size = 'small',
  color = COLOR.amber,
  locked = false,
}: {
  value: number | null
  size?: 'primary' | 'small'
  color?: string
  locked?: boolean
}) {
  const [swept, setSwept] = useState(REDUCE_MOTION)
  useEffect(() => {
    if (REDUCE_MOTION) return
    const t = setTimeout(() => setSwept(true), 100)
    return () => clearTimeout(t)
  }, [])

  const isPrimary = size === 'primary'
  const dim = isPrimary ? 200 : 108
  const r = isPrimary ? 82 : 42
  const stroke = isPrimary ? 12 : 7
  const cx = dim / 2, cy = dim / 2
  const clamped = value === null ? 0 : Math.max(0, Math.min(100, value))
  const endAngle = GAUGE_START + (clamped / 100) * GAUGE_SWEEP
  const needleAngle = locked ? GAUGE_START : (swept ? endAngle : GAUGE_START)
  const dashOffset = swept ? 0 : 100
  const track = gaugeArcPath(cx, cy, r, GAUGE_START, GAUGE_START + GAUGE_SWEEP)
  const valueArc = gaugeArcPath(cx, cy, r, GAUGE_START, endAngle)
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const tAngle = GAUGE_START + (i / 10) * GAUGE_SWEEP
    const p1 = polarPoint(cx, cy, r + stroke / 2 + 3, tAngle)
    const p2 = polarPoint(cx, cy, r + stroke / 2 + (i % 5 === 0 ? 8 : 5), tAngle)
    return { key: i, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }
  })

  return (
    <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} style={{ flexShrink: 0, opacity: locked ? 0.4 : 1 }}>
      <path d={track} fill="none" stroke={COLOR.panelDeep} strokeWidth={stroke} strokeLinecap="round" />
      {!locked && (
        <path
          d={valueArc} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          pathLength={100} className="ip-arc-value"
          style={{ strokeDasharray: 100, strokeDashoffset: dashOffset }}
        />
      )}
      {ticks.map(t => (
        <line key={t.key} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={COLOR.steelDim} strokeWidth={1} />
      ))}
      {!locked && (
        <>
          <line
            x1={cx} y1={cy} x2={cx} y2={cy - (r - stroke / 2 - 2)}
            stroke={COLOR.ink} strokeWidth={isPrimary ? 3 : 2} strokeLinecap="round"
            className="ip-needle"
            style={{ transformOrigin: `${cx}px ${cy}px`, transform: `rotate(${needleAngle}deg)` }}
          />
          <circle cx={cx} cy={cy} r={isPrimary ? 5 : 3.5} fill={COLOR.ink} />
        </>
      )}
      <text
        x={cx} y={cy + r * 0.52} textAnchor="middle" fill={locked ? COLOR.steelDim : color}
        fontFamily={FONT.mono} fontWeight={600} fontSize={isPrimary ? 36 : 18}
      >
        {locked ? '🔒' : value !== null ? Math.round(value) : '—'}
      </text>
    </svg>
  )
}

// ─────────────────────────────────────────────
// Panel primitives — shared instrument-housing chrome. Every section of the
// page is one `Unit` (a bezeled panel with an etched module label); cards
// within it share the same background/border tokens so the whole page reads
// as one panel, not a wall of unrelated widgets.
// ─────────────────────────────────────────────
function Unit({ code, title, children }: { code: string; title: string; children: React.ReactNode }) {
  return (
    <section style={{
      position: 'relative',
      background: `linear-gradient(180deg, ${COLOR.panelRaised}, ${COLOR.panel})`,
      border: `1px solid ${COLOR.line}`,
      borderRadius: '6px',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 22px rgba(0,0,0,0.35)',
      padding: '1.6rem 1.7rem 1.5rem',
      marginBottom: '1.1rem',
    }}>
      <div style={{
        fontFamily: FONT.mono, fontSize: '0.66rem', letterSpacing: '0.2em', textTransform: 'uppercase',
        color: COLOR.steelDim, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.2rem',
      }}>
        <span style={{ color: COLOR.amberDim }}>{code}</span>
        <span style={{ fontFamily: FONT.body, fontSize: '0.72rem', letterSpacing: '0.08em', color: COLOR.steel, textTransform: 'none' }}>{title}</span>
        <span style={{ flex: 1, height: '1px', background: COLOR.line }} />
      </div>
      {children}
    </section>
  )
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '0.68rem', color: COLOR.steelDim, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: '0.6rem', fontFamily: FONT.mono }}>
      {children}
    </div>
  )
}

function LockedGaugeCard({ size = 'small', label, sub, onRequestUnlock }: { size?: 'primary' | 'small'; label: string; sub: string; onRequestUnlock: () => void }) {
  return (
    <div
      onClick={onRequestUnlock}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem',
        padding: size === 'primary' ? '0 0 0.5rem' : '1rem 0.6rem 0.9rem',
        background: size === 'primary' ? 'transparent' : COLOR.panelRaised,
        border: size === 'primary' ? 'none' : `1px solid ${COLOR.line}`,
        borderRadius: '5px', cursor: 'pointer',
      }}
    >
      <Gauge value={null} size={size} locked />
      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: COLOR.ink }}>{label}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim }}>{sub}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.68rem', color: COLOR.warn, letterSpacing: '0.05em' }}>🔒 解鎖後顯示</div>
    </div>
  )
}

// Tap-to-expand formula detail — a footer toggle line, then a bordered panel
// of label/formula rows. Works identically on mouse and touch.
function FormulaToggle({
  expanded,
  onToggle,
  labelCollapsed = '公式說明 ▼',
  labelExpanded = '收起公式說明 ▲',
}: {
  expanded: boolean
  onToggle: (e: React.MouseEvent) => void
  labelCollapsed?: string
  labelExpanded?: string
}) {
  return (
    <div
      onClick={onToggle}
      style={{ marginTop: '0.6rem', textAlign: 'right', fontSize: '0.68rem', fontFamily: FONT.mono, color: COLOR.amberDim, cursor: 'pointer' }}
    >
      {expanded ? labelExpanded : labelCollapsed}
    </div>
  )
}

function SupportStats({ items }: { items: Array<{ label: string; value: string; color?: string; formula?: string; tier?: string }> }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.4rem 2rem' }}>
      {items.map(it => (
        <div key={it.label}>
          <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, letterSpacing: '0.05em', marginBottom: '3px' }}>{it.label}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
            <span style={{ fontFamily: FONT.mono, fontSize: '1.05rem', fontWeight: 600, color: it.color ?? COLOR.ink, fontVariantNumeric: 'tabular-nums' }}>{it.value}</span>
            {it.tier && <span style={{ fontSize: '0.66rem', fontWeight: 600, color: it.color }}>{it.tier}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

function FormulaPanel({ rows }: { rows: Array<{ label: string; formula?: string }> }) {
  const withFormula = rows.filter((r): r is { label: string; formula: string } => !!r.formula)
  if (withFormula.length === 0) return null
  return (
    <div style={{ marginTop: '0.6rem', paddingTop: '0.7rem', borderTop: `1px dashed ${COLOR.line}`, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {withFormula.map(r => (
        <div key={r.label} style={{ fontSize: '0.68rem' }}>
          <div style={{ color: COLOR.steel, fontWeight: 600, marginBottom: '2px' }}>{r.label}</div>
          <div style={{ color: COLOR.steelDim, lineHeight: 1.6 }}>{r.formula}</div>
        </div>
      ))}
    </div>
  )
}

// Lightweight custom SVG line chart for 30-day trend panels — area fill +
// line + faint value labels, same instrument-mono treatment as the gauges.
function TrendLineChart({ points, color = COLOR.amber, height = 90 }: { points: Array<{ date: string; value: number }>; color?: string; height?: number }) {
  if (points.length < 2) {
    return (
      <div style={{ fontSize: '0.72rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>
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
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={COLOR.line} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
        <path d={areaPath} fill={color} fillOpacity={0.12} stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
        <circle cx={last[0]} cy={last[1]} r={2} fill={color} vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', fontFamily: FONT.mono, color: COLOR.steelDim, marginTop: '4px' }}>
        <span>{points[0]!.date}</span>
        <span>最低 {minV} · 最高 {maxV}</span>
        <span>{points[points.length - 1]!.date}</span>
      </div>
    </div>
  )
}

// Shared radar chart — still the right chart for FitnessForge's 9 muscle
// axes (no single dial can show 9 independent balance axes at once).
// Absolute scale (0..maxValue), not self-relative — a self-relative chart
// always fills to 100% regardless of actual progress.
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
      <polygon points={ringPoints(1)} fill="none" stroke={COLOR.line} strokeWidth={1} />
      <polygon points={ringPoints(0.5)} fill="none" stroke={COLOR.line} strokeWidth={1} />
      {baselineFraction !== undefined && (
        <polygon points={ringPoints(baselineFraction)} fill="none" stroke={COLOR.steel} strokeWidth={1.3} strokeDasharray="4 3" />
      )}
      {axes.map((_, i) => {
        const [x, y] = pointAt(i, r)
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={COLOR.line} strokeWidth={1} />
      })}
      <polygon points={dataPoints} fill={`${color}33`} stroke={color} strokeWidth={2} />
      {axes.map((a, i) => {
        const ang = angleAt(i)
        const [x, y] = pointAt(i, r + 20)
        const cos = Math.cos(ang)
        const anchor = cos > 0.35 ? 'start' : cos < -0.35 ? 'end' : 'middle'
        return (
          <text key={a.label} x={x} y={y} textAnchor={anchor} dominantBaseline="middle" fontSize="11" fontFamily={FONT.body} fill={COLOR.steel}>
            {a.label}{a.value !== null ? ` ${Math.round(a.value)}` : ''}
          </text>
        )
      })}
    </svg>
  )
}

// ─────────────────────────────────────────────
// Six-dimension summary bodies — one per HHI-contributing subsystem with a
// /api/public/summary source. Each returns just SupportStats + FormulaPanel
// now (the big number moved to the Gauge above it, replacing the old
// HeroIndex text). `expanded`/`onToggleExpand` were dead props left over
// from before formulas started showing unconditionally — dropped here.
// ─────────────────────────────────────────────
function PfCwhSummaryBody({ data }: { data: Record<string, unknown> }) {
  const totalAssetsTWD = typeof data['totalAssetsTWD'] === 'number' ? data['totalAssetsTWD'] : null
  const twrr = typeof data['twrr'] === 'number' ? data['twrr'] : null
  const mwrr = typeof data['mwrr'] === 'number' ? data['mwrr'] : null
  const pacingIndex = typeof data['pacingIndex'] === 'number' ? data['pacingIndex'] : null

  const items = [
    { label: '總資產', value: totalAssetsTWD !== null ? formatTWD(totalAssetsTWD) : '—', formula: '目前資產總市值（最新一筆快照）' },
    { label: 'TWRR', value: formatPct(twrr), color: twrr === null ? undefined : (twrr >= 0 ? COLOR.ok : COLOR.crit), formula: '時間加權報酬率——排除加減碼時機影響，純看資產本身的報酬表現' },
    { label: 'MWRR', value: formatPct(mwrr), color: mwrr === null ? undefined : (mwrr >= 0 ? COLOR.ok : COLOR.crit), formula: '金額加權報酬率——考慮加減碼金額與時機，反映實際到手的報酬' },
    { label: '休假配速', value: pacingIndex !== null ? `${Math.round(pacingIndex * 100)}%` : '—', formula: '休假進度 ÷ 年度時間進度，100% = 剛好照今年時間進度休假' },
  ]

  return (
    <>
      <SupportStats items={items} />
      <FormulaPanel rows={[
        { label: '人生自由指數', formula: '資產分／報酬分／休假配速分，各自正規化到 0-100 後取平均（缺項就用剩下的取平均，不會整個是 0）' },
        ...items,
      ]} />
    </>
  )
}

const MUSCLE_GROUP_AXES = ['胸', '背', '腿', '肩', '二头肌', '核心', '臀', '三头肌', '有氧']

function FitnessForgeSummaryBody({ data }: { data: Record<string, unknown> }) {
  const weeklyScore = typeof data['weeklyScore'] === 'number' ? data['weeklyScore'] : null
  const trendPct = typeof data['trendPct'] === 'number' ? data['trendPct'] : null
  const balanceScore = typeof data['balanceScore'] === 'number' ? data['balanceScore'] : null
  const coverageScore = typeof data['coverageScore'] === 'number' ? data['coverageScore'] : null
  const activityBonusPoints = typeof data['activityBonusPoints'] === 'number' ? data['activityBonusPoints'] : 0
  const muscleComposites = Array.isArray(data['muscleComposites'])
    ? data['muscleComposites'] as Array<{ name: string; composite: number }>
    : []
  const radarAxes = MUSCLE_GROUP_AXES.map(name => ({
    label: name,
    value: muscleComposites.find(m => m.name === name)?.composite ?? null,
  }))

  const items = [
    { label: '本週積分', value: weeklyScore !== null ? weeklyScore.toLocaleString('zh-TW') : '—', formula: '本週各筆訓練紀錄的加權分數總和（原始累積量，未經配速調整）' },
    { label: '趨勢', value: trendPct !== null ? `${trendPct >= 0 ? '+' : ''}${trendPct.toFixed(1)}%` : '—', color: trendPct === null ? undefined : (trendPct >= 0 ? COLOR.ok : COLOR.crit), formula: '本週至今 vs 近 4 週同一段時間平均；平均基準太小或缺資料時，改比「目前配速 vs 個人平均配速」' },
    {
      label: '覆蓋率',
      value: coverageScore !== null ? `${coverageScore}%${activityBonusPoints > 0 ? `（含活動量 +${activityBonusPoints}%）` : ''}` : '—',
      formula: '本週肌群雷達圖多邊形面積 ÷ 每軸都達 100% 維持量時的面積，越高代表整體訓練量越飽滿；活動量（例如步數）另外加成，封頂 +10%',
    },
    { label: '均衡度', value: balanceScore !== null ? `${balanceScore}%` : '—', formula: '最弱肌群複合分 ÷ 最強肌群複合分（複合分 = 組數 40% + 容量 60%），數字越低代表落差越大' },
  ]

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.6rem', alignItems: 'center' }}>
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <SupportStats items={items} />
        <FormulaPanel rows={[
          { label: '運動習慣指數', formula: '訓練量分／覆蓋分／均衡分／趨勢分，各自正規化到 0-100 後取平均（缺項就用剩下的取平均）' },
          ...items,
        ]} />
      </div>
      <LabeledRadarChart axes={radarAxes} maxValue={150} baselineFraction={100 / 150} size={220} color={COLOR.amber} />
    </div>
  )
}

function VikunjaSummaryBody({ data }: { data: Record<string, unknown> }) {
  const overdueScore = typeof data['overdueScore'] === 'number' ? data['overdueScore'] : null
  const loadScore = typeof data['loadScore'] === 'number' ? data['loadScore'] : null
  const stagnationScore = typeof data['stagnationScore'] === 'number' ? data['stagnationScore'] : null
  const completionScore = typeof data['completionScore'] === 'number' ? data['completionScore'] : null

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
    <>
      <SupportStats items={items} />
      <FormulaPanel rows={[
        { label: '從容指數', formula: '100 － 忙碌指數（忙碌指數 = 逾期壓力／近期負荷／停滯程度／拖延程度四項加權平均，每天由 Python 服務算一次）。數字越高代表越從容' },
        ...items,
      ]} />
    </>
  )
}

function AdventureLogSummaryBody({ data }: { data: Record<string, unknown> }) {
  const daysSinceLastTrip = typeof data['daysSinceLastTrip'] === 'number' ? data['daysSinceLastTrip'] : null
  const lastTripEndDate = typeof data['lastTripEndDate'] === 'string' ? data['lastTripEndDate'] : null
  const recencyScore = typeof data['recencyScore'] === 'number' ? data['recencyScore'] : null
  const frequencyScore = typeof data['frequencyScore'] === 'number' ? data['frequencyScore'] : null
  const tripDaysLast180 = typeof data['tripDaysLast180'] === 'number' ? data['tripDaysLast180'] : null
  const anticipationBonus = typeof data['anticipationBonus'] === 'number' ? data['anticipationBonus'] : 0
  const hasUpcomingTrip = data['hasUpcomingTrip'] === true

  const items = [
    { label: '距上次旅行', value: daysSinceLastTrip !== null ? `${daysSinceLastTrip} 天` : '尚無紀錄', formula: '距離最近一次已結束行程的天數（還沒發生的計畫中行程不算）——換算成 recency 子分數' },
    { label: '最近一次行程結束', value: lastTripEndDate ? new Date(lastTripEndDate).toLocaleDateString('zh-TW') : '—', formula: 'AdventureLog 裡最近一筆已結束行程的結束日期' },
    { label: 'Recency 子分數', value: recencyScore !== null ? String(recencyScore) : '—', formula: '3 天內剛玩回來 = 100 分，之後線性遞減，約 93 天沒出去玩 = 0 分' },
    { label: 'Frequency 子分數', value: frequencyScore !== null ? String(frequencyScore) : '—', formula: `min(100, round(近 180 天累積行程天數 ÷ 20 × 100))${tripDaysLast180 !== null ? `（目前近 180 天累積 ${tripDaysLast180} 天）` : ''}` },
    { label: '期待加分', value: hasUpcomingTrip ? `+${anticipationBonus}` : '無', formula: '有已排定但還沒發生的行程 +5 分（開關預設開啟）' },
  ]

  return (
    <>
      <SupportStats items={items} />
      <FormulaPanel rows={[
        { label: '旅遊生活（HHI v2）', formula: 'travelScore = clamp(round(0.5 × Recency + 0.5 × Frequency) + 期待加分, 0, 100)——要維持一定的整體旅遊頻率，不是只看距上次旅行天數' },
        ...items,
      ]} />
    </>
  )
}

const SUMMARY_BODIES: Record<string, (props: { data: Record<string, unknown> }) => React.ReactElement> = {
  'pf-cwh': PfCwhSummaryBody,
  'fitnessforge': FitnessForgeSummaryBody,
  'travel': AdventureLogSummaryBody,
  'vikunja': VikunjaSummaryBody,
}

const DIMENSION_HERO_FIELD: Record<string, string> = {
  'pf-cwh': 'lifeFreedomIndex',
  'fitnessforge': 'habitIndex',
  'vikunja': 'busyIndex', // raw, uninverted — shown as "原始分數" detail only
  'travel': 'travelScore',
}

// HHI v3 (2026-09-01) — the six dimensions come from four independently
// designed formulas with wildly different shapes (see happinessIndex.ts's
// percentile normalization comment), so "80" meant something different in
// every dial. The gauges now show each dimension's percentile rank against
// its own trailing 90-day history (from the "hhi" summary, already
// normalized server-side), not the raw formula output — the raw number
// moves to the "詳細數據" panel below instead.
const DIMENSION_NORMALIZED_FIELD: Record<string, string> = {
  'pf-cwh': 'lifeFreedomScore',
  'fitnessforge': 'fitnessHabitScore',
  'vikunja': 'calmScore', // already inverted+normalized — higher = calmer
  'travel': 'travelScore',
}

const DIMENSION_SUB: Record<string, string> = {
  'pf-cwh': '人生自由',
  'fitnessforge': '運動習慣',
  'vikunja': '從容指數',
  'travel': '旅遊生活',
}

// Replaces GlassSummaryCard — one gauge tile per HHI-contributing subsystem
// that has a portal_sites row (pf-cwh/fitnessforge/vikunja/travel). Vikunja
// is special-cased: the API's busyIndex is "higher = busier", displayed
// inverted as a calm index so all six dials share "higher = better".
function DimensionGauge({
  site,
  summary,
  hhiSummary,
  unlocked,
  onSelect,
}: {
  site: SiteData
  summary: DashboardSummary
  hhiSummary: DashboardSummary | undefined
  unlocked: boolean
  onSelect: (site: SiteData) => void
}) {
  const isLocked = site.isPrivate && !unlocked
  const [expanded, setExpanded] = useState(false)
  const Body = SUMMARY_BODIES[summary.subsystemId]
  const data = summary.data
  const rawHero = data && typeof data[DIMENSION_HERO_FIELD[summary.subsystemId] ?? ''] === 'number'
    ? data[DIMENSION_HERO_FIELD[summary.subsystemId]!] as number
    : null
  const hhiData = hhiSummary?.data
  const normalizedScore = hhiData && typeof hhiData[DIMENSION_NORMALIZED_FIELD[summary.subsystemId] ?? ''] === 'number'
    ? hhiData[DIMENSION_NORMALIZED_FIELD[summary.subsystemId]!] as number
    : null
  const tone = normalizedScore !== null ? heroTone(normalizedScore, false) : { color: COLOR.steelDim, label: '資料不足' }

  if (isLocked) {
    return <LockedGaugeCard label={site.name} sub={site.subtitle || DIMENSION_SUB[summary.subsystemId] || ''} onRequestUnlock={() => onSelect(site)} />
  }

  return (
    <div
      onClick={() => onSelect(site)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', cursor: 'pointer',
        padding: '1rem 0.9rem 0.9rem', background: COLOR.panelRaised, border: `1px solid ${COLOR.line}`, borderRadius: '5px',
      }}
    >
      <Gauge value={normalizedScore} color={tone.color} />
      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: COLOR.ink, textAlign: 'center' }}>{site.name}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim, letterSpacing: '0.04em' }}>
        {normalizedScore !== null ? tone.label : (summary.status === 'pending' ? '資料準備中' : '暫時無法取得資料')}
      </div>
      {/* 目前只有 vikunja（從容指數）的資料會帶 stale 欄位——其餘三個維度
          每次開頁面都即時打原站 API，沒有「上次成功計算是多久以前」這個概
          念可言。跟 MindIndexCard／SocialIndexCard 同一套文案/樣式，通用寫
          在這裡而不是只寫在 VikunjaSummaryBody 裡，以後哪個維度也需要就不
          用再抄一次。 */}
      {data?.['stale'] === true && <div style={{ fontSize: '0.62rem', color: COLOR.warn }}>資料已超過 36 小時未更新</div>}
      {Body && data && (
        <div style={{ width: '100%', marginTop: '0.3rem' }} onClick={e => e.stopPropagation()}>
          <FormulaToggle expanded={expanded} onToggle={() => setExpanded(x => !x)} labelCollapsed="詳細數據 ▼" labelExpanded="收起 ▲" />
          {expanded && (
            <div style={{ marginTop: '0.5rem' }}>
              <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, marginBottom: '0.5rem', lineHeight: 1.5 }}>
                原始分數（未正規化）：{rawHero !== null ? rawHero : '—'}　→　對照近 90 天百分位 = {normalizedScore ?? '—'}
              </div>
              <Body data={data} />
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', paddingTop: '0.5rem', marginTop: '0.2rem', borderTop: `1px solid ${COLOR.line}`, fontFamily: FONT.mono, fontSize: '0.6rem' }}>
        <span style={{ color: COLOR.steelDim }}>{formatMinutesAgo(summary.fetchedAt)}</span>
        <span style={{ color: COLOR.amberDim, letterSpacing: '0.03em' }}>前往系統 ↗</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// 心智指標 — dailyEngagementScore (計入 HHI, 純看近 3 天日記篇數滾動總和)。
// 知識庫健康度（原本這張卡片唯一的內容）已搬到 HERMES 戰情室當獨立面板，
// 見 HermesKnowledgeHealthPanel。
// ─────────────────────────────────────────────
function MindIndexCard({
  summary,
  hhiSummary,
  unlocked,
  onSelect,
}: {
  summary: DashboardSummary | undefined
  hhiSummary: DashboardSummary | undefined
  unlocked: boolean
  onSelect: () => void
}) {
  const isLocked = !unlocked
  const data = summary?.data
  const dailyEngagementScore = typeof data?.['dailyEngagementScore'] === 'number' ? data['dailyEngagementScore'] as number : null
  const diaryEntryCount = typeof data?.['diaryEntryCount'] === 'number' ? data['diaryEntryCount'] as number : null
  const stale = data?.['stale'] === true
  const [expanded, setExpanded] = useState(false)
  const normalizedScore = typeof hhiSummary?.data?.['mindScore'] === 'number' ? hhiSummary.data['mindScore'] as number : null
  const tone = bandTone(normalizedScore, MIND_SCORE_BANDS)

  if (isLocked) {
    return <LockedGaugeCard label="心智指標" sub="日記書寫" onRequestUnlock={onSelect} />
  }

  const engagementItems = [
    { label: '日記篇數（今天）', value: diaryEntryCount !== null ? String(diaryEntryCount) : '—', formula: '今天的日記篇數，計分實際用的是近 3 天滾動總和' },
  ]

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem',
      padding: '1rem 0.9rem 0.9rem', background: COLOR.panelRaised, border: `1px solid ${COLOR.line}`, borderRadius: '5px',
    }}>
      <Gauge value={normalizedScore} color={tone.color} />
      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: COLOR.ink }}>心智指標</div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim }}>
        {normalizedScore !== null ? tone.label : (summary?.status === 'error' ? '暫時無法取得資料' : '資料準備中')}
      </div>
      {stale && <div style={{ fontSize: '0.62rem', color: COLOR.warn }}>資料已超過 36 小時未更新</div>}
      <div style={{ width: '100%', marginTop: '0.3rem' }}>
        <FormulaToggle expanded={expanded} onToggle={() => setExpanded(x => !x)} labelCollapsed="詳細數據 ▼" labelExpanded="收起 ▲" />
        {expanded && (
          <div style={{ marginTop: '0.5rem' }}>
            <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, marginBottom: '0.5rem', lineHeight: 1.5 }}>
              原始分數（未正規化）：{dailyEngagementScore ?? '—'}　→　對照近 90 天百分位 = {normalizedScore ?? '—'}
            </div>
            <SupportStats items={engagementItems} />
            <FormulaPanel rows={[
              { label: '心智指標（計入幸福指數，HHI v2 滾動 3 天窗口）', formula: 'dailyEngagementScore = round(100 × 近 3 天篇數總和 ÷ (近 3 天篇數總和 + 10))' },
              ...engagementItems,
            ]} />
          </div>
        )}
      </div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, marginTop: '0.2rem' }}>
        {formatMinutesAgo(summary?.fetchedAt ?? null)}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// 社交指標 (HHI v2) — 全被動日記萃取，資料來源是 social_interactions.jsonl。
// ─────────────────────────────────────────────
function SocialIndexCard({
  summary,
  hhiSummary,
  unlocked,
  onSelect,
}: {
  summary: DashboardSummary | undefined
  hhiSummary: DashboardSummary | undefined
  unlocked: boolean
  onSelect: () => void
}) {
  const isLocked = !unlocked
  const data = summary?.data
  const observedDayCount = typeof data?.['observedDayCount'] === 'number' ? data['observedDayCount'] as number : null
  const distinctPersonCount = typeof data?.['distinctPersonCount'] === 'number' ? data['distinctPersonCount'] as number : null
  const daysWithInteraction = typeof data?.['daysWithInteraction'] === 'number' ? data['daysWithInteraction'] as number : null
  const breadthScore = typeof data?.['breadthScore'] === 'number' ? data['breadthScore'] as number : null
  const intensityScore = typeof data?.['intensityScore'] === 'number' ? data['intensityScore'] as number : null
  const connectionRateScore = typeof data?.['connectionRateScore'] === 'number' ? data['connectionRateScore'] as number : null
  const socialScore = typeof data?.['socialScore'] === 'number' ? data['socialScore'] as number : null
  const personNamesRaw = data?.['personNames']
  const personNames = Array.isArray(personNamesRaw) ? personNamesRaw.filter((v): v is string => typeof v === 'string') : null
  const stale = data?.['stale'] === true
  const [expanded, setExpanded] = useState(false)
  const normalizedScore = typeof hhiSummary?.data?.['socialScore'] === 'number' ? hhiSummary.data['socialScore'] as number : null
  const tone = bandTone(normalizedScore, SOCIAL_SCORE_BANDS)

  if (isLocked) {
    return <LockedGaugeCard label="社交指標" sub="近 7 天社交活動" onRequestUnlock={onSelect} />
  }

  const socialItems = [
    { label: '廣度', value: breadthScore !== null ? String(breadthScore) : '—', formula: 'min(100, 近 7 天不重複互動人數 × 20)——5 人封頂' },
    { label: '互動強度', value: intensityScore !== null ? String(intensityScore) : '—', formula: 'min(100, round(近 7 天加權互動點數 ÷ 15 × 100))——見面 3 點／通話 2 點／訊息 1 點' },
    { label: '連結率', value: connectionRateScore !== null ? String(connectionRateScore) : '—', formula: 'round(近 7 天有互動的觀測日數 ÷ 近 7 天觀測日數 × 100)' },
    { label: '觀測日／互動天數', value: observedDayCount !== null ? `${daysWithInteraction ?? 0} / ${observedDayCount}` : '—', formula: '觀測日＝當天有寫日記（≥1 篇）' },
  ]

  const showEmpty = observedDayCount === null || observedDayCount === 0 || socialScore === null

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem',
      padding: '1rem 0.9rem 0.9rem', background: COLOR.panelRaised, border: `1px solid ${COLOR.line}`, borderRadius: '5px',
    }}>
      <Gauge value={normalizedScore} color={tone.color} />
      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: COLOR.ink }}>社交指標</div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim }}>
        {showEmpty ? (summary?.status === 'error' ? '暫時無法取得資料' : '近 7 天沒有日記可供觀測') : tone.label}
      </div>
      {stale && <div style={{ fontSize: '0.62rem', color: COLOR.warn }}>資料已超過 36 小時未更新</div>}
      {distinctPersonCount === 0 && !showEmpty && (
        <div style={{ fontSize: '0.62rem', color: COLOR.steel, textAlign: 'center' }}>這幾天有寫日記，但沒有社交互動紀錄——真實的 0 分</div>
      )}
      {personNames && personNames.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', justifyContent: 'center', marginTop: '0.2rem' }}>
          {personNames.map(name => (
            <span key={name} style={{ fontSize: '0.62rem', color: COLOR.steel, background: COLOR.panelDeep, border: `1px solid ${COLOR.line}`, borderRadius: '999px', padding: '2px 8px' }}>{name}</span>
          ))}
        </div>
      )}
      {!showEmpty && (
        <div style={{ width: '100%', marginTop: '0.3rem' }}>
          <FormulaToggle expanded={expanded} onToggle={() => setExpanded(x => !x)} labelCollapsed="詳細數據 ▼" labelExpanded="收起 ▲" />
          {expanded && (
            <div style={{ marginTop: '0.5rem' }}>
              <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, marginBottom: '0.5rem', lineHeight: 1.5 }}>
                原始分數（未正規化）：{socialScore ?? '—'}　→　對照近 90 天百分位 = {normalizedScore ?? '—'}
              </div>
              <SupportStats items={socialItems} />
              <FormulaPanel rows={[
                { label: '社交指標（計入幸福指數）', formula: 'socialScore = round(0.40 × 廣度 + 0.40 × 互動強度 + 0.20 × 連結率)' },
                ...socialItems,
              ]} />
            </div>
          )}
        </div>
      )}
      <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, marginTop: '0.2rem' }}>
        {formatMinutesAgo(summary?.fetchedAt ?? null)}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// 翰翰仔幸福指數 (Hanhan Happiness Index) — the primary instrument.
// ─────────────────────────────────────────────
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
  const isLocked = !unlocked

  useEffect(() => {
    if (!unlockedPassword || history !== null) return
    let cancelled = false
    apiFetchHappinessHistory(unlockedPassword)
      .then(rows => { if (!cancelled) setHistory(rows) })
      .catch(() => { if (!cancelled) setHistoryError(true) })
    return () => { cancelled = true }
  }, [unlockedPassword, history])

  const data = summary?.data
  const displayedScore = typeof data?.['displayedScore'] === 'number' ? data['displayedScore'] as number : null
  const baseScore = typeof data?.['baseScore'] === 'number' ? data['baseScore'] as number : null
  const weakestScore = typeof data?.['weakestScore'] === 'number' ? data['weakestScore'] as number : null
  const finalScore = typeof data?.['finalScore'] === 'number' ? data['finalScore'] as number : null
  const weakestComponent = typeof data?.['weakestComponent'] === 'string' ? data['weakestComponent'] as string : null
  const lifeFreedomScore = typeof data?.['lifeFreedomScore'] === 'number' ? data['lifeFreedomScore'] as number : null
  const fitnessHabitScore = typeof data?.['fitnessHabitScore'] === 'number' ? data['fitnessHabitScore'] as number : null
  const calmScore = typeof data?.['calmScore'] === 'number' ? data['calmScore'] as number : null
  const mindScore = typeof data?.['mindScore'] === 'number' ? data['mindScore'] as number : null
  const travelScore = typeof data?.['travelScore'] === 'number' ? data['travelScore'] as number : null
  const socialScore = typeof data?.['socialScore'] === 'number' ? data['socialScore'] as number : null
  const usingStaleData = data?.['usingStaleData'] === true
  const isSnapshotFinal = data?.['isSnapshotFinal'] === true
  const weights = data?.['weights'] as { lifeFreedomWeight?: number; fitnessWeight?: number; calmWeight?: number; mindWeight?: number; travelWeight?: number; socialWeight?: number } | undefined

  if (isLocked) {
    return <LockedGaugeCard size="primary" label="翰翰仔幸福指數" sub="Hanhan Happiness Index" onRequestUnlock={onRequestUnlock} />
  }

  if (!data || displayedScore === null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
        <Gauge value={null} size="primary" />
        <div style={{ fontSize: '0.85rem', color: COLOR.steelDim }}>資料準備中…</div>
      </div>
    )
  }

  const tone = hhiTone(displayedScore)
  const contributions: Array<{ label: string; value: number | null; weightPct: number }> = [
    { label: '人生自由', value: lifeFreedomScore, weightPct: Math.round((weights?.lifeFreedomWeight ?? 0.27) * 100) },
    { label: '健身習慣', value: fitnessHabitScore, weightPct: Math.round((weights?.fitnessWeight ?? 0.18) * 100) },
    { label: '生活從容', value: calmScore, weightPct: Math.round((weights?.calmWeight ?? 0.15) * 100) },
    { label: '心智指標', value: mindScore, weightPct: Math.round((weights?.mindWeight ?? 0.15) * 100) },
    { label: '社交指標', value: socialScore, weightPct: Math.round((weights?.socialWeight ?? 0.13) * 100) },
    { label: '旅遊生活', value: travelScore, weightPct: Math.round((weights?.travelWeight ?? 0.12) * 100) },
  ]
  const radarAxes = contributions.map(c => ({ label: c.label, value: c.value }))

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2rem', alignItems: 'center' }} className="ip-primary-grid">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem' }}>
          <Gauge value={displayedScore} size="primary" color={tone.color} />
          <div style={{ fontSize: '0.95rem', fontWeight: 600, color: tone.color }}>{tone.label}</div>
          {!isSnapshotFinal && (
            <span style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.warn, border: `1px solid ${COLOR.warn}`, borderRadius: '999px', padding: '1px 8px' }}>今日暫定</span>
          )}
        </div>
        <LabeledRadarChart axes={radarAxes} maxValue={100} size={230} color={tone.color} />
      </div>

      {/* 權重佔比——雷達圖只畫得出分數，這行補上每個維度實際佔幸福指數的
          百分比，雷達圖看不出來的資訊。 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem 1.2rem', justifyContent: 'center', marginTop: '1rem', fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.steelDim }}>
        {contributions.map(c => (
          <span key={c.label}>{c.label} <span style={{ color: COLOR.steel }}>{c.weightPct}%</span></span>
        ))}
      </div>

      {weakestComponent && (
        <div style={{ fontSize: '0.78rem', color: COLOR.steel, marginTop: '1rem' }}>
          目前最需要照顧：<span style={{ color: COLOR.warn, fontWeight: 600 }}>{weakestComponent}</span>
        </div>
      )}

      {history !== null && history.length > 0 && (() => {
        const insights = computeHappinessInsights(history)
        const rows: string[] = []
        if (insights.weakestFrequency) {
          rows.push(`最常見短板：${insights.weakestFrequency.label}（${insights.weakestFrequency.count}/${insights.weakestFrequency.total} 天）`)
        }
        if (insights.bestDay && insights.worstDay && insights.bestDay.date !== insights.worstDay.date) {
          rows.push(`最高 ${insights.bestDay.date}（${insights.bestDay.score} 分）· 最低 ${insights.worstDay.date}（${insights.worstDay.score} 分）`)
        }
        if (insights.streak && insights.streak.days >= 2) {
          rows.push(`連續 ${insights.streak.days} 天${insights.streak.direction === 'up' ? '上升' : '下降'}`)
        }
        if (insights.weekdayPattern) {
          rows.push(`${insights.weekdayPattern.bestWeekday}通常最高（${insights.weekdayPattern.bestAvg} 分）· ${insights.weekdayPattern.worstWeekday}通常最低（${insights.weekdayPattern.worstAvg} 分）`)
        }
        if (insights.volatility) {
          rows.push(`波動度：${insights.volatility.label}（標準差 ${insights.volatility.stdDev}）`)
        }
        if (rows.length === 0) return null
        return (
          <div style={{ marginTop: '1rem', paddingTop: '0.9rem', borderTop: `1px solid ${COLOR.line}` }}>
            <SubLabel>近 30 天洞察</SubLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {rows.map(r => <div key={r} style={{ fontSize: '0.76rem', color: COLOR.steel, lineHeight: 1.6 }}>{r}</div>)}
            </div>
          </div>
        )
      })()}

      <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: `1px dashed ${COLOR.line}`, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {[
          ['基礎分（加權平均）', baseScore !== null ? baseScore.toFixed(2) : '—'],
          ['最弱項分數', weakestScore !== null ? weakestScore.toFixed(2) : '—'],
          ['短板修正後（平滑前）', finalScore !== null ? String(finalScore) : '—'],
          ['平滑後（目前顯示值）', String(displayedScore)],
        ].map(([label, value]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem' }}>
            <span style={{ color: COLOR.steelDim }}>{label}</span>
            <span style={{ color: COLOR.steel, fontWeight: 500, fontFamily: FONT.mono }}>{value}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.7rem', marginTop: '0.8rem', borderTop: `1px solid ${COLOR.line}` }}>
        <span style={{ fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.steelDim }}>
          {formatMinutesAgo(summary?.fetchedAt ?? null)}
          {usingStaleData ? <span style={{ color: COLOR.warn, marginLeft: '8px' }}>· 部分資料為最近可用值</span> : null}
        </span>
        <span onClick={() => setExpanded(x => !x)} style={{ fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.amberDim, cursor: 'pointer' }}>
          {expanded ? '收起趨勢圖 ▲' : '歷史趨勢圖 ▼'}
        </span>
      </div>

      {expanded && (
        <div style={{ marginTop: '0.6rem', paddingTop: '0.8rem', borderTop: `1px dashed ${COLOR.line}` }}>
          <SubLabel>近 30 天趨勢（每日顯示值）</SubLabel>
          {historyError ? (
            <div style={{ fontSize: '0.72rem', color: COLOR.steelDim }}>趨勢資料讀取失敗</div>
          ) : history === null ? (
            <div style={{ fontSize: '0.72rem', color: COLOR.steelDim }}>載入中…</div>
          ) : (
            <TrendLineChart points={history.map(h => ({ date: h.date, value: h.displayedScore }))} color={tone.color} />
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// HERMES 戰情室 — operational monitoring, collected by
// services/hermes-status/collect.ps1 and POSTed to /api/admin/hermes-status
// + /api/admin/hermes-activity. Not a happiness dimension.
// ─────────────────────────────────────────────
function formatGb(n: number): string {
  return `${n.toFixed(1)} GB`
}

function StatCell({ label, value, sub, valueColor }: { label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <div style={{ background: COLOR.panelRaised, padding: '0.85rem 1rem' }}>
      <span style={{ fontFamily: FONT.mono, fontSize: '0.6rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: COLOR.steelDim, marginBottom: '0.35rem', display: 'block' }}>{label}</span>
      <span style={{ fontFamily: FONT.mono, fontSize: '1.3rem', fontWeight: 600, color: valueColor ?? COLOR.ink, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {sub && <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim, marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}

function SubPanel({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: COLOR.panelRaised, border: `1px solid ${COLOR.line}`, borderRadius: '5px', padding: '1rem 1.1rem',
    }}>
      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: COLOR.ink, marginBottom: '2px' }}>{title}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim, marginBottom: '0.7rem' }}>{sub}</div>
      {children}
    </div>
  )
}

// 跟 SubPanel 同一張卡片外觀，差別是標題列可點擊收合、預設收起——HERMES
// 戰情室這幾塊清單（排程任務/近期活動/容器）平常沒事不用一直佔版面，異
// 常時才需要點開看，所以標題邊加一顆紅點：平常收合也看得到「這裡有問題
// 該打開」，不用先展開才知道。`hasAlert` 沒帶或 false 就不畫紅點——不是
// 每個清單都有明確的「異常」訊號可判斷（例如近期活動目前只會記成功的部
// 署，update.ps1 失敗時整支腳本 exit 1、從來不會寫進 log，所以那個分頁
// 目前沒有紅點）。
function CollapsibleSubPanel({
  title, sub, hasAlert, children,
}: { title: string; sub: string; hasAlert?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{
      background: COLOR.panelRaised, border: `1px solid ${COLOR.line}`, borderRadius: '5px', padding: '1rem 1.1rem',
    }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: COLOR.ink }}>{title}</span>
        {hasAlert && (
          <span
            title="有異常狀況，建議展開查看"
            style={{ width: '7px', height: '7px', borderRadius: '50%', background: COLOR.crit, boxShadow: `0 0 5px ${COLOR.crit}`, flexShrink: 0 }}
          />
        )}
        <span style={{ flex: 1 }} />
        <span style={{ display: 'inline-block', transition: 'transform 0.2s ease', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', color: COLOR.amberDim, fontSize: '0.7rem' }}>▶</span>
      </div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim, marginTop: '2px', marginBottom: open ? '0.7rem' : 0 }}>{sub}</div>
      {open && children}
    </div>
  )
}

function HermesEventGraphPanel({ unlockedPassword }: { unlockedPassword: string | null }) {
  const [data, setData] = useState<HermesGraphData | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!unlockedPassword) return
    let cancelled = false
    apiFetchHermesGraph(unlockedPassword)
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [unlockedPassword])

  return (
    <SubPanel title="事人物關係網路" sub="HERMES 事人物三實體架構（Events/People/Cases/Objects）· 不計入幸福指數">
      {error ? (
        <div style={{ fontSize: '0.72rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>暫時無法取得資料</div>
      ) : data === null ? (
        <div style={{ fontSize: '0.72rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>載入中…</div>
      ) : !data.available || !data.graph || !data.metrics ? (
        <div style={{ fontSize: '0.72rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>資料準備中，collect.ps1 還沒掃過 Events/</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '1px', background: COLOR.line, border: `1px solid ${COLOR.line}`, borderRadius: '5px', overflow: 'hidden', marginBottom: '0.9rem' }}>
            <StatCell label="人物數量" value={String(data.metrics.peopleCount)} />
            <StatCell label="事件數量" value={String(data.metrics.eventsCount)} />
            <StatCell label="案件數量" value={String(data.metrics.casesCount)} sub={`${data.metrics.activeCasesCount} 進行中`} />
            <StatCell label="物件數量" value={String(data.metrics.objectsCount)} />
            <StatCell label="平均關聯人數" value={data.metrics.avgParticipantsPerEvent.toFixed(1)} sub="每事件" />
            <StatCell label="真孤兒事件率" value={`${data.metrics.trueOrphanEventRatioPct}%`} valueColor={data.metrics.trueOrphanEventRatioPct >= 50 ? COLOR.warn : undefined} sub={`無人物且無案件（孤兒 ${data.metrics.orphanEventRatioPct}%）`} />
          </div>
          {data.metrics.mostActivePerson && (
            <div style={{ fontSize: '0.76rem', color: COLOR.steel, marginBottom: '0.9rem' }}>
              這陣子最活躍：<span style={{ color: COLOR.amber, fontWeight: 600 }}>{data.metrics.mostActivePerson.name}</span>
              <span style={{ color: COLOR.steelDim }}>（{data.metrics.mostActivePerson.eventCount} 個事件）</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => { window.location.hash = 'graph' }}
            style={{
              width: '100%', padding: '0.7rem', borderRadius: '5px', cursor: 'pointer', fontFamily: FONT.mono, fontSize: '0.74rem', letterSpacing: '0.06em',
              background: 'rgba(245,166,35,0.08)', border: `1px solid ${COLOR.amberDim}`, color: COLOR.amber,
            }}
          >展開完整關係宇宙 →</button>
          <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, marginTop: '0.6rem', textAlign: 'right' }}>
            {data.computedAt ? formatMinutesAgo(data.computedAt) : ''}
          </div>
        </>
      )}
    </SubPanel>
  )
}

// ─────────────────────────────────────────────
// L1~L5 知識萃取管線 — 互動式數據流向圖（2026-09-20 起）。節點座標/連線
// 是手排的固定版面（不是力導向佈局）——只有 8 個節點、拓撲永遠不變，犯不
// 著為這種規模上一套通用的圖佈局引擎。腳本路徑/排程/職責描述是 HERMES
// 在控制頻道回覆的靜態規格（2026-09-20），只有各層目前的健康狀態
// （health/lastRun/processed 等）是即時抓的；靜態規格改版時要手動更新這
// 份表，HERMES 那邊沒有 API 可以讓前端自己查規格。
// ─────────────────────────────────────────────
type PipelineNodeId = 'diary' | 'raw' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'store'

interface PipelineNodeMeta {
  id: PipelineNodeId
  label: string
  sub: string
  description: string
  script?: string
  schedule?: string
  monitored: boolean
}

const PIPELINE_NODES: Record<PipelineNodeId, PipelineNodeMeta> = {
  diary: {
    id: 'diary', label: '日記', sub: '人工輸入', monitored: false,
    description: '每天寫進日記檔案的內容（人類編輯區 + AI 處理區），是整條管線唯一的人工輸入來源。',
  },
  raw: {
    id: 'raw', label: 'RAW 原始檔', sub: 'RAW_INTAKE 資料夾', monitored: false,
    description: 'PDF、名片、掃描件等原始檔案，丟進 RAW_INTAKE 資料夾等待 L4 掃描辨識。',
  },
  L1: {
    id: 'L1', label: 'L1 快掃', sub: '10:30 / 16:30 / 20:30', monitored: true,
    script: 'l1-agent-wrapper.py', schedule: '每天 3 班：10:30 / 16:30 / 20:30',
    description: '讀日記增量（上次「已處理」marker 之後的內容），萃取候選事件；同一班也萃取社交互動寫進 social_interactions.jsonl。',
  },
  L4: {
    id: 'L4', label: 'L4 原始檔', sub: '11:35 / 17:15', monitored: true,
    script: 'l4-agent-wrapper.py', schedule: '每天 2 班：11:35 / 17:15',
    description: '掃描 RAW_INTAKE 資料夾，OCR 辨識 PDF／名片／掃描件，萃取候選事件，格式跟 L1 輸出一致。',
  },
  L2: {
    id: 'L2', label: 'L2 正規化', sub: '12:00 / 21:15', monitored: true,
    script: 'l2-agent-wrapper.py', schedule: '每天 2 班：12:00（Pass 1 快建）／ 21:15（Pass 2 精修）',
    description: '先同步 Vikunja 任務評論進日記，再做人名消歧＋事件合併判斷，把 L1／L4 的候選事件整理成正規化格式。',
  },
  L3: {
    id: 'L3', label: 'L3 落地', sub: '22:40', monitored: true,
    script: 'l3-agent-wrapper.py', schedule: '每天 1 班：22:40',
    description: '唯一有權寫入 Events/People 正式檔的一層：落地成正式事件檔、同步建立/更新人物檔，並做關聯補鏈（人物骨架、雙向回填、Cases 時序、alias 併檔、人↔人關係）。',
  },
  store: {
    id: 'store', label: 'Events / People / Cases', sub: '正式檔・唯一真相來源', monitored: false,
    description: 'HERMES 知識庫的正式資料——事人物三實體 + 案件脈絡層。Aiportal 的事人物關係網路圖與各項指標全部從這裡反推，不是另外存一份。',
  },
  L5: {
    id: 'L5', label: 'L5 洞察', sub: '00:00', monitored: true,
    script: 'l5-agent-wrapper.py', schedule: '每天 1 班：00:00',
    description: '讀取 Events/People/Cases，推導人物脈絡／案件脈絡／跨維度洞察，寫回各檔案的「🧠」區塊——是唯一「回頭寫」正式檔的層，但只動 🧠 區塊，不動其他層已經落地的內容。',
  },
}

const PIPELINE_NODE_POS: Record<PipelineNodeId, { x: number; y: number; w: number; h: number }> = {
  diary: { x: 6, y: 48, w: 116, h: 56 },
  raw: { x: 6, y: 196, w: 116, h: 56 },
  L1: { x: 176, y: 48, w: 136, h: 56 },
  L4: { x: 176, y: 196, w: 136, h: 56 },
  L2: { x: 360, y: 122, w: 136, h: 56 },
  L3: { x: 544, y: 122, w: 136, h: 56 },
  store: { x: 728, y: 48, w: 146, h: 56 },
  L5: { x: 728, y: 196, w: 146, h: 56 },
}
const PIPELINE_VIEW_W = 880
const PIPELINE_VIEW_H = 270

function pipelineNodeCenter(id: PipelineNodeId) {
  const p = PIPELINE_NODE_POS[id]
  return { x: p.x + p.w / 2, y: p.y + p.h / 2 }
}

interface PipelineEdge { path: string; label?: string; labelAt?: { x: number; y: number }; feedback?: boolean }

// 座標手排，理由同上——連線起訖點是照節點實際外框邊界算的固定值，store↔L5
// 之間的讀取／寫回是兩條平行的垂直線（x 各偏移 8px），不是同一條線雙向畫，
// 避免箭頭疊在一起看不出方向。
const PIPELINE_EDGES: PipelineEdge[] = [
  { path: 'M122,76 L176,76' },
  { path: 'M122,224 L176,224' },
  { path: 'M312,76 L360,150', label: 'candidates', labelAt: { x: 322, y: 100 } },
  { path: 'M312,224 L360,150', label: 'candidates', labelAt: { x: 322, y: 204 } },
  { path: 'M496,150 L544,150', label: 'normalized', labelAt: { x: 500, y: 140 } },
  { path: 'M680,150 L728,84', label: '寫入', labelAt: { x: 674, y: 110 } },
  { path: 'M793,104 L793,196', label: '讀取', labelAt: { x: 760, y: 152 } },
  { path: 'M809,196 L809,104', label: '寫回 🧠', labelAt: { x: 812, y: 152 }, feedback: true },
]

function pipelineHealthColor(health: HermesPipelineHealth | undefined): string {
  if (health === 'ok') return COLOR.ok
  if (health === 'crit') return COLOR.crit
  return COLOR.steelDim
}
function pipelineHealthLabel(health: HermesPipelineHealth | undefined): string {
  if (health === 'ok') return '正常'
  if (health === 'crit') return '異常 / 逾時未執行'
  return '尚無資料'
}

function PipelineDetailCard({ meta, layer }: { meta: PipelineNodeMeta; layer: HermesPipelineLayerData | null }) {
  return (
    <div style={{ background: COLOR.panelDeep, border: `1px solid ${COLOR.line}`, borderRadius: '5px', padding: '0.9rem 1rem', marginTop: '0.8rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.4rem' }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: COLOR.ink }}>{meta.label}</span>
        {layer && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontFamily: FONT.mono, fontSize: '0.62rem', color: pipelineHealthColor(layer.health) }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: pipelineHealthColor(layer.health) }} />
            {pipelineHealthLabel(layer.health)}
          </span>
        )}
      </div>
      <div style={{ fontSize: '0.74rem', color: COLOR.steel, lineHeight: 1.6, marginBottom: meta.monitored ? '0.7rem' : 0 }}>{meta.description}</div>
      {meta.script && (
        <div style={{ fontFamily: FONT.mono, fontSize: '0.64rem', color: COLOR.steelDim, marginBottom: '2px' }}>
          腳本：<span style={{ color: COLOR.steel }}>{meta.script}</span>　排程：<span style={{ color: COLOR.steel }}>{meta.schedule}</span>
        </div>
      )}
      {meta.monitored && (
        layer === null ? (
          <div style={{ fontSize: '0.68rem', color: COLOR.steelDim, marginTop: '0.5rem' }}>尚無 heartbeat 資料</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(76px, 1fr))', gap: '1px', background: COLOR.line, border: `1px solid ${COLOR.line}`, borderRadius: '5px', overflow: 'hidden', marginTop: '0.6rem' }}>
              <StatCell label="最近執行" value={layer.lastRunTs !== null ? formatMinutesAgo(new Date(layer.lastRunTs).toISOString()) : (layer.lastRun ?? '—')} />
              <StatCell label="已處理" value={layer.processed !== null ? String(layer.processed) : '—'} />
              <StatCell label="已入庫" value={layer.committed !== null ? String(layer.committed) : '—'} />
              <StatCell label="失敗" value={layer.failed !== null ? String(layer.failed) : '—'} valueColor={layer.failed ? COLOR.crit : undefined} />
              <StatCell label="待處理" value={layer.backlog !== null ? String(layer.backlog) : '—'} />
            </div>
            {layer.errorSummary && (
              <div style={{ fontSize: '0.68rem', color: COLOR.crit, marginTop: '0.6rem', lineHeight: 1.5 }}>⚠ {layer.errorSummary}</div>
            )}
          </>
        )
      )}
    </div>
  )
}

function HermesPipelineFlowDiagram({ data }: { data: HermesPipelineData | null }) {
  const [selected, setSelected] = useState<PipelineNodeId>('L1')
  const layers = data?.available ? data.layers : null

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <svg
          viewBox={`0 0 ${PIPELINE_VIEW_W} ${PIPELINE_VIEW_H}`}
          width="100%" height={PIPELINE_VIEW_H}
          style={{ display: 'block', minWidth: '640px' }}
        >
          <defs>
            <marker id="pipeline-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={COLOR.steelDim} />
            </marker>
            <marker id="pipeline-arrow-amber" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={COLOR.amberDim} />
            </marker>
          </defs>

          {PIPELINE_EDGES.map((e, i) => (
            <g key={i}>
              <path
                d={e.path} fill="none" stroke={e.feedback ? COLOR.amberDim : COLOR.steelDim} strokeWidth={1.3}
                strokeDasharray={e.feedback ? '4 3' : undefined}
                markerEnd={`url(#${e.feedback ? 'pipeline-arrow-amber' : 'pipeline-arrow'})`}
              />
              {e.label && e.labelAt && (
                <text x={e.labelAt.x} y={e.labelAt.y} fontFamily={FONT.mono} fontSize={8.5} fill={e.feedback ? COLOR.amberDim : COLOR.steelDim}>{e.label}</text>
              )}
            </g>
          ))}

          {(Object.keys(PIPELINE_NODE_POS) as PipelineNodeId[]).map(id => {
            const pos = PIPELINE_NODE_POS[id]
            const meta = PIPELINE_NODES[id]
            const layer = layers ? layers[id as 'L1' | 'L2' | 'L3' | 'L4' | 'L5'] : null
            const isSelected = selected === id
            return (
              <g key={id} onClick={() => setSelected(id)} style={{ cursor: 'pointer' }}>
                <rect
                  x={pos.x} y={pos.y} width={pos.w} height={pos.h} rx={6}
                  fill={isSelected ? 'rgba(245,166,35,0.08)' : COLOR.panelRaised}
                  stroke={isSelected ? COLOR.amberDim : COLOR.line} strokeWidth={isSelected ? 1.6 : 1}
                />
                <text x={pos.x + 10} y={pos.y + 23} fontFamily={FONT.body} fontSize={12} fontWeight={600} fill={COLOR.ink}>{meta.label}</text>
                <text x={pos.x + 10} y={pos.y + 39} fontFamily={FONT.mono} fontSize={9} fill={COLOR.steelDim}>{meta.sub}</text>
                {meta.monitored && (
                  <circle cx={pos.x + pos.w - 11} cy={pos.y + 11} r={4.5} fill={pipelineHealthColor(layer?.health)} />
                )}
              </g>
            )
          })}
        </svg>
      </div>

      <div style={{ display: 'flex', gap: '14px', fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim, marginTop: '0.5rem', flexWrap: 'wrap' }}>
        <span><span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: COLOR.ok, marginRight: '4px' }} />正常</span>
        <span><span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: COLOR.crit, marginRight: '4px' }} />異常／逾時未執行</span>
        <span><span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: COLOR.steelDim, marginRight: '4px' }} />尚無資料</span>
        <span style={{ flex: 1 }} />
        <span>點節點看詳情</span>
      </div>

      <PipelineDetailCard
        meta={PIPELINE_NODES[selected]}
        layer={layers && PIPELINE_NODES[selected].monitored ? layers[selected as 'L1' | 'L2' | 'L3' | 'L4' | 'L5'] : null}
      />
    </div>
  )
}

// 近 N 天每層健康狀態的色條（不是折線圖——health 是類別值 ok/crit/
// unknown，不是連續數字，折線圖沒有意義）。懶載入：點「近 14 天歷史」才
// fetch，跟其他歷史面板同一個節流考量。
function PipelineHistoryStrip({ unlockedPassword }: { unlockedPassword: string | null }) {
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<HermesPipelineHistoryPoint[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!open || !unlockedPassword || history !== null) return
    apiFetchHermesPipelineHistory(unlockedPassword)
      .then(setHistory)
      .catch(() => setError(true))
  }, [open, unlockedPassword, history])

  return (
    <div style={{ marginTop: '0.7rem' }}>
      <FormulaToggle expanded={open} onToggle={() => setOpen(x => !x)} labelCollapsed="近 14 天歷史 ▼" labelExpanded="收起 ▲" />
      {open && (
        error ? (
          <div style={{ fontSize: '0.68rem', color: COLOR.steelDim, marginTop: '0.5rem' }}>暫時無法取得資料</div>
        ) : history === null ? (
          <div style={{ fontSize: '0.68rem', color: COLOR.steelDim, marginTop: '0.5rem' }}>載入中…</div>
        ) : history.length === 0 ? (
          <div style={{ fontSize: '0.68rem', color: COLOR.steelDim, marginTop: '0.5rem' }}>還沒有歷史資料</div>
        ) : (
          <div style={{ marginTop: '0.6rem' }}>
            {(['L1', 'L2', 'L3', 'L4', 'L5'] as const).map(layer => (
              <div key={layer} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, width: '18px', flexShrink: 0 }}>{layer}</span>
                <div style={{ display: 'flex', gap: '2px' }}>
                  {history.map(h => {
                    const health = h[layer]
                    const color = health ? pipelineHealthColor(health) : COLOR.line
                    return (
                      <span
                        key={h.date}
                        title={`${h.date}：${health ? pipelineHealthLabel(health) : '尚無資料'}`}
                        style={{ width: '10px', height: '10px', borderRadius: '2px', background: color, display: 'inline-block' }}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: FONT.mono, fontSize: '0.58rem', color: COLOR.steelDim, marginTop: '4px' }}>
              <span>{history[0]?.date}</span>
              <span>{history[history.length - 1]?.date}</span>
            </div>
          </div>
        )
      )}
    </div>
  )
}

function HermesPipelinePanel({ unlockedPassword }: { unlockedPassword: string | null }) {
  const [data, setData] = useState<HermesPipelineData | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!unlockedPassword) return
    let cancelled = false
    apiFetchHermesPipeline(unlockedPassword)
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [unlockedPassword])

  const hasAlert = !!data?.available && (['L1', 'L2', 'L3', 'L4', 'L5'] as const).some(id => data.layers[id].health === 'crit')

  return (
    <CollapsibleSubPanel title="知識萃取管線（L1~L5）" sub="日記 → 知識：數據流向與即時健康狀態" hasAlert={hasAlert}>
      {error ? (
        <div style={{ fontSize: '0.72rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>暫時無法取得資料</div>
      ) : data === null ? (
        <div style={{ fontSize: '0.72rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>載入中…</div>
      ) : (
        <>
          {!data.available && (
            <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, marginBottom: '0.6rem' }}>尚無 heartbeat 資料，collect.ps1 還沒讀到 HERMES 主機上的 heartbeat.json——下方是管線架構圖，節點暫時顯示「尚無資料」</div>
          )}
          <HermesPipelineFlowDiagram data={data} />
          <PipelineHistoryStrip unlockedPassword={unlockedPassword} />
          {data.computedAt && (
            <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, marginTop: '0.6rem', textAlign: 'right' }}>{formatMinutesAgo(data.computedAt)}</div>
          )}
        </>
      )}
    </CollapsibleSubPanel>
  )
}

const TASK_RUNNING_RESULT = 267009 // 0x41301 SCHED_S_TASK_RUNNING
const TASK_NOT_YET_RUN_RESULT = 267011 // 0x41303 SCHED_S_TASK_HAS_NOT_RUN

// 抽出來給收合面板標題的紅點判斷共用，跟 HermesTaskRow 內部畫每一列圖示用
// 的同一套判斷邏輯，不要兩處各寫一次、以後改一邊忘記改另一邊。
function isTaskFailed(t: HermesScheduledTaskInfo): boolean {
  const isRunning = t.lastTaskResult === TASK_RUNNING_RESULT
  const isPending = t.lastTaskResult === TASK_NOT_YET_RUN_RESULT
  return t.lastTaskResult !== null && !isRunning && !isPending && t.lastTaskResult !== 0
}

// 同理，容器「異常」的判斷也抽出來給紅點跟容器健康統計格共用。只需要
// status/health 兩個欄位，用 Pick 而不是整個 HermesContainerInfo，呼叫端
// 不用為了型別硬塞不相干的欄位（例如 HermesContainerRow 沒有 project）。
function isContainerFailed(c: Pick<HermesContainerInfo, 'status' | 'health'>): boolean {
  return !/up/i.test(c.status) || c.health === 'unhealthy'
}

function HermesTaskRow({ name, lastRunTime, lastTaskResult }: HermesScheduledTaskInfo) {
  const isRunning = lastTaskResult === TASK_RUNNING_RESULT
  const isPending = lastTaskResult === TASK_NOT_YET_RUN_RESULT
  const isFailed = isTaskFailed({ name, lastRunTime, lastTaskResult })
  const dotClass = isRunning ? 'dot-run' : isFailed ? 'dot-warn' : 'dot-ok'
  const statusSuffix = isRunning ? ' · 執行中' : isPending ? ' · 尚未觸發過' : isFailed ? ` · 失敗 (${lastTaskResult})` : ''
  return (
    <div className="list-item" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0.5rem 0.1rem', fontFamily: FONT.mono, fontSize: '0.72rem', borderTop: `1px solid ${COLOR.line}` }}>
      <span className={`dot ${dotClass}`} />
      <span style={{ color: COLOR.ink, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <span style={{ color: COLOR.steelDim, fontSize: '0.64rem', flexShrink: 0 }}>
        {lastRunTime ? formatMinutesAgo(lastRunTime) : '尚未執行'}{statusSuffix}
      </span>
    </div>
  )
}

function HermesActivityRow({ occurredAt, source, message }: HermesActivityEntry) {
  return (
    <div className="list-item" style={{ display: 'flex', alignItems: 'baseline', gap: '10px', padding: '0.5rem 0.1rem', fontFamily: FONT.mono, fontSize: '0.72rem', borderTop: `1px solid ${COLOR.line}` }}>
      <span style={{ color: COLOR.ink, flex: 1, minWidth: 0 }}>
        <span style={{ color: COLOR.amber, fontWeight: 600 }}>{source}</span> {message}
      </span>
      <span style={{ color: COLOR.steelDim, fontSize: '0.64rem', flexShrink: 0 }}>{formatMinutesAgo(occurredAt)}</span>
    </div>
  )
}

function HermesContainerRow({ name, status, health }: HermesContainerInfo) {
  const dotClass = isContainerFailed({ status, health }) ? 'dot-warn' : 'dot-ok'
  return (
    <div className="list-item" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0.5rem 0.1rem', fontFamily: FONT.mono, fontSize: '0.72rem', borderTop: `1px solid ${COLOR.line}` }}>
      <span className={`dot ${dotClass}`} />
      <span style={{ color: COLOR.ink, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <span style={{ color: COLOR.steelDim, fontSize: '0.64rem', flexShrink: 0 }}>{status}{health ? ` · ${health}` : ''}</span>
    </div>
  )
}

// 近期趨勢：CPU/記憶體/容器健康比例的每日快照折線圖，複用既有的
// TrendLineChart（跟幸福指數 30 天趨勢同一顆元件）。懶載入——這個
// CollapsibleSubPanel 預設收起，子元件要展開才會掛載、才會發這支請求，跟
// 幸福指數卡片「詳細數據展開才 fetch history」同一個節流考量。
function HermesTrendPanel({ unlockedPassword }: { unlockedPassword: string | null }) {
  const [history, setHistory] = useState<HermesStatusHistoryPoint[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!unlockedPassword) return
    let cancelled = false
    apiFetchHermesStatusHistory(unlockedPassword)
      .then(d => { if (!cancelled) setHistory(d) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [unlockedPassword])

  if (error) return <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>暫時無法取得資料</div>
  if (history === null) return <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>載入中…</div>
  if (history.length < 2) return <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>還沒有足夠的歷史資料（每天累積一筆，過幾天回來看就有線了）</div>

  const cpuPoints = history.filter((h): h is HermesStatusHistoryPoint & { cpuPercent: number } => h.cpuPercent !== null).map(h => ({ date: h.date, value: Math.round(h.cpuPercent) }))
  const memPoints = history.filter((h): h is HermesStatusHistoryPoint & { memPercent: number } => h.memPercent !== null).map(h => ({ date: h.date, value: Math.round(h.memPercent) }))
  const healthPoints = history
    .filter((h): h is HermesStatusHistoryPoint & { containersHealthy: number; containersTotal: number } => h.containersTotal !== null && h.containersTotal > 0 && h.containersHealthy !== null)
    .map(h => ({ date: h.date, value: Math.round((h.containersHealthy / h.containersTotal) * 100) }))

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem 1.4rem' }}>
      <div>
        <SubLabel>CPU 負載</SubLabel>
        <TrendLineChart points={cpuPoints} color={COLOR.amber} height={64} />
      </div>
      <div>
        <SubLabel>記憶體</SubLabel>
        <TrendLineChart points={memPoints} color={COLOR.amber} height={64} />
      </div>
      <div>
        <SubLabel>容器健康比例（%）</SubLabel>
        <TrendLineChart points={healthPoints} color={COLOR.ok} height={64} />
      </div>
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
      <div onClick={onRequestUnlock} style={{ cursor: 'pointer', padding: '1rem 0.2rem' }}>
        <div style={{ fontFamily: FONT.mono, fontSize: '0.7rem', color: COLOR.warn }}>🔒 解鎖後顯示</div>
      </div>
    )
  }

  const availableStatus: HermesStatusData | null = !statusError && status && status.available ? status : null

  return (
    <div>
      <HermesEventGraphPanel unlockedPassword={unlockedPassword} />

      <div style={{ marginTop: '0.9rem' }}>
        <HermesPipelinePanel unlockedPassword={unlockedPassword} />
      </div>

      <div style={{ marginTop: '0.9rem' }}>
      {availableStatus === null ? (
        <div style={{ fontSize: '0.72rem', color: COLOR.steelDim, padding: '1rem 0.2rem' }}>
          {statusError ? 'HERMES 戰情室：暫時無法取得資料' : 'HERMES 戰情室：尚無資料，collect.ps1 還沒在主機上跑過'}
        </div>
      ) : (
        <div style={{ opacity: availableStatus.stale ? 0.55 : 1, filter: availableStatus.stale ? 'saturate(0.5)' : undefined }}>
          {(() => {
            const worstDisk = availableStatus.disks.reduce<HermesDiskInfo | null>(
              (worst, d) => (!worst || d.percentUsed > worst.percentUsed ? d : worst), null,
            )
            const containersOk = availableStatus.containers.filter(c => !isContainerFailed(c)).length
            return (
              <div className="ip-stat-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: COLOR.line, border: `1px solid ${COLOR.line}`, borderRadius: '5px', overflow: 'hidden', marginBottom: '0.9rem' }}>
                <StatCell label="CPU 負載" value={availableStatus.cpuPercent !== null ? `${Math.round(availableStatus.cpuPercent)}%` : '—'} valueColor={pctTone(availableStatus.cpuPercent)} />
                <StatCell label="記憶體" value={availableStatus.memPercent !== null ? `${Math.round(availableStatus.memPercent)}%` : '—'} valueColor={pctTone(availableStatus.memPercent)} />
                <StatCell
                  label={worstDisk ? `磁碟 ${worstDisk.drive}` : '磁碟'}
                  value={worstDisk ? `${Math.round(worstDisk.percentUsed)}%` : '—'}
                  sub={worstDisk ? `剩餘 ${formatGb(worstDisk.freeGb)}` : undefined}
                  valueColor={worstDisk ? pctTone(worstDisk.percentUsed) : undefined}
                />
                <StatCell
                  label="容器健康"
                  value={`${containersOk} / ${availableStatus.containers.length}`}
                  sub={availableStatus.containers.length > 0 && containersOk < availableStatus.containers.length ? '有容器異常' : undefined}
                  valueColor={containersOk < availableStatus.containers.length ? COLOR.warn : COLOR.ok}
                />
              </div>
            )
          })()}

          <div className="ip-board-cols" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.9rem' }}>
            <CollapsibleSubPanel
              title="排程任務狀態" sub="Windows Task Scheduler · 最近執行"
              hasAlert={availableStatus.scheduledTasks.some(isTaskFailed)}
            >
              {availableStatus.scheduledTasks.length === 0
                ? <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>尚無排程任務資料</div>
                : availableStatus.scheduledTasks.map(t => <HermesTaskRow key={t.name} {...t} />)}
            </CollapsibleSubPanel>
            <CollapsibleSubPanel title="近期活動" sub="部署 / 備份紀錄">
              {activityError
                ? <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>活動紀錄讀取失敗</div>
                : activity === null
                  ? <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>載入中…</div>
                  : activity.length === 0
                    ? <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>尚無活動紀錄</div>
                    : activity.map(a => <HermesActivityRow key={a.id} {...a} />)}
            </CollapsibleSubPanel>
          </div>

          <div style={{ marginTop: '0.9rem' }}>
            <CollapsibleSubPanel
              title="容器清單" sub="Docker · 目前執行狀態"
              hasAlert={availableStatus.containers.some(isContainerFailed)}
            >
              {availableStatus.containers.length === 0
                ? <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>尚無容器資料</div>
                : availableStatus.containers.map(c => <HermesContainerRow key={c.name} {...c} />)}
            </CollapsibleSubPanel>
          </div>

          <div style={{ marginTop: '0.9rem' }}>
            <CollapsibleSubPanel title="近期趨勢" sub="CPU / 記憶體 / 容器健康 · 每日快照">
              <HermesTrendPanel unlockedPassword={unlockedPassword} />
            </CollapsibleSubPanel>
          </div>

          <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim, marginTop: '0.7rem', textAlign: 'right' }}>
            {availableStatus.computedAt ? formatMinutesAgo(availableStatus.computedAt) : ''}
            {availableStatus.stale ? <span style={{ color: COLOR.warn, marginLeft: '8px' }}>· 資料已超過 30 分鐘未更新</span> : null}
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// 工具連結 — private plain-link sites (no dashboard summary) merged with all
// public sites into one searchable, collapsible control panel.
// ─────────────────────────────────────────────
function SwitchTile({ site, unlocked, onSelect }: { site: SiteData; unlocked: boolean; onSelect: (site: SiteData) => void }) {
  const isLocked = site.isPrivate && !unlocked
  return (
    <div
      onClick={() => onSelect(site)}
      style={{
        position: 'relative', background: COLOR.panelRaised, border: `1px solid ${COLOR.line}`, borderRadius: '5px',
        padding: '0.8rem 0.9rem', display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer',
      }}
    >
      <span style={{
        width: '24px', height: '13px', borderRadius: '7px', background: COLOR.panelDeep, border: `1px solid ${COLOR.lineBright}`,
        position: 'relative', flexShrink: 0,
      }}>
        <span style={{
          position: 'absolute', top: '1px', width: '9px', height: '9px', borderRadius: '50%',
          background: isLocked ? COLOR.steelDim : (site.isPrivate ? COLOR.amber : COLOR.ok),
          boxShadow: isLocked ? 'none' : `0 0 5px ${site.isPrivate ? COLOR.amber : COLOR.ok}`,
          left: isLocked ? '1px' : '10px', transition: 'left 0.15s',
        }} />
      </span>
      <span style={{ fontFamily: FONT.mono, fontSize: '0.76rem', color: COLOR.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {isLocked && '🔒 '}{site.name}
      </span>
    </div>
  )
}

function ToolLinksZone({
  privateSites,
  publicSites,
  unlocked,
  onSelect,
}: {
  privateSites: SiteData[]
  publicSites: SiteData[]
  unlocked: boolean
  onSelect: (site: SiteData) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const searchActive = q.length > 0
  const matches = (s: SiteData) => !searchActive || s.name.toLowerCase().includes(q) || s.subtitle.toLowerCase().includes(q)
  const filteredPrivate = privateSites.filter(matches)
  const filteredPublic = publicSites.filter(matches)
  const total = privateSites.length + publicSites.length
  const totalMatched = filteredPrivate.length + filteredPublic.length
  const isOpen = open || searchActive

  return (
    <Unit code="04" title="工具連結 · Control Panel">
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '1rem', marginTop: '-0.4rem' }}
      >
        <span style={{ display: 'inline-block', transition: 'transform 0.2s ease', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', color: COLOR.amberDim, fontSize: '0.8rem' }}>▶</span>
        <span style={{ fontSize: '0.78rem', color: COLOR.steel }}>{isOpen ? '收起連結列表' : '展開連結列表'}</span>
        <span style={{ fontFamily: FONT.mono, fontSize: '0.68rem', color: COLOR.steelDim }}>{searchActive ? `${totalMatched} / ${total}` : `${total} 個`}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', background: COLOR.panelDeep, border: `1px solid ${COLOR.line}`, borderRadius: '4px', padding: '0.55rem 0.9rem', marginBottom: '1.1rem' }}>
        <span style={{ color: COLOR.amber, fontFamily: FONT.mono, fontSize: '0.85rem' }}>◎</span>
        <input
          type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋工具名稱…" autoComplete="off"
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: COLOR.amber, fontFamily: FONT.mono, fontSize: '0.9rem' }}
        />
      </div>

      {isOpen && (
        <>
          {filteredPrivate.length > 0 && (
            <div style={{ marginBottom: '1.1rem' }}>
              <SubLabel>私領域</SubLabel>
              <div className="ip-switch-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.7rem' }}>
                {filteredPrivate.map(s => <SwitchTile key={s.id} site={s} unlocked={unlocked} onSelect={onSelect} />)}
              </div>
            </div>
          )}
          {filteredPublic.length > 0 && (
            <div>
              <SubLabel>公領域</SubLabel>
              <div className="ip-switch-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.7rem' }}>
                {filteredPublic.map(s => <SwitchTile key={s.id} site={s} unlocked={unlocked} onSelect={onSelect} />)}
              </div>
            </div>
          )}
          {searchActive && totalMatched === 0 && (
            <div style={{ textAlign: 'center', color: COLOR.steelDim, fontSize: '0.75rem', padding: '1.5rem 0' }}>找不到符合「{query}」的工具</div>
          )}
          {!searchActive && total === 0 && (
            <div style={{ textAlign: 'center', color: COLOR.steelDim, fontSize: '0.75rem', padding: '1.5rem 0' }}>No Data</div>
          )}
        </>
      )}
    </Unit>
  )
}

// ─────────────────────────────────────────────
// Password / Admin dialogs — same structure/logic as before, restyled to
// the instrument-panel palette.
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
    const token = await apiVerifyPassword(input)
    setLoading(false)
    if (token) {
      localStorage.setItem(UNLOCK_KEY, token)
      if (pendingUrl) window.open(pendingUrl, '_blank', 'noopener,noreferrer')
      onSuccess(token)
    } else {
      setError('密碼錯誤，請再試一次')
      setInput('')
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,11,14,0.82)' }}
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div style={{ background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: '8px', padding: '2.2rem 2.4rem', width: '340px', color: COLOR.ink, fontFamily: FONT.body, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
        <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.amberDim, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '14px' }}>🔒 私領域網站</div>
        <div style={{ fontSize: '1.15rem', fontWeight: 600, marginBottom: '8px' }}>輸入密碼</div>
        <div style={{ fontSize: '0.75rem', color: COLOR.steelDim, marginBottom: '1.6rem', lineHeight: 1.6 }}>此為私領域網站，請輸入密碼以繼續。<br />本裝置驗證後將不再詢問。</div>
        <form onSubmit={e => { void handleSubmit(e) }}>
          <input
            type="password" value={input} autoFocus placeholder="••••••" disabled={loading}
            onChange={e => { setInput(e.target.value); setError('') }}
            style={{
              width: '100%', padding: '0.7rem 0.9rem', background: COLOR.panelDeep,
              border: `1px solid ${error ? COLOR.crit : COLOR.line}`, borderRadius: '5px', color: COLOR.ink,
              fontSize: '0.9rem', fontFamily: FONT.mono, outline: 'none', boxSizing: 'border-box', letterSpacing: '0.18em',
            }}
          />
          {error && <div style={{ fontSize: '0.72rem', color: COLOR.crit, marginTop: '8px' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
            <button type="button" onClick={onCancel} style={{ flex: 1, padding: '0.65rem', background: 'transparent', border: `1px solid ${COLOR.line}`, borderRadius: '5px', color: COLOR.steel, fontSize: '0.78rem', cursor: 'pointer', fontFamily: FONT.body }}>取消</button>
            <button type="submit" disabled={loading} style={{ flex: 2, padding: '0.65rem', background: 'rgba(245,166,35,0.1)', border: `1px solid ${COLOR.amberDim}`, borderRadius: '5px', color: COLOR.amber, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body, opacity: loading ? 0.6 : 1 }}>
              {loading ? '驗證中…' : '確認進入'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const inputSt: React.CSSProperties = {
  padding: '0.55rem 0.7rem', background: COLOR.panelDeep, border: `1px solid ${COLOR.line}`, borderRadius: '4px',
  color: COLOR.ink, fontSize: '0.8rem', fontFamily: FONT.body, outline: 'none', boxSizing: 'border-box', width: '100%',
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ fontSize: '0.68rem', color: COLOR.steelDim, letterSpacing: '0.08em', marginBottom: '6px' }}>{label}</div>
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
  const [exporting, setExporting] = useState(false)

  // 個人資料備份——HHI/心智/社交/生活從容歷史 + 工具連結清單一鍵下載成
  // JSON，自架 DB 之外留一份可攜複本。放在管理後台而不是隨處可見的按
  // 鈕，因為這是維護性質的動作，跟站點 CRUD 同一個心智模型。
  const handleExport = async () => {
    setExporting(true)
    setApiError('')
    try {
      const blob = await apiExportData(adminPassword)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `aiportal-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setApiError('匯出失敗，請再試一次')
    } finally {
      setExporting(false)
    }
  }

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
        // worldXZ used to place a landmark in the (now removed) 3D city view
        // — no visual meaning left, but portal_sites still has the column,
        // so a constant placeholder satisfies the schema without carrying
        // over the old position-pool logic.
        await onAdd({ name: form.name.trim(), subtitle: form.subtitle.trim(), links, worldXZ: [0, 0], isPrivate: form.isPrivate, subsystemId })
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 8888, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,11,14,0.9)' }}>
      <div style={{ width: '680px', maxWidth: '95vw', maxHeight: '88vh', overflowY: 'auto', background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: '8px', padding: '1.8rem 2rem', color: COLOR.ink, fontFamily: FONT.body }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.6rem' }}>
          <div>
            <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.amberDim, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '6px' }}>⚙ 管理後台</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>網站管理</div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => { void handleExport() }} disabled={exporting}
              style={{ background: 'transparent', border: `1px solid ${COLOR.amberDim}`, borderRadius: '4px', color: COLOR.amber, padding: '0.4rem 1rem', cursor: exporting ? 'default' : 'pointer', fontSize: '0.78rem', fontFamily: FONT.body, opacity: exporting ? 0.6 : 1 }}
            >{exporting ? '匯出中…' : '匯出資料 ⤓'}</button>
            <button onClick={onClose} style={{ background: 'transparent', border: `1px solid ${COLOR.line}`, borderRadius: '4px', color: COLOR.steel, padding: '0.4rem 1rem', cursor: 'pointer', fontSize: '0.78rem', fontFamily: FONT.body }}>關閉</button>
          </div>
        </div>

        {apiError && (
          <div style={{ marginBottom: '14px', padding: '0.6rem 0.8rem', background: 'rgba(226,88,79,0.1)', border: `1px solid ${COLOR.crit}`, borderRadius: '4px', fontSize: '0.72rem', color: COLOR.crit }}>{apiError}</div>
        )}

        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
          <div style={{ fontSize: '0.68rem', color: COLOR.steel, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: COLOR.ok, display: 'inline-block' }} /> 公領域
          </div>
          <div style={{ fontSize: '0.68rem', color: COLOR.amberDim, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: COLOR.amber, display: 'inline-block' }} /> 私領域
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
          {sites.map(s => (
            <div key={s.id}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '12px', padding: '0.7rem 1rem',
                background: editing?.id === s.id ? COLOR.panelRaised2 : COLOR.panelRaised,
                border: `1px solid ${editing?.id === s.id ? COLOR.lineBright : COLOR.line}`,
                borderRadius: confirmDelete === s.id ? '5px 5px 0 0' : '5px',
              }}>
                <span style={{
                  fontSize: '0.62rem', padding: '2px 7px', borderRadius: '3px', whiteSpace: 'nowrap',
                  background: s.isPrivate ? 'rgba(245,166,35,0.12)' : 'rgba(95,191,122,0.12)',
                  color: s.isPrivate ? COLOR.amber : COLOR.ok,
                  border: `1px solid ${s.isPrivate ? COLOR.amberDim : COLOR.ok}`,
                }}>{s.isPrivate ? '私' : '公'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 500, color: COLOR.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                  <div style={{ fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.steelDim, marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.links[0]?.url}</div>
                </div>
                <button onClick={() => openEdit(s)} disabled={busy} style={{ padding: '0.35rem 0.7rem', background: 'rgba(154,164,182,0.08)', border: `1px solid ${COLOR.line}`, borderRadius: '4px', color: COLOR.steel, fontSize: '0.7rem', cursor: 'pointer', fontFamily: FONT.body, whiteSpace: 'nowrap' }}>編輯</button>
                <button onClick={() => setConfirmDelete(confirmDelete === s.id ? null : s.id)} disabled={busy} style={{ padding: '0.35rem 0.7rem', background: 'rgba(226,88,79,0.08)', border: `1px solid ${COLOR.crit}`, borderRadius: '4px', color: COLOR.crit, fontSize: '0.7rem', cursor: 'pointer', fontFamily: FONT.body, whiteSpace: 'nowrap' }}>刪除</button>
              </div>
              {confirmDelete === s.id && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0.6rem 1rem', background: 'rgba(226,88,79,0.06)', border: `1px solid ${COLOR.crit}`, borderTop: 'none', borderRadius: '0 0 5px 5px' }}>
                  <span style={{ flex: 1, fontSize: '0.72rem', color: COLOR.crit }}>確定刪除「{s.name}」？</span>
                  <button onClick={() => setConfirmDelete(null)} style={{ padding: '0.3rem 0.7rem', background: 'transparent', border: `1px solid ${COLOR.line}`, borderRadius: '4px', color: COLOR.steel, fontSize: '0.7rem', cursor: 'pointer', fontFamily: FONT.body }}>取消</button>
                  <button onClick={() => { void handleDelete(s.id) }} disabled={busy} style={{ padding: '0.3rem 0.7rem', background: 'rgba(226,88,79,0.16)', border: `1px solid ${COLOR.crit}`, borderRadius: '4px', color: COLOR.crit, fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body }}>確定刪除</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {!showForm && (
          <button onClick={openAdd} disabled={busy} style={{ width: '100%', padding: '0.65rem', background: 'rgba(95,191,122,0.06)', border: `1px dashed ${COLOR.ok}`, borderRadius: '5px', color: COLOR.ok, fontSize: '0.78rem', cursor: 'pointer', fontFamily: FONT.body, letterSpacing: '0.06em' }}>＋ 新增網站</button>
        )}

        {showForm && (
          <div style={{ marginTop: '12px', padding: '1.3rem 1.4rem', background: COLOR.panelRaised, border: `1px solid ${COLOR.line}`, borderRadius: '5px' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: COLOR.ink, marginBottom: '1.1rem' }}>{adding ? '新增網站' : '編輯網站'}</div>

            <FormField label="名稱"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="系統名稱" style={inputSt} /></FormField>
            <FormField label="副標題（選填）"><input value={form.subtitle} onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))} placeholder="English subtitle" style={inputSt} /></FormField>

            <FormField label="領域設定">
              <div style={{ display: 'flex', gap: '8px' }}>
                {([false, true] as const).map(priv => (
                  <button key={String(priv)} onClick={() => setForm(f => ({ ...f, isPrivate: priv }))}
                    style={{
                      padding: '0.4rem 1rem',
                      background: form.isPrivate === priv ? (priv ? 'rgba(245,166,35,0.14)' : 'rgba(95,191,122,0.12)') : COLOR.panelDeep,
                      border: `1px solid ${form.isPrivate === priv ? (priv ? COLOR.amber : COLOR.ok) : COLOR.line}`,
                      borderRadius: '4px',
                      color: form.isPrivate === priv ? (priv ? COLOR.amber : COLOR.ok) : COLOR.steelDim,
                      fontSize: '0.72rem', cursor: 'pointer', fontFamily: FONT.body,
                    }}>
                    {priv ? '🔒 私領域' : '🌐 公領域'}
                  </button>
                ))}
              </div>
            </FormField>

            <FormField label="儀表板摘要來源 ID（選填）">
              <input value={form.subsystemId ?? ''} onChange={e => setForm(f => ({ ...f, subsystemId: e.target.value }))} placeholder="例如 pf-cwh，留空則顯示為一般連結卡" style={inputSt} />
            </FormField>

            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '0.68rem', color: COLOR.steelDim, letterSpacing: '0.08em', marginBottom: '8px' }}>連結</div>
              {form.links.map((link, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <input value={link.label} onChange={e => setLink(idx, 'label', e.target.value)} placeholder="按鈕文字" style={{ ...inputSt, width: '100px', flex: '0 0 100px' }} />
                  <input value={link.url} onChange={e => setLink(idx, 'url', e.target.value)} placeholder="https://..." style={{ ...inputSt, flex: 1 }} />
                  {form.links.length > 1 && (
                    <button onClick={() => removeLink(idx)} style={{ background: 'none', border: `1px solid ${COLOR.crit}`, borderRadius: '4px', color: COLOR.crit, padding: '0 10px', cursor: 'pointer', fontSize: '1rem', fontFamily: FONT.body, flexShrink: 0 }}>×</button>
                  )}
                </div>
              ))}
              {form.links.length < 3 && (
                <button onClick={addLink} style={{ fontSize: '0.68rem', color: COLOR.steel, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', fontFamily: FONT.body, letterSpacing: '0.04em' }}>＋ 新增連結</button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button onClick={closeForm} disabled={busy} style={{ flex: 1, padding: '0.6rem', background: 'transparent', border: `1px solid ${COLOR.line}`, borderRadius: '5px', color: COLOR.steel, fontSize: '0.78rem', cursor: 'pointer', fontFamily: FONT.body }}>取消</button>
              <button onClick={() => { void handleSave() }} disabled={busy} style={{ flex: 2, padding: '0.6rem', background: 'rgba(95,191,122,0.1)', border: `1px solid ${COLOR.ok}`, borderRadius: '5px', color: COLOR.ok, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body, opacity: busy ? 0.6 : 1 }}>{busy ? '儲存中…' : '儲存'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AdminAuthModal({ onSuccess, onCancel }: { onSuccess: (pw: string) => void; onCancel: () => void }) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const token = await apiVerifyPassword(input)
    setLoading(false)
    if (token) {
      onSuccess(token)
    } else {
      setError('通行碼錯誤')
      setInput('')
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,11,14,0.82)' }}
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div style={{ background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: '8px', padding: '2rem 2.2rem', width: '320px', color: COLOR.ink, fontFamily: FONT.body }}>
        <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.amberDim, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '12px' }}>⚙ 管理後台</div>
        <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '20px' }}>輸入通行碼</div>
        <form onSubmit={e => { void handleSubmit(e) }}>
          <input type="password" value={input} autoFocus placeholder="••••••••" disabled={loading}
            onChange={e => { setInput(e.target.value); setError('') }}
            style={{ width: '100%', padding: '0.6rem 0.8rem', background: COLOR.panelDeep, border: `1px solid ${error ? COLOR.crit : COLOR.line}`, borderRadius: '5px', color: COLOR.ink, fontSize: '0.85rem', fontFamily: FONT.mono, outline: 'none', boxSizing: 'border-box', letterSpacing: '0.18em' }} />
          {error && <div style={{ fontSize: '0.72rem', color: COLOR.crit, marginTop: '8px' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button type="button" onClick={onCancel} style={{ flex: 1, padding: '0.55rem', background: 'transparent', border: `1px solid ${COLOR.line}`, borderRadius: '5px', color: COLOR.steel, fontSize: '0.75rem', cursor: 'pointer', fontFamily: FONT.body }}>取消</button>
            <button type="submit" disabled={loading} style={{ flex: 2, padding: '0.55rem', background: 'rgba(245,166,35,0.1)', border: `1px solid ${COLOR.amberDim}`, borderRadius: '5px', color: COLOR.amber, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body, opacity: loading ? 0.6 : 1 }}>{loading ? '驗證中…' : '進入'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Trigger lives in the header's right-hand block (see InstrumentPanelView) —
// the header had empty room and this used to be a cramped bottom-left
// popover (300px wide, 60vh scroll, small type) that was awkward to read.
// The panel itself is now a proper centered modal, sized for actually
// reading changelogs rather than squinting at a corner popover.
function VersionHistory() {
  const [expanded, setExpanded] = useState(false)
  const latest = VERSION_HISTORY[0]!
  return (
    <>
      <button onClick={() => setExpanded(true)} style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px', background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: '5px',
        padding: '0.35rem 0.7rem', cursor: 'pointer', fontFamily: FONT.mono, fontSize: '0.64rem', color: COLOR.steel, whiteSpace: 'nowrap', marginTop: '0.5rem',
      }}>
        <span style={{ color: COLOR.amber, fontWeight: 600 }}>v{latest.version}</span>
        <span style={{ color: COLOR.steelDim }}>版本歷程 ▸</span>
      </button>
      {expanded && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,11,14,0.82)' }}
          onClick={e => { if (e.target === e.currentTarget) setExpanded(false) }}
        >
          <div style={{ background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: '8px', padding: '1.8rem 2.2rem', width: 'min(760px, calc(100vw - 3rem))', maxHeight: '82vh', overflowY: 'auto', fontFamily: FONT.body }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.3rem', position: 'sticky', top: 0, background: COLOR.panel, paddingBottom: '0.8rem', borderBottom: `1px solid ${COLOR.line}` }}>
              <span style={{ fontFamily: FONT.mono, fontSize: '0.74rem', color: COLOR.amberDim, letterSpacing: '0.2em', textTransform: 'uppercase' }}>版本歷程 · Version History</span>
              <button onClick={() => setExpanded(false)} style={{ background: 'transparent', border: 'none', color: COLOR.steelDim, fontSize: '1.4rem', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>✕</button>
            </div>
            {VERSION_HISTORY.map((v, vi) => (
              <div key={v.version} style={{ marginBottom: vi < VERSION_HISTORY.length - 1 ? '26px' : 0, paddingBottom: vi < VERSION_HISTORY.length - 1 ? '22px' : 0, borderBottom: vi < VERSION_HISTORY.length - 1 ? `1px dashed ${COLOR.line}` : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: FONT.mono, fontSize: '1rem', fontWeight: 600, color: COLOR.amber }}>v{v.version}</span>
                  <span style={{ fontFamily: FONT.mono, fontSize: '0.72rem', color: COLOR.steelDim }}>{v.date}</span>
                </div>
                <div style={{ fontSize: '0.88rem', color: COLOR.ink, lineHeight: 1.7, marginBottom: '10px', fontWeight: 500 }}>{v.summary}</div>
                <ul style={{ margin: 0, padding: '0 0 0 18px' }}>
                  {v.changes.map((c, ci) => <li key={ci} style={{ fontSize: '0.8rem', color: COLOR.steel, lineHeight: 1.85, marginBottom: '5px' }}>{c}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

// ─────────────────────────────────────────────
// Instrument Panel View — top-level layout
// ─────────────────────────────────────────────
function InstrumentPanelView({
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

  const richSites: SiteData[] = []
  const plainSites: SiteData[] = []
  privateSites.forEach(s => {
    const summary = s.subsystemId ? dashboard.find(d => d.subsystemId === s.subsystemId) : undefined
    if (summary && SUMMARY_BODIES[summary.subsystemId]) richSites.push(s)
    else plainSites.push(s)
  })
  const HHI_SITE_PRIORITY: Record<string, number> = { 'pf-cwh': 0, fitnessforge: 1, vikunja: 2, travel: 3 }
  richSites.sort((a, b) => (HHI_SITE_PRIORITY[a.subsystemId ?? ''] ?? 99) - (HHI_SITE_PRIORITY[b.subsystemId ?? ''] ?? 99))
  const hhiSummary = dashboard.find(d => d.subsystemId === 'hhi')

  // 預設展開（原本預設收合）——人-事網路圖是這裡現在的主要內容，不是輔助
  // 的維運監控資訊了，藏起來反而失去意義；見 2026-09-06 改版說明。
  const [hermesOpen, setHermesOpen] = useState(true)

  return (
    <div style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: COLOR.panelDeep }}>
      <div style={{
        position: 'relative', flexShrink: 0, padding: '1.4rem 2rem 1.1rem', borderBottom: `2px solid ${COLOR.line}`,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1.5rem', flexWrap: 'wrap',
      }}>
        <div>
          <h1 style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 'clamp(1.6rem, 4vw, 2.3rem)', margin: 0, lineHeight: 1, color: COLOR.ink, animation: 'header-flicker 12s infinite' }}>
            翰翰儀表板
          </h1>
          <span style={{ fontFamily: FONT.latin, fontSize: '0.62rem', letterSpacing: '0.2em', color: COLOR.amber, textTransform: 'uppercase', marginTop: '0.3rem', display: 'block' }}>
            Life Instrumentation · 即時遙測面板
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
          <div style={{ fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.steelDim, textAlign: 'right', lineHeight: 1.6 }}>
            {sites.length > 0 ? `${sites.length} PORTALS AVAILABLE` : 'CONNECTING...'}
          </div>
          <VersionHistory />
        </div>
      </div>

      <div className="ip-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '1.4rem 1.6rem 5rem' }}>
        {/* HERMES 戰情室搬到幸福指數上方、預設展開——人-事網路圖現在是這裡
            的主要內容，不再是可有可無的維運監控附加區塊，見 2026-09-06 改版
            說明。折疊開關還留著，方便手機上想先跳過看下面內容的人收起來。 */}
        <div
          onClick={() => setHermesOpen(o => !o)}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: hermesOpen ? '0' : '1.1rem' }}
        >
          <span style={{ fontFamily: FONT.mono, fontSize: '0.66rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: COLOR.steelDim, display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%' }}>
            <span style={{ color: COLOR.amberDim }}>01</span>
            <span style={{ fontFamily: FONT.body, fontSize: '0.72rem', letterSpacing: '0.08em', color: COLOR.steel, textTransform: 'none' }}>
              HERMES 戰情室 · 人-事網路圖{!unlocked ? '（🔒）' : ''}
            </span>
            <span style={{ display: 'inline-block', transition: 'transform 0.2s ease', transform: hermesOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
            <span style={{ flex: 1, height: '1px', background: COLOR.line }} />
          </span>
        </div>
        {hermesOpen && (
          <Unit code="01" title="HERMES 戰情室 · 人-事網路圖">
            <HermesWarRoomSection
              unlocked={unlocked}
              unlockedPassword={unlockedPassword}
              onRequestUnlock={onRequestUnlock}
            />
          </Unit>
        )}

        <Unit code="02" title="翰翰仔幸福指數 · Hanhan Happiness Index">
          <HappinessHeroCard
            summary={hhiSummary}
            unlocked={unlocked}
            unlockedPassword={unlockedPassword}
            onRequestUnlock={onRequestUnlock}
          />
        </Unit>

        <Unit code="03" title="六維度子系統 · Subsystem Readouts">
          <div className="ip-dim-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
            {richSites.map(s => {
              const summary = dashboard.find(d => d.subsystemId === s.subsystemId)!
              return <DimensionGauge key={s.id} site={s} summary={summary} hhiSummary={hhiSummary} unlocked={unlocked} onSelect={onSiteSelect} />
            })}
            <MindIndexCard
              summary={dashboard.find(d => d.subsystemId === 'mind-index')}
              hhiSummary={hhiSummary}
              unlocked={unlocked}
              onSelect={onRequestUnlock}
            />
            <SocialIndexCard
              summary={dashboard.find(d => d.subsystemId === 'social-index')}
              hhiSummary={hhiSummary}
              unlocked={unlocked}
              onSelect={onRequestUnlock}
            />
          </div>
        </Unit>

        <ToolLinksZone privateSites={plainSites} publicSites={publicSites} unlocked={unlocked} onSelect={onSiteSelect} />

        <div style={{ marginTop: '1.4rem', paddingTop: '1rem', borderTop: `1px solid ${COLOR.line}`, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem', fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, letterSpacing: '0.06em' }}>
          <span>AIPORTAL · INSTRUMENT PANEL</span>
          <span>🔐 PRIVATE REQUIRES PASSWORD</span>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// 全站指令面板（⌘K / Ctrl+K）——工具連結原本的搜尋框只在展開「工具連結」
// 區塊時看得到、用得到，要先滾到那一區才能搜；這裡另外開一個任何時候都能
// 用快捷鍵叫出來的全域搜尋，搜的是同一份 `sites`（工具連結＋六維度裡有連
// 結的四個子系統本來就是同一份資料，不用另外處理），加一個永遠列在最前
// 面、可以直接跳關係宇宙的捷徑項目。關係宇宙頁面自己的人/事/案/物搜尋不
// 在這裡整合——那份資料只在進到 #graph 才會抓，這裡沒有必要為了指令面板
// 多發一次通常用不到的請求，改成 RelationshipUniverse.tsx 自己接
// ⌘K/Ctrl+K 去 focus 它既有的搜尋框（見該檔案）。
// ─────────────────────────────────────────────
function CommandPalette({
  sites,
  unlocked,
  onSelect,
  onNavigateGraph,
}: {
  sites: SiteData[]
  unlocked: boolean
  onSelect: (site: SiteData) => void
  onNavigateGraph: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  if (!open) return null

  const q = query.trim().toLowerCase()
  const matches = q.length === 0 ? sites : sites.filter(s => s.name.toLowerCase().includes(q) || s.subtitle.toLowerCase().includes(q))
  const graphKeywords = ['圖', '關係', '宇宙', 'graph']
  const showGraphShortcut = q.length === 0 || graphKeywords.some(k => k.toLowerCase().includes(q) || q.includes(k))

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '10px', padding: '0.6rem 0.9rem',
    cursor: 'pointer', borderRadius: '5px',
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', justifyContent: 'center', paddingTop: '12vh', background: 'rgba(10,11,14,0.75)' }}
      onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div style={{
        width: 'min(560px, calc(100% - 2.4rem))', maxHeight: '64vh', display: 'flex', flexDirection: 'column',
        background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: '8px', boxShadow: '0 20px 60px rgba(0,0,0,0.6)', overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.8rem 1rem', borderBottom: `1px solid ${COLOR.line}`, flexShrink: 0 }}>
          <span style={{ color: COLOR.amber, fontFamily: FONT.mono, fontSize: '0.9rem' }}>⌘</span>
          <input
            ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} autoComplete="off"
            placeholder="搜尋工具連結，或輸入「圖」跳到關係宇宙…"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: COLOR.ink, fontFamily: FONT.body, fontSize: '0.9rem' }}
          />
          <span style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, flexShrink: 0 }}>ESC</span>
        </div>
        <div style={{ overflowY: 'auto', padding: '0.4rem' }}>
          {showGraphShortcut && (
            <div
              onClick={() => { onNavigateGraph(); setOpen(false) }}
              style={{ ...rowStyle, background: 'rgba(245,166,35,0.08)' }}
            >
              <span style={{ color: COLOR.amber }}>◈</span>
              <span style={{ color: COLOR.amber, fontSize: '0.82rem', flex: 1 }}>展開完整關係宇宙</span>
              <span style={{ color: COLOR.amberDim, fontFamily: FONT.mono, fontSize: '0.68rem' }}>→</span>
            </div>
          )}
          {matches.length === 0 ? (
            <div style={{ textAlign: 'center', color: COLOR.steelDim, fontSize: '0.75rem', padding: '1.5rem 0' }}>找不到符合「{query}」的工具</div>
          ) : matches.map(s => {
            const locked = s.isPrivate && !unlocked
            return (
              <div key={s.id} onClick={() => { onSelect(s); setOpen(false) }} style={rowStyle}>
                <span style={{ color: locked ? COLOR.warn : COLOR.steelDim, fontSize: '0.8rem', flexShrink: 0 }}>{locked ? '🔒' : '○'}</span>
                <span style={{ color: COLOR.ink, fontSize: '0.82rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                <span style={{ color: COLOR.steelDim, fontSize: '0.68rem', flexShrink: 0, maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.subtitle}</span>
              </div>
            )
          })}
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
  // 全頁 3D 關係宇宙走 hash route（#graph），不是路徑 route——這個 SPA 沒
  // 有接路由庫，路徑 route 在 refresh/直接貼網址時需要伺服端 SPA fallback
  // 設定，hash 則完全是前端狀態，不需要動部署那端的反向代理規則。
  const [hashRoute, setHashRoute] = useState(() => window.location.hash)
  useEffect(() => {
    const onHashChange = () => setHashRoute(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

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

  if (hashRoute === '#graph') {
    return <RelationshipUniverse unlockedPassword={unlockedPassword} onBack={() => { window.location.hash = '' }} />
  }

  return (
    <div style={{ width: '100vw', height: '100vh', background: COLOR.panelDeep, position: 'relative', overflow: 'hidden' }}>
      <InstrumentPanelView
        sites={sites}
        dashboard={dashboard}
        unlocked={unlocked}
        unlockedPassword={unlockedPassword}
        onSiteSelect={handleSiteClick}
        onRequestUnlock={handleRequestUnlock}
      />

      <button
        onClick={() => setAdminAuth(true)}
        title="管理後台"
        style={{
          position: 'absolute', bottom: '1.5rem', right: '1.5rem', zIndex: 100,
          background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: '5px',
          color: COLOR.steelDim, fontSize: '1rem', padding: '0.5rem 0.8rem', cursor: 'pointer', lineHeight: 1,
        }}
      >⚙</button>

      <CommandPalette
        sites={sites}
        unlocked={unlocked}
        onSelect={handleSiteClick}
        onNavigateGraph={() => { window.location.hash = 'graph' }}
      />

      {modal.visible && (
        <PasswordModal
          pendingUrl={modal.pendingUrl}
          onSuccess={handleModalSuccess}
          onCancel={() => setModal({ visible: false, pendingUrl: '' })}
        />
      )}

      {adminAuth && !adminOpen && (
        <AdminAuthModal onSuccess={handleAdminAuthSuccess} onCancel={() => setAdminAuth(false)} />
      )}

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
