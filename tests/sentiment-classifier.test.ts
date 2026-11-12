import { execFileSync } from "node:child_process";
import { test } from "vitest";

test("sentiment automation preserves humans, evidence and uncertain-write reservations", () => {
  execFileSync(
    "python3",
    ["-m", "unittest", "tests/sentiment_classifier_check.py", "-q"],
    { cwd: process.cwd(), stdio: "pipe" },
  );
});
