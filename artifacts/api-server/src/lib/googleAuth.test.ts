import { describe, expect, it } from "vitest"
import {
  buildAuthUrl, callbackUrl, checkClaims, clearCookie, decodeIdToken, isAllowedEmail, loadGoogleAuthConfig, newPkce,
  parseAllowedEmails, readCookie, serializeCookie, sessionEmail, signToken, verifyToken, SESSION_COOKIE,
} from "./googleAuth"
import { createHash } from "node:crypto"

const ENV = {
  GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "csecret",
  PUBLIC_BASE_URL: "https://cwh2023.synology.me/aiportal/",
  ALLOWED_GOOGLE_EMAILS: "Me@Gmail.com, other@gmail.com",
}
const cfg = loadGoogleAuthConfig(ENV, "adminpw")
const now = 1_800_000_000

describe("loadGoogleAuthConfig", () => {
  it("is configured only when client, public url and a whitelist are all present", () => {
    expect(cfg.configured).toBe(true)
    expect(cfg.baseUrl).toBe("https://cwh2023.synology.me/aiportal")
    expect(cfg.cookiePath).toBe("/aiportal")
    expect(cfg.secure).toBe(true)
    expect(cfg.required).toBe(false)
    for (const k of Object.keys(ENV)) {
      expect(loadGoogleAuthConfig({ ...ENV, [k]: "" }, "x").configured).toBe(false)
    }
    expect(loadGoogleAuthConfig({ ...ENV, PUBLIC_BASE_URL: "not a url" }, "x").configured).toBe(false)
  })
  it("requires login only when REQUIRE_GOOGLE_LOGIN=1", () => {
    expect(loadGoogleAuthConfig({ ...ENV, REQUIRE_GOOGLE_LOGIN: "1" }, "x").required).toBe(true)
    expect(loadGoogleAuthConfig({ ...ENV, REQUIRE_GOOGLE_LOGIN: "true" }, "x").required).toBe(false)
  })
  it("uses root cookie path and non-secure cookies for a plain http origin", () => {
    const c = loadGoogleAuthConfig({ ...ENV, PUBLIC_BASE_URL: "http://localhost:3000" }, "x")
    expect(c.cookiePath).toBe("/")
    expect(c.secure).toBe(false)
  })
  it("derives the secret from the admin password unless SESSION_SECRET is set", () => {
    expect(loadGoogleAuthConfig(ENV, "a").secret).not.toBe(loadGoogleAuthConfig(ENV, "b").secret)
    expect(loadGoogleAuthConfig({ ...ENV, SESSION_SECRET: "s" }, "a").secret).toBe("s")
  })
})

describe("whitelist", () => {
  it("normalizes case and separators", () => {
    expect(parseAllowedEmails(" A@x.com;b@y.com  c@z.com,,junk ")).toEqual(["a@x.com", "b@y.com", "c@z.com"])
    expect(parseAllowedEmails(undefined)).toEqual([])
  })
  it("matches case-insensitively and rejects everything else", () => {
    expect(isAllowedEmail("ME@gmail.COM", cfg.allowedEmails)).toBe(true)
    expect(isAllowedEmail("evil@gmail.com", cfg.allowedEmails)).toBe(false)
    expect(isAllowedEmail("me@gmail.com.evil.com", cfg.allowedEmails)).toBe(false)
    expect(isAllowedEmail(undefined, cfg.allowedEmails)).toBe(false)
  })
})

describe("signed tokens", () => {
  it("round-trips until expiry", () => {
    const t = signToken({ e: "a@b.c", exp: now + 10 }, "k")
    expect(verifyToken(t, "k", now)?.["e"]).toBe("a@b.c")
    expect(verifyToken(t, "k", now + 10)).toBeNull()
  })
  it("rejects tampering, wrong secret and malformed input", () => {
    const t = signToken({ e: "a@b.c", exp: now + 10 }, "k")
    const [body, sig] = t.split(".")
    const forged = Buffer.from(JSON.stringify({ e: "evil@x.com", exp: now + 10 })).toString("base64url")
    expect(verifyToken(`${forged}.${sig}`, "k", now)).toBeNull()
    expect(verifyToken(t, "other", now)).toBeNull()
    expect(verifyToken(`${body}.`, "k", now)).toBeNull()
    expect(verifyToken(`${t}.x`, "k", now)).toBeNull()
    expect(verifyToken(undefined, "k", now)).toBeNull()
    expect(verifyToken("garbage", "k", now)).toBeNull()
  })
})

