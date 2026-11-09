import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve("apps/web/src");
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
describe("design system boundaries", () => {
  it("keeps vendor control imports inside the design system", () => {
    const violations = files(root)
      .filter(
        (file) =>
          /\.(ts|tsx)$/.test(file) &&
          !file.includes(`${path.sep}design-system${path.sep}`),
      )
      .filter((file) =>
        /(?:from\s*|import\s*\()\s*["']@radix-ui\//.test(
          readFileSync(file, "utf8"),
        ),
      );
    expect(violations).toEqual([]);
  });
  it("defines every semantic token used by product styles", () => {
    const css = files(root)
      .filter((file) => file.endsWith(".css"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const declared = new Set(
      [...css.matchAll(/(--mention-[\w-]+)\s*:/g)].map((match) => match[1]),
    );
    const used = [...css.matchAll(/var\((--mention-[\w-]+)/g)].map(
      (match) => match[1],
    );
    expect([...new Set(used)].filter((token) => !declared.has(token))).toEqual(
      [],
    );
  });
});
