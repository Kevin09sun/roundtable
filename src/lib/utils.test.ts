import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

// Trivial smoke test: confirms Vitest, TypeScript, and the `@/*` import
// alias are wired up correctly. Real tests land in later phases.
describe("cn", () => {
  it("merges class names, dropping falsy values", () => {
    expect(cn("a", false && "b", "c")).toBe("a c");
  });
});
