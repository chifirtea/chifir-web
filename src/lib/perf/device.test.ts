import { describe, expect, it } from "vitest";
import { shortGpuName } from "./device";

describe("shortGpuName", () => {
  it("recognises common renderer strings", () => {
    expect(shortGpuName("ANGLE (Apple, Apple M2 Pro, OpenGL 4.1)")).toBe("Apple M2 Pro");
    expect(shortGpuName("Apple GPU")).toBe("Apple GPU");
    expect(shortGpuName("ANGLE (Qualcomm, Adreno (TM) 730, OpenGL ES 3.2)")).toBe("Adreno 730");
    expect(shortGpuName("ANGLE (ARM, Mali-G78 MP14, OpenGL ES 3.2)")).toBe("Mali-G78");
    expect(shortGpuName("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("NVIDIA RTX 3060");
    expect(shortGpuName("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)")).toBe("Software (SwiftShader)");
    expect(shortGpuName("ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, OpenGL 4.6)")).toMatch(/^Intel Iris/);
    expect(shortGpuName(undefined)).toBeUndefined();
  });
});
