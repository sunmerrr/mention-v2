import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import {
  Box,
  Card,
  Checkbox,
  Dialog,
  Flex,
  Heading,
  Table,
  Text,
} from "./primitives";

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

export function SelectionPanel({
  title,
  description,
  items,
  selected,
  onSelectionChange,
  action,
  footer,
  disabled = false,
  empty,
}: {
  title: string;
  description: string;
  items: { id: string; label: string }[];
  selected: string[];
  onSelectionChange: (ids: string[]) => void;
  action?: ReactNode;
  footer?: ReactNode;
  disabled?: boolean;
  empty: string;
}) {
  const all =
    items.length > 0 && items.every((item) => selected.includes(item.id));
  return (
    <section aria-label={title}>
      <Card className="section-card">
        <div className="selection-panel-header">
          <Box>
            <Heading as="h2" size="4">
              {title}
            </Heading>
            <Text as="p" size="2" color="gray" mt="1">
              {description}
            </Text>
          </Box>
          <div className="selection-panel-action">{action}</div>
        </div>
        {items.length > 0 ? (
          <>
            <Text as="label" size="1" color="gray" className="selection-all">
              <Checkbox
                disabled={disabled}
                checked={all ? true : selected.length ? "indeterminate" : false}
                onCheckedChange={() =>
                  onSelectionChange(all ? [] : items.map((item) => item.id))
                }
              />
              이 페이지 전체 선택
            </Text>
            <div className="selection-items">
              {items.map((item) => (
                <Text
                  as="label"
                  key={item.id}
                  size="2"
                  className="selection-item"
                >
                  <Checkbox
                    disabled={disabled}
                    aria-label={`${item.label} 선택`}
                    checked={selected.includes(item.id)}
                    onCheckedChange={(checked) =>
                      onSelectionChange(
                        checked === true
                          ? [...selected, item.id]
                          : selected.filter((id) => id !== item.id),
                      )
                    }
                  />
                  <span>{item.label}</span>
                </Text>
              ))}
            </div>
          </>
        ) : (
          <Box py="5">
            <Text as="p" size="2" color="gray">
              {empty}
            </Text>
          </Box>
        )}
        {footer}
      </Card>
    </section>
  );
}

export function MetricCard({
  label,
  icon,
  value,
  unit,
  description,
  children,
}: {
  label: string;
  icon: ReactNode;
  value: ReactNode;
  unit?: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <Card className="metric-card">
      <Flex align="center" gap="2">
        <Box as="span" aria-hidden="true">
          {icon}
        </Box>
        <Text size="2" color="gray">
          {label}
        </Text>
      </Flex>
      <Flex align="baseline" gap="2" mt="3">
        <Text size="7" weight="bold">
          {value}
        </Text>
        {unit && (
          <Text size="2" color="gray">
            {unit}
          </Text>
        )}
      </Flex>
      <Text as="p" size="2" color="gray" mt="2">
        {description}
      </Text>
      {children && (
        <Box className="metric-card-action" mt="3">
          {children}
        </Box>
      )}
    </Card>
  );
}

export function PreviewDisclosure({
  title,
  metadata,
  preview,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  metadata?: ReactNode;
  preview: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details
      className="ds-preview-disclosure"
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
    >
      <summary>
        <Flex gap="2" align="center" wrap="wrap">
          <Text size="2" weight="medium">
            {title}
          </Text>
          {metadata}
        </Flex>
        <div>{preview}</div>
        <ChevronDown
          size={16}
          className="ds-preview-chevron"
          aria-hidden="true"
        />
      </summary>
      <Box className="ds-preview-editor">{children}</Box>
    </details>
  );
}

/** A bounded reading column and readable metadata, with keyboard scrolling. */
export function ReadingTable({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <Text as="p" size="1" color="gray" className="ds-reading-table-hint">
        표를 좌우로 움직여 나머지 항목을 볼 수 있습니다.
      </Text>
      <Box
        className="ds-reading-table"
        role="region"
        aria-label={label}
        tabIndex={0}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            !["ArrowLeft", "ArrowRight"].includes(event.key)
          )
            return;
          // Table.Root owns its ScrollArea viewport, so adapt region keyboard
          // navigation here rather than replacing the vendor scrolling control.
          const viewport = event.currentTarget.querySelector<HTMLElement>(
            "[data-radix-scroll-area-viewport]",
          );
          if (viewport && viewport.scrollWidth > viewport.clientWidth) {
            viewport.scrollBy({
              left:
                ((event.key === "ArrowRight" ? 1 : -1) * viewport.clientWidth) /
                2,
            });
            event.preventDefault();
          }
        }}
      >
        <Table.Root>{children}</Table.Root>
      </Box>
    </>
  );
}
