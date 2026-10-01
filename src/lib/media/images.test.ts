import { afterEach, describe, expect, it } from "vitest";
import {
  imageSrcSet,
  isAbsoluteUrl,
  isTextureUrl,
  mediaUrl,
  resolveImage,
  setImageCdnBase,
  setImageOptimizer,
  templateOptimizer,
  textureImageWidth,
} from "./images";
import { monogram } from "./monogram";

afterEach(() => {
  setImageOptimizer(null);
  setImageCdnBase(null);
});

describe("resolveImage", () => {
  it("passes absolute URLs through untouched", () => {
    const url = "https://cdn.example.com/a/b.jpg?x=1";
    expect(resolveImage(url)).toBe(url);
    expect(resolveImage("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(resolveImage("//cdn.example.com/x.png")).toBe("//cdn.example.com/x.png");
    expect(isAbsoluteUrl("blob:https://x/y")).toBe(true);
    expect(isAbsoluteUrl("assets/x.png")).toBe(false);
  });

  it("serves relative paths from /public without a CDN base", () => {
    setImageCdnBase("");
    expect(resolveImage("assets/hero.jpg")).toBe("/assets/hero.jpg");
    expect(resolveImage("/assets/hero.jpg")).toBe("/assets/hero.jpg");
  });

  it("prefixes relative paths with the CDN base (trailing slashes normalised)", () => {
    setImageCdnBase("https://media.chifir.example/");
    expect(resolveImage("merchants/kori/hero.jpg")).toBe("https://media.chifir.example/merchants/kori/hero.jpg");
    expect(resolveImage("/merchants/kori/hero.jpg")).toBe("https://media.chifir.example/merchants/kori/hero.jpg");
  });

  it("accepts MediaRef objects and empty refs", () => {
    expect(resolveImage({ url: "https://x/y.png", alt: "y" })).toBe("https://x/y.png");
    expect(resolveImage(undefined)).toBe("");
    expect(resolveImage("   ")).toBe("");
    expect(mediaUrl({ url: " https://x/y.png " })).toBe("https://x/y.png");
    expect(mediaUrl("")).toBeUndefined();
  });

  it("routes through the optimizer once one is configured", () => {
    setImageOptimizer(templateOptimizer("https://img.example/?url={url}&w={width}&h={height}&q={quality}"));
    expect(resolveImage("https://x/y.png", { width: 640, quality: 70 })).toBe(
      "https://img.example/?url=https%3A%2F%2Fx%2Fy.png&w=640&h=&q=70",
    );
  });
});

describe("texture helpers", () => {
  it("caps texture requests at 1024 and never below 256", () => {
    expect(textureImageWidth(512)).toBe(512);
    expect(textureImageWidth(1024)).toBe(1024);
    expect(textureImageWidth(2048)).toBe(1024);
    expect(textureImageWidth(64)).toBe(256);
  });

  it("accepts same-origin paths and http(s)/data/blob URLs as textures, nothing else", () => {
    expect(isTextureUrl("/assets/hero.jpg")).toBe(true);
    expect(isTextureUrl("https://cdn.example.com/a.jpg")).toBe(true);
    expect(isTextureUrl("//cdn.example.com/a.jpg")).toBe(true);
    expect(isTextureUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isTextureUrl("blob:https://x/y")).toBe(true);
    expect(isTextureUrl("javascript:alert(1)")).toBe(false);
    expect(isTextureUrl("ftp://x/y.png")).toBe(false);
    expect(isTextureUrl("")).toBe(false);
  });
});

describe("imageSrcSet", () => {
  it("is empty without an optimizer (every candidate would be the same file)", () => {
    expect(imageSrcSet("https://x/y.png")).toBe("");
  });

  it("emits one ascending candidate per width with an optimizer", () => {
    setImageOptimizer((url, o) => `${url}?w=${o.width}`);
    expect(imageSrcSet("https://x/y.png", [960, 320])).toBe("https://x/y.png?w=320 320w, https://x/y.png?w=960 960w");
  });

  it("collapses duplicate candidates", () => {
    setImageOptimizer((url) => url);
    expect(imageSrcSet("https://x/y.png", [320, 640])).toBe("");
  });
});

describe("monogram", () => {
  it("takes the first letters of the significant words", () => {
    expect(monogram("Ember & Oak")).toBe("EO");
    expect(monogram("Kōri Ramen")).toBe("KR");
    expect(monogram("Northline")).toBe("N");
    expect(monogram("The Hall")).toBe("H");
    expect(monogram("Night Shift Hoodie — Ink", 3)).toBe("NSH");
  });

  it("never returns an empty mark", () => {
    expect(monogram("")).toBe("•");
    expect(monogram("&&")).toBe("•");
    expect(monogram(undefined)).toBe("•");
  });
});
