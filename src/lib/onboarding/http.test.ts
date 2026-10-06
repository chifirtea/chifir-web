import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isJsonContentType, parseAdminBody } from "./http";

describe("parseAdminBody", () => {
  const schema = z.strictObject({ url: z.string() });
  const request = (contentType: string | null, body: string) =>
    new NextRequest("http://localhost:3100/api/admin/drafts/extract", {
      method: "POST",
      body,
      headers: contentType ? { "content-type": contentType } : {},
    });

  it("accepts only application/json (a text/plain POST needs no CORS preflight)", () => {
    expect(isJsonContentType("application/json")).toBe(true);
    expect(isJsonContentType("Application/JSON; charset=utf-8")).toBe(true);
    expect(isJsonContentType("text/plain")).toBe(false);
    expect(isJsonContentType("application/x-www-form-urlencoded")).toBe(false);
    expect(isJsonContentType("multipart/form-data; boundary=x")).toBe(false);
    expect(isJsonContentType("application/jsonp")).toBe(false);
    expect(isJsonContentType(null)).toBe(false);
  });

  it("refuses a text/plain body with 415 before parsing it", async () => {
    const r = await parseAdminBody(request("text/plain", '{"url":"https://10.0.0.1/"}'), schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(415);
    const missing = await parseAdminBody(request(null, '{"url":"x"}'), schema);
    expect(missing.ok).toBe(false);
  });

  it("parses a JSON body against the schema", async () => {
    const r = await parseAdminBody(request("application/json", '{"url":"https://shop.example"}'), schema);
    expect(r).toEqual({ ok: true, data: { url: "https://shop.example" } });
    const bad = await parseAdminBody(request("application/json", '{"url":1}'), schema);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.response.status).toBe(400);
  });
});
