import { describe, expect, it } from "vitest"
import { checkAttachmentPath, contentDisposition, nameCandidates } from "./attachmentFile"

describe("checkAttachmentPath", () => {
  it.each([
    ["附件/截圖1.png", "image/png"],
    ["附件/ailand測試/20260922_1544_常用定位查詢.PNG", "image/png"],
    ["附件/a.JPG", "image/jpeg"],
    ["附件/a.jpeg", "image/jpeg"],
    ["附件/公文.pdf", "application/pdf"],
    ["附件/紀錄.txt", "text/plain; charset=utf-8"],
    ["附件/note.md", "text/plain; charset=utf-8"],
  ])("accepts %s", (p, type) => {
    const r = checkAttachmentPath(p)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.contentType).toBe(type)
  })

  it("returns the path inside the attachments folder", () => {
    const r = checkAttachmentPath("附件/ailand測試/x.png")
    expect(r.ok && r.inner).toBe("ailand測試/x.png")
  })

  it.each([
    ["not a string", 5],
    ["empty", ""],
    ["outside the folder", "日記/2026-09-01.md"],
    ["prefix only trick", "附件x/a.png"],
    ["traversal", "附件/../日記/a.png"],
    ["traversal in the middle", "附件/a/../../b.png"],
    ["absolute", "/etc/passwd"],
    ["backslash", "附件\\a.png"],
    ["null byte", "附件/a.png\0.txt"],
    ["empty segment", "附件//a.png"],
    ["dot segment", "附件/./a.png"],
    ["hidden file", "附件/.stignore.txt"],
    ["hidden folder", "附件/.stfolder/a.png"],
    ["too long", "附件/" + "a".repeat(500) + ".png"],
  ])("rejects %s with 400", (_n, p) => {
    const r = checkAttachmentPath(p)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(400)
  })

  it.each(["附件/a.html", "附件/a.svg", "附件/a.js", "附件/a.exe", "附件/noext", "附件/a.png.exe", "附件/.png"])("rejects %s with 415 (or 400 for hidden)", (p) => {
    const r = checkAttachmentPath(p)
    expect(r.ok).toBe(false)
  })
})

describe("helpers", () => {
  it("encodes non-ascii and special characters in Content-Disposition", () => {
    expect(contentDisposition("截圖 (1).png")).toBe("inline; filename*=UTF-8''%E6%88%AA%E5%9C%96%20%281%29.png")
  })
  it("offers NFC and NFD spellings once each", () => {
    const nfd = "ガ.png".normalize("NFD")
    const c = nameCandidates(nfd)
    expect(c).toContain("ガ.png".normalize("NFC"))
    expect(new Set(c).size).toBe(c.length)
    expect(nameCandidates("a.png")).toEqual(["a.png"])
  })
})
