import { describe, expect, it } from "vitest"
import { fetchRepos, parseRepo } from "./githubRepos"

const repo = (name: string, extra: Record<string, unknown> = {}) => ({
  name, full_name: `chenweihanfool/${name}`, html_url: `https://github.com/chenweihanfool/${name}`, private: false, ...extra,
})

describe("parseRepo", () => {
  it("maps the fields and defaults the optional ones", () => {
    const r = parseRepo(repo("a", { description: "x", language: "TypeScript", topics: ["t", 1], pushed_at: "2026-10-01T00:00:00Z", stargazers_count: 3, open_issues_count: 2, archived: true, private: true }))
    expect(r).toMatchObject({ name: "a", description: "x", language: "TypeScript", topics: ["t"], stars: 3, openIssues: 2, archived: true, private: true, fork: false })
    expect(parseRepo(repo("b"))).toMatchObject({ description: null, language: null, topics: [], pushedAt: null, stars: 0 })
  })
  it("keeps only http(s) homepages", () => {
    expect(parseRepo(repo("a", { homepage: "https://kc2-cwh.replit.app/" }))?.homepage).toBe("https://kc2-cwh.replit.app/");
    expect(parseRepo(repo("a", { homepage: "javascript:alert(1)" }))?.homepage).toBeNull();
    expect(parseRepo(repo("a", { homepage: "" }))?.homepage).toBeNull();
    expect(parseRepo(repo("a", { homepage: "not a url" }))?.homepage).toBeNull();
    expect(parseRepo(repo("a"))?.homepage).toBeNull();
  });
  it("rejects rows missing name or url", () => {
    expect(parseRepo({ name: "a" })).toBeNull()
    expect(parseRepo(null)).toBeNull()
  })
})

describe("fetchRepos", () => {
  const page = (rows: unknown) => async () => new Response(JSON.stringify(rows)) as Response

  it("without a token reads the public listing and flags privateIncluded=false", async () => {
    let url = ""; let auth: string | undefined
    const f = (async (u: string, init?: RequestInit) => { url = u; auth = (init?.headers as Record<string, string>)["Authorization"]; return new Response(JSON.stringify([repo("a")])) }) as unknown as typeof fetch
    const r = await fetchRepos({ owner: "chenweihanfool" }, f)
    expect(url).toContain("/users/chenweihanfool/repos")
    expect(auth).toBeUndefined()
    expect(r).toMatchObject({ status: "ok", privateIncluded: false })
  })
  it("with a token reads /user/repos with a Bearer header", async () => {
    let url = ""; let auth = ""
    const f = (async (u: string, init?: RequestInit) => { url = u; auth = (init?.headers as Record<string, string>)["Authorization"]!; return new Response(JSON.stringify([repo("p", { private: true })])) }) as unknown as typeof fetch
    const r = await fetchRepos({ token: "github_pat_x", owner: "chenweihanfool" }, f)
    expect(url).toContain("/user/repos?affiliation=owner")
    expect(auth).toBe("Bearer github_pat_x")
    expect(r.status === "ok" && r.privateIncluded && r.repos[0]?.private).toBe(true)
  })
  it("keeps only the owner's repos", async () => {
    const r = await fetchRepos({ token: "t", owner: "chenweihanfool" }, page([repo("a"), { ...repo("b"), full_name: "someorg/b" }]) as unknown as typeof fetch)
    expect(r.status === "ok" && r.repos.map((x) => x.name)).toEqual(["a"])
  })
  it("pages until a short page", async () => {
    const calls: string[] = []
    const full = Array.from({ length: 100 }, (_, i) => repo(`r${i}`))
    const f = (async (u: string) => { calls.push(u); return new Response(JSON.stringify(calls.length === 1 ? full : [repo("last")])) }) as unknown as typeof fetch
    const r = await fetchRepos({ token: "t", owner: "chenweihanfool" }, f)
    expect(calls).toHaveLength(2)
    expect(r.status === "ok" && r.repos).toHaveLength(101)
  })
  it("maps HTTP errors, bad bodies and network failures to status error", async () => {
    expect(await fetchRepos({ owner: "o" }, (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch)).toEqual({ status: "error", message: "HTTP 403" })
    expect(await fetchRepos({ owner: "o" }, page({}) as unknown as typeof fetch)).toEqual({ status: "error", message: "回應格式不符" })
    expect(await fetchRepos({ owner: "o" }, (async () => { throw new Error("ECONNRESET") }) as unknown as typeof fetch)).toEqual({ status: "error", message: "ECONNRESET" })
  })
})
