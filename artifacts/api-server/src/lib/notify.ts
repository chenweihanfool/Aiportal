import { logger } from "./logger";

// 目前所有「有異常」的訊號都只是戰情室面板上的紅點——沒開網頁就不會發
// 現。這裡補一個輕量的主動推播：ntfy.sh（或自架的 ntfy 伺服器）一個
// `POST <topic url>`，body 是純文字訊息，不需要另外的帳號/SDK。完全選配
// ——沒設定 NTFY_TOPIC_URL 就整個模組是 no-op，不影響現有任何行為。
const NTFY_URL = process.env["NTFY_TOPIC_URL"];

async function ntfyPost(title: string, message: string, priority: "default" | "high"): Promise<void> {
  if (!NTFY_URL) return;
  try {
    // Title header 只能放 ASCII——undici 的 fetch 對 header value 要求
    // ISO-8859-1，中文字（多位元組 UTF-8）會直接讓 fetch 拋錯，所以中文
    // 內容一律放 body，Title 固定用英文。
    const res = await fetch(NTFY_URL, {
      method: "POST",
      headers: { Title: title, Priority: priority },
      body: message,
    });
    if (!res.ok) {
      logger.error({ status: res.status }, "ntfy notification rejected");
    }
  } catch (err) {
    // 推播失敗不該影響呼叫端（collect.ps1 的 POST 還是要正常回應）——這裡
    // 吞掉錯誤、只記 log，呼叫端完全不用 try/catch。
    logger.error({ err }, "ntfy notification failed");
  }
}

// 只在「狀態改變」時通知一次，不是每次 push（~每 10 分鐘一次）都發——沒有
// 這層去抖動的話，容器掛掉的當下會收到，之後每 10 分鐘再收到一次一模一
// 樣的通知，直到修好為止，很快就會被使用者把整個 topic 靜音掉。記憶體存
// 前一次的布林狀態就夠：這是單一 process、單一使用者的服務，伺服器重啟
// 後最多重新通知一次「還在壞」，可接受，不需要為此多開一張 DB 表。
const previousAlertState = new Map<string, boolean>();

/**
 * key 是這個警報訊號的穩定識別碼（例如 "hermes-containers"、
 * "hermes-pipeline-L3"），不同訊號要給不同的 key，各自獨立追蹤上一次的
 * 狀態，不會互相覆蓋。
 */
export function notifyOnAlertTransition(
  key: string,
  isAlerting: boolean,
  title: string,
  alertMessage: string,
  resolvedMessage: string,
): void {
  const was = previousAlertState.get(key) ?? false;
  previousAlertState.set(key, isAlerting);
  if (isAlerting && !was) {
    void ntfyPost(title, alertMessage, "high");
  } else if (!isAlerting && was) {
    void ntfyPost(title, resolvedMessage, "default");
  }
}
