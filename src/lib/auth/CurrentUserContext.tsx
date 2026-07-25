import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { useCurrentUser, type CurrentUser } from "./useCurrentUser";

const CurrentUserContext = createContext<CurrentUser | null>(null);

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const current = useCurrentUser();
  return (
    <CurrentUserContext.Provider value={current}>
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrent(): CurrentUser {
  const ctx = useContext(CurrentUserContext);
  if (!ctx) {
    throw new Error("useCurrent must be used within CurrentUserProvider");
  }
  return ctx;
}
