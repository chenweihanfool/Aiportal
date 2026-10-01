// Google 登入 + 登入閘：掛真實的 bridge／router／gate，Google token endpoint 用假的 fetch（不連外、不需資料庫）。
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ADMIN = "gate-test-admin-pw";
const CID = "cid.apps.googleusercontent.com";

describe("google login + gate", () => {
  let server: Server;
  let base = "";
  let tokenResponse: { ok: boolean; id_token?: string } = { ok: false };
  let lastTokenBody = "";

  const idToken = (claims: Record<string, unknown>) =>
    `h.${Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: CID, exp: Math.floor(Date.now() / 1000) + 300, email_verified: true, ...claims })).toString("base64url")}.s`;

  const fakeFetch = (async (_url: string, init?: { body?: string }) => {
    lastTokenBody = String(init?.body ?? "");
    return { ok: tokenResponse.ok, json: async () => ({ id_token: tokenResponse.id_token }) };
  }) as unknown as typeof fetch;

  const get = (p: string, init: RequestInit = {}) => fetch(base + p, { redirect: "manual", ...init });

  /** 走完 login → callback，回傳 session cookie（或 null）與 callback 的導向位置。 */
  async function loginAs(email: string, opts: { verified?: boolean; tamperState?: boolean } = {}) {
    const login = await get("/api/auth/login");
    const authUrl = new URL(login.headers.get("location")!);
    const tmpCookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0]!;
    tokenResponse = { ok: true, id_token: idToken({ email, nonce: authUrl.searchParams.get("nonce"), email_verified: opts.verified ?? true }) };
    const state = opts.tamperState ? "forged" : authUrl.searchParams.get("state")!;
    const cb = await get(`/api/auth/callback?code=abc&state=${state}`, { headers: { cookie: tmpCookie } });
    const session = cb.headers.getSetCookie().map((c) => c.split(";")[0]!).find((c) => c.startsWith("aip_session=") && c !== "aip_session=");
    return { cb, session: session ?? null, location: cb.headers.get("location") };
  }

  beforeAll(async () => {
    process.env["ADMIN_PASSWORD"] = ADMIN;
    process.env["GOOGLE_CLIENT_ID"] = CID;
    process.env["GOOGLE_CLIENT_SECRET"] = "secret";
    process.env["PUBLIC_BASE_URL"] = "https://portal.example/aiportal";
    process.env["ALLOWED_GOOGLE_EMAILS"] = "me@gmail.com";
    delete process.env["REQUIRE_GOOGLE_LOGIN"];
    const express = (await import("express")).default;
    const { createGoogleAuthRouter } = await import("./googleAuth");
    const { googleSessionBridge, requireLoginGate } = await import("../lib/loginGate");
    const { isAuthorized } = await import("../lib/adminSession");
    const app = express();
    const api = express.Router();
    api.use(googleSessionBridge);
    api.get("/healthz", (_q, r) => { r.json({ ok: true }); });
    api.use(createGoogleAuthRouter(fakeFetch));
    api.use(requireLoginGate);
    api.get("/probe", (q, r) => { r.json({ authorized: isAuthorized(q.headers["x-admin-password"]) }); });
    app.use("/api", api);
    await new Promise<void>((res) => { server = app.listen(0, "127.0.0.1", () => res()); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise((r) => server?.close(r)); });
  beforeEach(() => { delete process.env["REQUIRE_GOOGLE_LOGIN"]; process.env["ALLOWED_GOOGLE_EMAILS"] = "me@gmail.com"; });

  it("redirects to Google with PKCE and the registered callback", async () => {
    const r = await get("/api/auth/login");
    expect(r.status).toBe(302);
    const u = new URL(r.headers.get("location")!);
    expect(u.host).toBe("accounts.google.com");
    expect(u.searchParams.get("redirect_uri")).toBe("https://portal.example/aiportal/api/auth/callback");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(r.headers.getSetCookie()[0]).toMatch(/HttpOnly.*SameSite=Lax.*Secure|Path=\/aiportal/);
  });

  it("logs in a whitelisted account and then authorizes private routes through the cookie", async () => {
    expect((await get("/api/probe")).status).toBe(200);
    expect(await (await get("/api/probe")).json()).toEqual({ authorized: false });
    const { session, location } = await loginAs("me@gmail.com");
    expect(location).toBe("https://portal.example/aiportal/");
    expect(session).toBeTruthy();
    expect(lastTokenBody).toContain("code_verifier=");
    expect(await (await get("/api/probe", { headers: { cookie: session! } })).json()).toEqual({ authorized: true });
    // 前端殘留的假憑證不應壓過有效的登入
    expect(await (await get("/api/probe", { headers: { cookie: session!, "x-admin-password": "junk" } })).json()).toEqual({ authorized: true });
    const me = await get("/api/auth/me", { headers: { cookie: session! } });
    expect(await me.json()).toEqual({ email: "me@gmail.com", loginRequired: false });
  });

  it("refuses accounts that are not whitelisted, unverified, or arrive with a forged state", async () => {
    const denied = await loginAs("evil@gmail.com");
    expect(denied.session).toBeNull();
    expect(denied.location).toBe("https://portal.example/aiportal/?login_error=denied");
    expect((await loginAs("me@gmail.com", { verified: false })).location).toContain("login_error=unverified");
    expect((await loginAs("me@gmail.com", { tamperState: true })).location).toContain("login_error=invalid_state");
  });

  it("revokes an existing session as soon as the email leaves the whitelist", async () => {
    const { session } = await loginAs("me@gmail.com");
    process.env["ALLOWED_GOOGLE_EMAILS"] = "someone-else@gmail.com";
    expect(await (await get("/api/probe", { headers: { cookie: session! } })).json()).toEqual({ authorized: false });
    expect((await get("/api/auth/me", { headers: { cookie: session! } })).status).toBe(401);
  });

  it("logout clears the cookie", async () => {
    const r = await fetch(base + "/api/auth/logout", { method: "POST" });
    expect(r.headers.getSetCookie()[0]).toContain("Max-Age=0");
  });

  describe("when REQUIRE_GOOGLE_LOGIN=1", () => {
    beforeEach(() => { process.env["REQUIRE_GOOGLE_LOGIN"] = "1"; });

    it("blocks everything except health and the login flow, for anonymous and legacy-token callers", async () => {
      const r = await get("/api/probe");
      expect(r.status).toBe(401);
      expect(await r.json()).toMatchObject({ loginRequired: true });
      expect((await get("/api/probe", { headers: { "x-admin-password": "some-legacy-token" } })).status).toBe(401);
      expect((await get("/api/healthz")).status).toBe(200);
      expect((await get("/api/auth/login")).status).toBe(302);
      const me = await get("/api/auth/me");
      expect(me.status).toBe(401);
      expect(await me.json()).toMatchObject({ loginRequired: true, configured: true });
    });

    it("still lets server-to-server pushers in with the raw admin password", async () => {
      const r = await get("/api/probe", { headers: { "x-admin-password": ADMIN } });
      expect(r.status).toBe(200);
    });

    it("lets a logged-in whitelisted account in", async () => {
      const { session } = await loginAs("me@gmail.com");
      const r = await get("/api/probe", { headers: { cookie: session! } });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ authorized: true });
    });

    it("fails closed when login is required but not configured", async () => {
      process.env["ALLOWED_GOOGLE_EMAILS"] = "";
      expect((await get("/api/probe")).status).toBe(401);
      expect((await get("/api/auth/login")).status).toBe(503);
      expect((await get("/api/probe", { headers: { "x-admin-password": ADMIN } })).status).toBe(200);
    });
  });
});
