import { describe, expect, it } from "vitest";
import { checkRawPath, isInsideRoot, rawContentDisposition, stripPullPrefix } from "./rawFile";

describe("checkRawPath", () => {
  it.each([
    ["人類/公文.pdf", "application/pdf", "inline"],
    ["公文.pdf", "application/pdf", "inline"],
    ["人類/照片.PNG", "image/png", "inline"],
    ["人類/a.jpeg", "image/jpeg", "inline"],
    ["人類/a.webp", "image/webp", "inline"],
    ["人類/紀錄.txt", "text/plain; charset=utf-8", "inline"],
    ["人類/名冊.csv", "text/csv; charset=utf-8", "inline"],
    ["人類/契約.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "attachment"],
    ["人類/預算.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "attachment"],
    ["人類/簡報.ppt", "application/vnd.ms-powerpoint", "attachment"],
    ["人類/掃描.tiff", "image/tiff", "attachment"],
  ])("accepts %s", (p, type, disposition) => {
    const r = checkRawPath(p);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.contentType).toBe(type);
      expect(r.disposition).toBe(disposition);
    }
  });

  it("strips the 人類/ prefix from rel", () => {
    const r = checkRawPath("人類/案件/x.pdf");
    expect(r.ok && r.rel).toBe("案件/x.pdf");
    const bare = checkRawPath("案件/x.pdf");
    expect(bare.ok && bare.rel).toBe("案件/x.pdf");
  });

  it.each([
    ["not a string", 5],
    ["undefined", undefined],
    ["empty", ""],
    ["prefix only", "人類/"],
    ["traversal", "人類/../secret.pdf"],
    ["traversal in middle", "a/../../b.pdf"],
    ["dot segment", "人類/./a.pdf"],
    ["double slash", "人類//a.pdf"],
    ["absolute posix", "/etc/passwd"],
    ["absolute windows", "C:/x.pdf"],
    ["backslash", "人類\\a.pdf"],
    ["NUL byte", "人類/a\0.pdf"],
    ["hidden file", "人類/.stignore"],
    ["hidden folder", "人類/.trash/a.pdf"],
  ])("rejects %s with 400", (_name, p) => {
    const r = checkRawPath(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it.each([
    ["人類/a.exe"],
    ["人類/a.html"],
    ["人類/a.svg"],
    ["人類/a"],
  ])("rejects unsupported type %s with 415", (p) => {
    const r = checkRawPath(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(415);
  });
});

describe("rawContentDisposition", () => {
  it("encodes non-ASCII names and keeps the chosen disposition", () => {
    expect(rawContentDisposition("公文.pdf", "inline")).toBe("inline; filename*=UTF-8''%E5%85%AC%E6%96%87.pdf");
    expect(rawContentDisposition("契約.docx", "attachment")).toMatch(/^attachment; filename\*=UTF-8''/);
  });
});

describe("isInsideRoot", () => {
  it("accepts the root itself and children, rejects siblings with the same prefix", () => {
    expect(isInsideRoot("/data/raw", "/data/raw", "/")).toBe(true);
    expect(isInsideRoot("/data/raw", "/data/raw/a.pdf", "/")).toBe(true);
    expect(isInsideRoot("/data/raw", "/data/raw2/a.pdf", "/")).toBe(false);
    expect(isInsideRoot("/data/raw", "/etc/passwd", "/")).toBe(false);
  });
});

describe("stripPullPrefix", () => {
  it("leaves paths without a pull prefix alone", () => {
    expect(stripPullPrefix("案A/y.pdf")).toBe("案A/y.pdf");
    expect(stripPullPrefix("_pulled-from-homex/y.pdf")).toBe("_pulled-from-homex/y.pdf");
  });

  it("strips each known prefix once", () => {
    expect(stripPullPrefix("_pulled-from-home/案A/y.pdf")).toBe("案A/y.pdf");
    expect(stripPullPrefix("_staging-from-home/案A/y.pdf")).toBe("案A/y.pdf");
  });

  it("strips repeated and mixed prefixes", () => {
    expect(stripPullPrefix("_staging-from-home/_pulled-from-home/案A/y.pdf")).toBe("案A/y.pdf");
    expect(stripPullPrefix("_pulled-from-home/_pulled-from-home/案A/y.pdf")).toBe("案A/y.pdf");
  });
});
