// 知識庫架構頁（#architecture）的拓撲：節點、分層、流向都寫在這一份，畫面只負責畫。
// 來源：kb-pipeline docs/pipeline-architecture.md、kb-ledger-ops.md、kb-query.md，與 PR #208 的 graphrag 交接文件（2026-10-21）。
// 只寫「結構與職責」，不寫排程時間與數字：各層班表與健康狀態由 /api/hermes-pipeline 即時帶入（jobs.json 為準），
// 手寫的時間很快過時（舊的 PipelineFlow 就是這樣漂移的）。標「未驗證」的是文件寫的、沒有實機證據的部分。

export type BandId = 'source' | 'pipeline' | 'store' | 'derived' | 'portal'
/** authority＝權威來源；derived＝可刪可重建的衍生物；experimental＝試驗中、未接下游 */
export type NodeRole = 'source' | 'pipeline' | 'authority' | 'derived' | 'experimental' | 'portal'
export type LayerKey = 'L1' | 'L2' | 'L3' | 'L4' | 'L5'

export interface ArchNode {
  id: string
  band: BandId
  title: string
  sub: string
  role: NodeRole
  /** 職責一句話 */
  what: string
  scripts?: string[]
  /** 有即時健康資料的管線層 */
  layer?: LayerKey
  /** 補充說明（狀態、限制、未驗證處） */
  note?: string
}

/** 已擱置並移除的元件：不畫成節點（畫面只放一段說明），但留下決策紀錄與重啟條件，避免日後有人以為漏畫。 */
export const RETIRED: ReadonlyArray<{ name: string; date: string; why: string; restart: string }> = [
  {
    name: 'LightRAG ＋ Neo4j',
    date: '2026-10-22',
    why: '終身使用的知識庫以 L1–L5 ＋ SQLite 為基底；LightRAG 的 embedding 在 Gemini 免費層每日 1000 次，59 篇就用完，且要把日記與人物內容送到兩個外部服務；Neo4j 多佔 1.3 GB 記憶體與一個備份排程。第一輪對照試驗因額度作廢，沒有取得抽取品質數據。已從 VPS 刪除容器、資料與腳本。',
    restart: 'embedding 來源已解決（付費或本機模型），且查詢紀錄顯示語意落差確實是問題。程式與評估文件保留在 kb-pipeline 的 docs/graphrag。',
  },
]

export const BANDS: ReadonlyArray<{ id: BandId; title: string; hint: string }> = [
  { id: 'source', title: '資料來源', hint: '進來的原料' },
  { id: 'pipeline', title: '萃取管線', hint: 'cron 喚起 LLM agent，wrapper 只做掃描、組裝、心跳' },
  { id: 'store', title: '權威儲存', hint: '壞了要從這裡救回來' },
  { id: 'derived', title: '衍生索引', hint: '可刪可重建，不是權威來源' },
  { id: 'portal', title: '入口網', hint: '只負責顯示，不寫回' },
]

export const ROLE_LABEL: Record<NodeRole, string> = {
  source: '來源', pipeline: '管線', authority: '權威', derived: '衍生・可重建', experimental: '試驗中', portal: '顯示',
}

