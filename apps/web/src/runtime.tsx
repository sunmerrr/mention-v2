import { createContext, useContext } from "react";
export const RuntimeContext = createContext({
  writesEnabled: false,
  local: false,
});
export const useRuntime = () => useContext(RuntimeContext);
