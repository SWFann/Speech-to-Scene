// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";

import { resolveBaseUrl } from "../../../web/src/api/review-api.js";

describe("resolveBaseUrl", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("uses a valid numeric port query for loopback API URL", () => {
    window.history.replaceState(null, "", "/?port=3210");

    expect(resolveBaseUrl()).toBe("http://127.0.0.1:3210");
  });

  it.each(["abc", "3210@evil.test", "3210/path", "0", "65536"])(
    "ignores invalid port query value %s",
    (port) => {
      window.history.replaceState(null, "", `/?port=${encodeURIComponent(port)}`);

      expect(resolveBaseUrl()).toBe(window.location.origin);
    },
  );
});
