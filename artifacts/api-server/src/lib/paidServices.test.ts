import { describe, expect, it } from "vitest"
import { fetchDeepSeek, fetchTavily, parseDeepSeekBalance, parseTavilyUsage } from "./paidServices"

const json = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status }) as Response

describe("parseDeepSeekBalance", () => {
  it("reads the balance list and coerces the string amounts", () => {
    const r = parseDeepSeekBalance({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" }] })
    expect(r).toEqual({ available: true, balances: [{ currency: "CNY", total: 110, granted: 10, toppedUp: 100 }] })
  })
  it("skips malformed rows and rejects a body without balance_infos", () => {
    expect(parseDeepSeekBalance({ is_available: false, balance_infos: [{ currency: "USD" }, null] })).toEqual({ available: false, balances: [] })
    expect(parseDeepSeekBalance({ is_available: true })).toBeNull()
    expect(parseDeepSeekBalance(null)).toBeNull()
  })
})

describe("parseTavilyUsage", () => {
  it("prefers the key quota and keeps the account totals", () => {
    const r = parseTavilyUsage({ key: { usage: 120, limit: 1000 }, account: { current_plan: "Researcher", plan_usage: 300, plan_limit: 1000 } })
    expect(r).toEqual({ plan: "Researcher", used: 120, limit: 1000, accountUsed: 300, accountLimit: 1000 })
  })
  it("falls back to the plan numbers when the key has no limit", () => {
    const r = parseTavilyUsage({ key: { usage: 5, limit: null }, account: { current_plan: "Free", plan_usage: 5, plan_limit: 1000 } })
    expect(r?.limit).toBe(1000)
  })
  it("returns null when no usage number is present", () => {
    expect(parseTavilyUsage({ account: {} })).toBeNull()
  })
})

describe("fetchers", () => {
  it("report no-key without calling out", async () => {
    let called = false
    const f = (async () => { called = true; return new Response("{}") }) as typeof fetch
    expect(await fetchDeepSeek(undefined, f)).toEqual({ status: "no-key" })
    expect(await fetchTavily("", f)).toEqual({ status: "no-key" })
    expect(called).toBe(false)
  })
  it("map HTTP errors, bad bodies and network failures to status error", async () => {
    expect(await fetchDeepSeek("k", json({}, 401) as typeof fetch)).toEqual({ status: "error", message: "HTTP 401" })
    expect(await fetchTavily("k", json({ nope: 1 }) as typeof fetch)).toEqual({ status: "error", message: "回應格式不符" })
    const boom = (async () => { throw new Error("ECONNRESET") }) as typeof fetch
    expect(await fetchTavily("k", boom)).toEqual({ status: "error", message: "ECONNRESET" })
  })
  it("send the key as a Bearer token", async () => {
    let auth = ""
    const f = (async (_u: unknown, init?: RequestInit) => { auth = String((init?.headers as Record<string, string>).Authorization); return new Response(JSON.stringify({ key: { usage: 1, limit: 2 } })) }) as typeof fetch
    const r = await fetchTavily("tvly-abc", f)
    expect(auth).toBe("Bearer tvly-abc")
    expect(r.status).toBe("ok")
  })
})