describe("cookies", () => {
  it("reads one cookie out of a header", () => {
    expect(readCookie("a=1; aip_session=xyz; b=2", "aip_session")).toBe("xyz")
    expect(readCookie("a=1", "aip_session")).toBeUndefined()
    expect(readCookie(undefined, "x")).toBeUndefined()
  })
  it("sets HttpOnly, SameSite=Lax, Secure on https, scoped to the app path", () => {
    expect(serializeCookie("n", "v", cfg, 60)).toBe("n=v; Path=/aiportal; Max-Age=60; HttpOnly; SameSite=Lax; Secure")
    expect(clearCookie("n", cfg)).toContain("Max-Age=0")
  })
})

describe("sessionEmail", () => {
  const cookie = (payload: Record<string, unknown>, secret = cfg.secret) => `${SESSION_COOKIE}=${signToken(payload, secret)}`
  it("accepts a valid session for a whitelisted email", () => {
    expect(sessionEmail(cookie({ e: "me@gmail.com", exp: now + 5 }), cfg, now)).toBe("me@gmail.com")
  })
  it("revokes immediately when the email leaves the whitelist", () => {
    const c = cookie({ e: "me@gmail.com", exp: now + 5 })
    const narrowed = loadGoogleAuthConfig({ ...ENV, ALLOWED_GOOGLE_EMAILS: "other@gmail.com" }, "adminpw")
    expect(sessionEmail(c, narrowed, now)).toBeNull()
  })
  it("rejects expired, foreign-secret and unconfigured sessions", () => {
    expect(sessionEmail(cookie({ e: "me@gmail.com", exp: now - 1 }), cfg, now)).toBeNull()
    expect(sessionEmail(cookie({ e: "me@gmail.com", exp: now + 5 }, "other"), cfg, now)).toBeNull()
    expect(sessionEmail(cookie({ e: "me@gmail.com", exp: now + 5 }), loadGoogleAuthConfig({}, "adminpw"), now)).toBeNull()
  })
})

describe("OIDC helpers", () => {
  it("builds a PKCE S256 authorization url with the registered callback", () => {
    const { verifier, challenge } = newPkce()
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"))
    const u = new URL(buildAuthUrl(cfg, { state: "S", nonce: "N", challenge }))
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth")
    expect(u.searchParams.get("redirect_uri")).toBe("https://cwh2023.synology.me/aiportal/api/auth/callback")
    expect(callbackUrl(cfg)).toBe("https://cwh2023.synology.me/aiportal/api/auth/callback")
    expect(u.searchParams.get("code_challenge_method")).toBe("S256")
    expect(u.searchParams.get("state")).toBe("S")
    expect(u.searchParams.get("nonce")).toBe("N")
    expect(u.searchParams.get("scope")).toBe("openid email")
  })

  const good = { iss: "https://accounts.google.com", aud: cfg.clientId, exp: now + 60, nonce: "N", email: "Me@gmail.com", email_verified: true }
  it("accepts good claims and lowercases the email", () => {
    expect(checkClaims(good, cfg, "N", now)).toEqual({ ok: true, email: "me@gmail.com" })
    expect(checkClaims({ ...good, iss: "accounts.google.com" }, cfg, "N", now).ok).toBe(true)
  })
  it.each([
    ["wrong issuer", { iss: "https://evil.com" }, "invalid"],
    ["wrong audience", { aud: "other" }, "invalid"],
    ["expired", { exp: now - 1 }, "invalid"],
    ["wrong nonce", { nonce: "X" }, "invalid"],
    ["missing email", { email: undefined }, "invalid"],
    ["unverified email", { email_verified: false }, "unverified"],
    ["not whitelisted", { email: "evil@gmail.com" }, "denied"],
  ])("rejects %s", (_n, patch, reason) => {
    const r = checkClaims({ ...good, ...patch }, cfg, "N", now)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe(reason)
  })
  it("rejects a missing claims object", () => {
    expect(checkClaims(null, cfg, "N", now).ok).toBe(false)
  })
  it("decodes the id_token payload and rejects malformed ones", () => {
    const jwt = `h.${Buffer.from(JSON.stringify({ email: "a@b.c" })).toString("base64url")}.s`
    expect(decodeIdToken(jwt)?.email).toBe("a@b.c")
    expect(decodeIdToken("a.b")).toBeNull()
    expect(decodeIdToken(5)).toBeNull()
    expect(decodeIdToken("h.%%%.s")).toBeNull()
  })
})
