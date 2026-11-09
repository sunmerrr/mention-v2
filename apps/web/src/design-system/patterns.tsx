import type { ReactNode } from "react";
import { Box, Card, Dialog, Flex, Heading, Text } from "./primitives";

export function PageHeader({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Flex
      className={`page-heading ${className}`}
      justify="between"
      align="center"
      gap="4"
      wrap="wrap"
    >
      <Box>
        <Heading as="h1" size="6">
          {title}
        </Heading>
        {description && (
          <Text as="p" color="gray" size="2" mt="2">
            {description}
          </Text>
        )}
      </Box>
      {actions && (
        <Flex
          className="page-header-actions"
          align="center"
          justify="end"
          gap="2"
          wrap="wrap"
        >
          {actions}
        </Flex>
      )}
      {children}
    </Flex>
  );
}
export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="section-card">
      <Flex justify="between" align="center" gap="3" wrap="wrap" mb="4">
        <Box>
          <Heading as="h2" size="4">
            {title}
          </Heading>
          {description && (
            <Text as="p" size="2" color="gray" mt="1">
              {description}
            </Text>
          )}
        </Box>
        {actions}
      </Flex>
      {children}
    </Card>
  );
}
export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Box>
      <Text
        as="label"
        htmlFor={id}
        size="2"
        weight="medium"
        mb="2"
        style={{ display: "block" }}
      >
        {label}
      </Text>
      {children}
      {hint && (
        <Text as="p" id={`${id}-hint`} size="1" color="gray" mt="2">
          {hint}
        </Text>
      )}
    </Box>
  );
}
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <Flex
      className="scope-controls"
      gap="2"
      align="center"
      justify="end"
      wrap="wrap"
    >
      {children}
    </Flex>
  );
}
export function DialogContent({
  title,
  description,
  status,
  children,
}: {
  title: string;
  description: string;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog.Content maxWidth="620px">
      <Flex align="center" gap="3" mb="2">
        <Dialog.Title mb="0">{title}</Dialog.Title>
        {status}
      </Flex>
      <Dialog.Description size="2" mb="4">
        {description}
      </Dialog.Description>
      {children}
    </Dialog.Content>
  );
}

export function DetailLayout({
  content,
  aside,
  stickyAside = false,
}: {
  content: ReactNode;
  aside: ReactNode;
  stickyAside?: boolean;
}) {
  return (
    <div
      className={`detail-layout ${stickyAside ? "detail-layout--sticky-aside" : ""}`}
    >
      <div className="detail-content">{content}</div>
      <aside className="detail-aside" aria-label="대화 분석과 관리">
        {aside}
      </aside>
    </div>
  );
}
export function Disclosure({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="ds-disclosure">
      <summary>{title}</summary>
      <Box pt="3">{children}</Box>
    </details>
  );
}
