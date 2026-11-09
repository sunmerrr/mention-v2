import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";
import type { WorkspaceAction } from "../../../../packages/application/src/workspace";
import { Box, Button, Flex, PageHeader, Text } from "../design-system";
import { useRuntime } from "../runtime";
export interface PageSaveSpec {
  action: WorkspaceAction;
  label: string;
  localOnly?: boolean;
}
const PageSaveContext = createContext<{
  actions: PageSaveSpec[];
  setBusy: (action: WorkspaceAction, busy: boolean) => void;
  reportNotice: (
    action: WorkspaceAction,
    notice: string,
    error: boolean,
  ) => void;
} | null>(null);
export const pageFormId = (action: WorkspaceAction) => `page-save-${action}`;
export const usePageSave = () => useContext(PageSaveContext);
export function PageSaveLayout({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions: PageSaveSpec[];
  children: ReactNode;
}) {
  const runtime = useRuntime();
  const [busy, setBusy] = useState<Partial<Record<WorkspaceAction, boolean>>>(
    {},
  );
  const [notices, setNotices] = useState<
    Partial<Record<WorkspaceAction, { message: string; error: boolean }>>
  >({});
  const reportNotice = useCallback(
    (action: WorkspaceAction, message: string, error: boolean) => {
      setNotices((previous) => ({ ...previous, [action]: { message, error } }));
    },
    [],
  );
  return (
    <PageSaveContext.Provider
      value={{
        actions,
        reportNotice,
        setBusy: (action, value) =>
          setBusy((previous) => ({ ...previous, [action]: value })),
      }}
    >
      <PageHeader
        title={title}
        description={description}
        className={actions.length ? "page-save-heading" : ""}
        actions={
          actions.length > 0 && (
            <Flex
              gap="2"
              wrap="wrap"
              justify="end"
              className="page-save-actions"
            >
              {actions.map(({ action, label, localOnly }) => (
                <Button
                  key={action}
                  type="submit"
                  form={pageFormId(action)}
                  loading={busy[action]}
                  disabled={
                    !runtime.writesEnabled || (localOnly && !runtime.local)
                  }
                >
                  {label}
                </Button>
              ))}
            </Flex>
          )
        }
      >
        {actions.some(({ action }) => notices[action]?.message) && (
          <Box width="100%" role="status">
            {actions.map(({ action, label }) =>
              notices[action]?.message ? (
                <Text
                  as="p"
                  size="2"
                  align="right"
                  color={notices[action]?.error ? "red" : "gray"}
                  key={action}
                >
                  {actions.length > 1 ? `${label}: ` : ""}
                  {notices[action]?.message}
                </Text>
              ) : null,
            )}
          </Box>
        )}
      </PageHeader>
      {children}
    </PageSaveContext.Provider>
  );
}
