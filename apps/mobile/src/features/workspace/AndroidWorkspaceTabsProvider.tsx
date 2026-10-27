import type { NavigationState } from "@react-navigation/native";
import { createContext, use, type ReactNode } from "react";
import { Platform } from "react-native";
import { androidWorkspaceSettingsOpen } from "./android-workspace-tabs";
import { WorkspaceTabsProvider } from "./WorkspaceTabsContext";

interface AndroidWorkspaceRoot {
  /**
   * The rail's `useNavigation()` dispatches to the focused navigator, which may be nested Settings.
   * Target the root stack's key (and read `rootNavigationRef`'s state) so a tab press resets the root.
   */
  readonly key: string;
  /** Settings is derived from navigation rather than kept in the tab reducer. */
  readonly settingsOpen: boolean;
}

const AndroidWorkspaceRootContext = createContext<AndroidWorkspaceRoot | null>(null);

export function useAndroidWorkspaceRoot() {
  return use(AndroidWorkspaceRootContext);
}

/** Android keeps one tab controller above the root navigator and split sidebar. */
export function AndroidWorkspaceTabsProvider(props: {
  readonly state: NavigationState;
  readonly children: ReactNode;
}) {
  const key = props.state.key;
  const settingsOpen = Platform.OS === "android" && androidWorkspaceSettingsOpen(props.state);
  const root = { key, settingsOpen };
  return Platform.OS === "android" ? (
    <WorkspaceTabsProvider>
      <AndroidWorkspaceRootContext value={root}>{props.children}</AndroidWorkspaceRootContext>
    </WorkspaceTabsProvider>
  ) : (
    props.children
  );
}
