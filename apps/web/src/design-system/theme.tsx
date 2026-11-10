import { Theme } from "@radix-ui/themes";
import type { ReactNode } from "react";

// Shared by SSR and hydration; never branch on viewport or browser storage.
export function DesignSystemProvider({ children }: { children: ReactNode }) {
  return (
    <Theme
      accentColor="iris"
      grayColor="slate"
      radius="medium"
      scaling="100%"
      panelBackground="solid"
      appearance="light"
    >
      {children}
    </Theme>
  );
}
export const sentimentColors = {
  positive: "jade",
  negative: "red",
  neutral: "gray",
  mixed: "violet",
  uncertain: "amber",
  unreviewed: "gray",
  excluded: "gray",
} as const;
