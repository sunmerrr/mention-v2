import { Button as RadixButton, Card as RadixCard } from "@radix-ui/themes";
import {
  type ComponentPropsWithoutRef,
  type ComponentRef,
  forwardRef,
} from "react";

export {
  Badge,
  Box,
  Callout,
  Checkbox,
  Dialog,
  Flex,
  Grid,
  Heading,
  Popover,
  RadioCards,
  Select,
  Separator,
  Spinner,
  Table,
  Tabs,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";

type Intent = "primary" | "secondary" | "quiet" | "danger";
const actionStyles = {
  primary: { variant: "solid" },
  secondary: { variant: "soft", color: "gray" },
  quiet: { variant: "ghost", color: "gray" },
  danger: { variant: "solid", color: "red" },
} as const;
export type ButtonProps = ComponentPropsWithoutRef<typeof RadixButton> & {
  intent?: Intent;
};
// Preserve Radix's asChild, focus handling, loading, form and ref contracts.
export const Button = forwardRef<ComponentRef<typeof RadixButton>, ButtonProps>(
  function Button({ intent = "primary", size = "2", ...props }, ref) {
    return (
      <RadixButton ref={ref} size={size} {...actionStyles[intent]} {...props} />
    );
  },
);
export const Card = forwardRef<
  ComponentRef<typeof RadixCard>,
  ComponentPropsWithoutRef<typeof RadixCard>
>(function Card({ variant = "surface", ...props }, ref) {
  return <RadixCard ref={ref} variant={variant} {...props} />;
});
