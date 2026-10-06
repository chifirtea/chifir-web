import { describe, expect, it } from "vitest";
import { detectInitialQuality, isMobileDevice, tierFromSignals } from "./detectQuality";

describe("tierFromSignals", () => {
  it("defaults desktop to high and mobile to medium", () => {
    expect(tierFromSignals({ mobile: false })).toBe("high");
    expect(tierFromSignals({ mobile: true })).toBe("medium");
  });

  it("gives a capable desktop high", () => {
    expect(
      tierFromSignals({
        mobile: false,
        cores: 12,
        deviceMemory: 8,
        gpu: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
      }),
    ).toBe("high");
    expect(tierFromSignals({ mobile: false, cores: 8, gpu: "Apple M2" })).toBe("high");
  });

  it("drops desktops with integrated Intel HD/UHD graphics to medium", () => {
    expect(
      tierFromSignals({
        mobile: false,
        cores: 8,
        gpu: "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)",
      }),
    ).toBe("medium");
    expect(tierFromSignals({ mobile: false, cores: 8, gpu: "Intel(R) HD Graphics 4000" })).toBe(
      "medium",
    );
    expect(tierFromSignals({ mobile: false, cores: 8, gpu: "Intel Iris Plus Graphics 655" })).toBe(
      "medium",
    );
  });

  it("keeps Intel Iris Xe / Arc desktops on high", () => {
    expect(
      tierFromSignals({
        mobile: false,
        cores: 8,
        gpu: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
      }),
    ).toBe("high");
    expect(tierFromSignals({ mobile: false, cores: 16, gpu: "Intel(R) Arc(TM) A770" })).toBe(
      "high",
    );
  });

  it("drops desktops with 4 or fewer cores to medium", () => {
    expect(tierFromSignals({ mobile: false, cores: 4, gpu: "NVIDIA GeForce GTX 1080" })).toBe(
      "medium",
    );
    expect(tierFromSignals({ mobile: false, cores: 2 })).toBe("medium");
  });

  it("drops phones with little memory or few cores to low", () => {
    expect(tierFromSignals({ mobile: true, deviceMemory: 3, cores: 8 })).toBe("low");
    expect(tierFromSignals({ mobile: true, deviceMemory: 2 })).toBe("low");
    expect(tierFromSignals({ mobile: true, cores: 4 })).toBe("low");
    expect(tierFromSignals({ mobile: true, deviceMemory: 4, cores: 8 })).toBe("medium");
  });

  it("drops phones with known weak GPUs to low", () => {
    const weak = [
      "Mali-450 MP",
      "Mali-T720",
      "Mali-T760",
      "Adreno (TM) 306",
      "Adreno (TM) 430",
      "Adreno (TM) 530",
      "PowerVR Rogue GE8320",
      "Apple A10 GPU",
    ];
    for (const gpu of weak) {
      expect(tierFromSignals({ mobile: true, cores: 8, deviceMemory: 6, gpu }), gpu).toBe("low");
    }
  });

  it("keeps phones with capable GPUs on medium", () => {
    const fine = ["Adreno (TM) 740", "Mali-G78", "Apple GPU", "Apple A15 GPU", "Mali-G610 MC6"];
    for (const gpu of fine) {
      expect(tierFromSignals({ mobile: true, cores: 8, deviceMemory: 6, gpu }), gpu).toBe("medium");
    }
  });

  it("forces low on software rasterisers regardless of form factor", () => {
    expect(tierFromSignals({ mobile: false, cores: 16, gpu: "Google SwiftShader" })).toBe("low");
    expect(
      tierFromSignals({ mobile: false, cores: 16, gpu: "llvmpipe (LLVM 15.0.7, 256 bits)" }),
    ).toBe("low");
    expect(tierFromSignals({ mobile: true, gpu: "Microsoft Basic Render Driver" })).toBe("low");
  });
});

describe("isMobileDevice", () => {
  it("recognises phones and tablets from the UA", () => {
    expect(
      isMobileDevice(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
        5,
      ),
    ).toBe(true);
    expect(
      isMobileDevice(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
        5,
      ),
    ).toBe(true);
  });

  it("recognises iPadOS masquerading as a Mac by its touch points", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";
    expect(isMobileDevice(ua, 5)).toBe(true);
    expect(isMobileDevice(ua, 0)).toBe(false);
  });

  it("treats desktops (including touch-screen laptops) as not mobile", () => {
    expect(
      isMobileDevice(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        10,
      ),
    ).toBe(false);
    expect(isMobileDevice("Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0", 0)).toBe(false);
  });
});

describe("detectInitialQuality", () => {
  it("is safe to call without a browser", () => {
    expect(detectInitialQuality()).toEqual({ tier: "medium", mobile: false });
  });
});
