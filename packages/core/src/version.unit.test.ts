import { describe, expect, it } from "vitest";

import { CORE_VERSION } from "./index";

describe("core version", () => {
  it("is defined", () => {
    expect(CORE_VERSION).toBeTypeOf("string");
    expect(CORE_VERSION.length).toBeGreaterThan(0);
  });
});
