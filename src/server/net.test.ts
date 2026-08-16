import { describe, expect, it } from "vitest";
import { clientIp, isPrivateIp, normalizeIp } from "./net.ts";

describe("net", () => {
  it("treats loopback and RFC1918 as private", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("192.168.1.10")).toBe(true);
    expect(isPrivateIp("10.0.0.5")).toBe(true);
    expect(isPrivateIp("172.16.0.2")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
  });

  it("reads the first forwarded address", () => {
    const headers = new Headers({ "x-forwarded-for": "192.168.1.50, 10.0.0.1" });
    expect(clientIp(headers, "127.0.0.1")).toBe("192.168.1.50");
    expect(normalizeIp("::ffff:10.1.2.3")).toBe("10.1.2.3");
  });
});