export const NODES: readonly ArchNode[] = [
  { id: 'diary', band: 'source', title: '日記', sub: '日記/{date}.md', role: 'source',
    what: '使用者與 HERMES 每天寫的日記，是最主要的來源；L1 只讀「C已處理」標記之後的增量。' },
  { id: 'raw', band: 'source', title: 'RAW 文件', sub: 'RAW_INTAKE', role: 'source',
    what: 'PDF、名片、掃描件、試算表等原始檔，放進收件夾後由 L4 掃描。' },
  { id: 'tasks', band: 'source', title: '任務系統', sub: 'Vikunja', role: 'source',
    what: '任務評論先同步進日記（L2 開頭做），案件的結案狀態也來自這裡。' },
  { id: 'nas', band: 'source', title: 'NAS 歷史檔', sub: 'home-pull', role: 'source',
    what: '家中 NAS 的歷史檔與相片，定時拉到 VPS 再交給 L4。' },

  { id: 'L1', band: 'pipeline', layer: 'L1', title: 'L1 快掃', sub: '日記增量 → 候選', role: 'pipeline',
    what: '讀日記增量，抽出候選事件與社交互動；人名必須逐字出現在日記，否則整批拒寫（防幻覺閘）。',
    scripts: ['l1-agent-wrapper.py', 'append-candidate-queue.py', 'append-social-interactions.py'] },
  { id: 'L2', band: 'pipeline', layer: 'L2', title: 'L2 消歧', sub: '候選 → 正規化', role: 'pipeline',
    what: '人名消歧、事件合併，把 L1／L4 的候選整理成 normalized 佇列。',
    scripts: ['l2-agent-wrapper.py', 'write-normalized-queue.py'] },
  { id: 'L3', band: 'pipeline', layer: 'L3', title: 'L3 入庫', sub: '正規化 → 正式檔', role: 'pipeline',
    what: '唯一可以寫正式檔的層：Events、People、Cases、Objects，並用 ledger 跨日去重、補雙向連結。',
    scripts: ['l3-agent-wrapper.py', 'append-person-event-link.py', 'append-case-event-link.py', 'append-object-event-link.py'] },
  { id: 'L4', band: 'pipeline', layer: 'L4', title: 'L4 文件', sub: 'RAW → 候選', role: 'pipeline',
    what: 'RAW 文件 OCR 後萃取成候選事件（source_type: raw），與 L1 的候選合流進 L2。',
    scripts: ['raw-sync-scanner.py'],
    note: '實機的 L4 班次直接叫 scanner，不經 l4-agent-wrapper.py（文件寫的已知分歧）。' },
  { id: 'L5', band: 'pipeline', layer: 'L5', title: 'L5 圖譜編織', sub: '沿邊說故事', role: 'pipeline',
    what: '稽核事件、人物、案件的連結，挑樞紐，並把「圖譜敘事」寫回人物、案件、物件頁（永不改寫舊段）。',
    scripts: ['l5-agent-wrapper.py', 'graph-audit-events-people-cases.py'] },
  { id: 'sidecar', band: 'pipeline', title: '確定性萃取器', sub: '搭在 L1 班次上', role: 'pipeline',
    what: '想法庫、遊記、地點、社交等結構化資料用程式（不呼叫模型）從日記萃取，各自一個 state 檔。',
    scripts: ['ideas-extractor.py', 'places-pusher.py'] },

  { id: 'vault', band: 'store', title: 'Obsidian vault', sub: 'Markdown + frontmatter', role: 'authority',
    what: '知識的權威來源：Events、People、Cases、Objects、概念、方法、想法等；在 git 裡（L1／L2／L3 前後快照），Syncthing 單向送 NAS。' },
  { id: 'ledger', band: 'store', title: 'kb-ledger', sub: 'SQLite（佇列、實體、有型別的邊）', role: 'authority',
    what: '把「佇列、去重、實體、邊、出處」收進資料庫；邊有 8 種型別（participant／case／object／concept／method／source／see_also／body_link）。',
    scripts: ['kbcore/ledger_schema.py', 'kbcore/ledger_sync.py'],
    note: '10 個模組旗標全是 off 或 shadow，沒有任何一個 primary（HERMES 2026-10-22 實測）：交接的正本仍是 YAML 佇列與 JSON，帳本是影子雙寫。' },

  { id: 'kbindex', band: 'derived', title: 'kb-index', sub: 'SQLite FTS5 全文索引', role: 'derived',
    what: '每晚從 vault 重建；回答「誰、何時、哪案」與全文搜尋（kb.py query／about／today）。',
    scripts: ['kb.py', 'kbcore/kb_index.py'],
    note: '關係只有不分型別的 wikilink 邊（links 表）。' },
  { id: 'pushers', band: 'portal', title: 'HERMES 推送', sub: '11 種 feed', role: 'portal',
    what: '每種資料一支 pusher → 一個 /admin 端點 → 一張快照表；關係圖每 10 分鐘推一次。',
    scripts: ['hermes-graph-pusher.py', 'hermes-timeline-pusher.py', 'hermes-status-pusher.py', 'hermes-usage-pusher.py'],
    note: 'graph pusher 與 L5 各自再解析一次 frontmatter（重複解析處）。' },
  { id: 'portal', band: 'portal', title: '入口網', sub: 'Aiportal', role: 'portal',
    what: '關係宇宙、時間軸、想法庫、地圖、幸福指數、戰情室；解鎖後才顯示私領域資料。' },
]

export interface ArchEdge { from: string; to: string; label?: string }

export const EDGES: readonly ArchEdge[] = [
  { from: 'diary', to: 'L1', label: '日記增量' },
  { from: 'diary', to: 'sidecar' },
  { from: 'tasks', to: 'L2', label: '任務評論' },
  { from: 'raw', to: 'L4' },
  { from: 'nas', to: 'L4' },
  { from: 'L1', to: 'L2', label: 'candidates' },
  { from: 'L4', to: 'L2', label: 'candidates' },
  { from: 'L2', to: 'L3', label: 'normalized' },
  { from: 'L3', to: 'vault', label: '正式檔' },
  { from: 'L5', to: 'vault', label: '圖譜敘事' },
  { from: 'vault', to: 'L5' },
  { from: 'sidecar', to: 'vault' },
  { from: 'L3', to: 'ledger', label: 'shadow 寫入' },
  { from: 'vault', to: 'ledger', label: '同步實體與邊' },
  { from: 'vault', to: 'kbindex', label: '每晚重建' },
  { from: 'vault', to: 'pushers' },
  { from: 'sidecar', to: 'pushers' },
  { from: 'pushers', to: 'portal' },
]

const BY_ID = new Map(NODES.map((n) => [n.id, n]))
export const nodeById = (id: string): ArchNode | undefined => BY_ID.get(id)

/** 某節點的上游（誰餵它）與下游（它餵誰）；排除自己，依 NODES 順序、不重複。 */
export function neighbors(id: string): { up: ArchNode[]; down: ArchNode[] } {
  const pick = (ids: string[]) => NODES.filter((n) => n.id !== id && ids.includes(n.id))
  return {
    up: pick(EDGES.filter((e) => e.to === id).map((e) => e.from)),
    down: pick(EDGES.filter((e) => e.from === id).map((e) => e.to)),
  }
}

export function nodesInBand(band: BandId): ArchNode[] {
  return NODES.filter((n) => n.band === band)
}

/** 節點與某選取節點的關係：選取本身、上游、下游、無關（畫面用來淡化無關的節點） */
export function relationTo(selected: string | null, id: string): 'self' | 'up' | 'down' | 'none' | 'idle' {
  if (!selected) return 'idle'
  if (selected === id) return 'self'
  const { up, down } = neighbors(selected)
  if (up.some((n) => n.id === id)) return 'up'
  if (down.some((n) => n.id === id)) return 'down'
  return 'none'
}
