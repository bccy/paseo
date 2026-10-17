import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useCloseFileExplorerGesture } from "@/mobile-panels/gestures";
import { useIsMobilePanelActive } from "@/mobile-panels/provider";
import { MobilePanelOverlay } from "@/mobile-panels/presentation";
import { HEADER_TOP_PADDING_MOBILE } from "@/constants/layout";
import { RetainedPanelActivity } from "@/components/retained-panel";
import { SidebarResizeHandle } from "@/components/sidebar-resize-handle";
import {
  SIDEBAR_RESIZE_ACTIVATION_OFFSET,
  SIDEBAR_RESIZE_FAIL_OFFSET,
} from "@/components/sidebar-resize-handle-layout";
import { resolveExplorerSidebarWidth } from "@/components/explorer-sidebar-layout";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";

interface ExplorerSidebarProps {
  children: React.ReactNode;
  surfaceColor?: string;
}

function CompactExplorerSidebarBase({ children, surfaceColor }: ExplorerSidebarProps) {
  const insets = useSafeAreaInsets();
  const isActive = useIsMobilePanelActive("file-explorer");
  const { gesture: closeGesture } = useCloseFileExplorerGesture();

  const mobileSidebarStyle = useMemo(
    () => [
      {
        paddingTop: insets.top + HEADER_TOP_PADDING_MOBILE,
        backgroundColor: surfaceColor,
      },
    ],
    [insets.top, surfaceColor],
  );

  return (
    <RetainedPanelActivity active={isActive}>
      <MobilePanelOverlay
        panel="file-explorer"
        closeGesture={closeGesture}
        panelStyle={mobileSidebarStyle}
      >
        {children}
      </MobilePanelOverlay>
    </RetainedPanelActivity>
  );
}

interface NativeExplorerSidebarDockProps extends ExplorerSidebarProps {
  persistenceKey: string;
  containerWidth: number;
  isOpen: boolean;
}

function NativeExplorerSidebarDockBase({
  surfaceColor,
  children,
  persistenceKey,
  containerWidth,
  isOpen,
}: NativeExplorerSidebarDockProps) {
  const insets = useSafeAreaInsets();
  const storedWidth = useWorkspaceLayoutStore(
    (state) => state.explorerSidebarWidthByWorkspace[persistenceKey],
  );
  const resizeExplorerSidebar = useWorkspaceLayoutStore((state) => state.resizeExplorerSidebar);
  const visibleWidth = resolveExplorerSidebarWidth({
    requestedWidth: storedWidth,
    containerWidth,
  });
  const resizeWidth = useSharedValue(visibleWidth);
  const startWidth = useSharedValue(visibleWidth);
  const [resizePressed, setResizePressed] = useState(false);
  useEffect(() => {
    resizeWidth.value = visibleWidth;
  }, [resizeWidth, visibleWidth]);

  const showResizeGrip = useCallback(() => setResizePressed(true), []);
  const hideResizeGrip = useCallback(() => setResizePressed(false), []);
  const commitWidth = useCallback(
    (width: number) => resizeExplorerSidebar(persistenceKey, width),
    [persistenceKey, resizeExplorerSidebar],
  );
  const resizeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(true)
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .onBegin(() => scheduleOnRN(showResizeGrip))
        .activeOffsetX([-SIDEBAR_RESIZE_ACTIVATION_OFFSET, SIDEBAR_RESIZE_ACTIVATION_OFFSET])
        .failOffsetY([-SIDEBAR_RESIZE_FAIL_OFFSET, SIDEBAR_RESIZE_FAIL_OFFSET])
        .onStart((event) => {
          startWidth.value = visibleWidth + event.translationX;
          resizeWidth.value = visibleWidth;
        })
        .onUpdate((event) => {
          resizeWidth.value = resolveExplorerSidebarWidth({
            requestedWidth: startWidth.value - event.translationX,
            containerWidth,
          });
        })
        .onEnd(() => runOnJS(commitWidth)(resizeWidth.value))
        .onFinalize(() => scheduleOnRN(hideResizeGrip)),
    [
      commitWidth,
      containerWidth,
      hideResizeGrip,
      resizeWidth,
      showResizeGrip,
      startWidth,
      visibleWidth,
    ],
  );
  const animatedWidthStyle = useAnimatedStyle(() => ({ width: resizeWidth.value }));
  const dockStyle = useMemo(
    () => [
      { flexShrink: 0, minHeight: 0 },
      {
        display: isOpen ? ("flex" as const) : ("none" as const),
        paddingTop: insets.top + HEADER_TOP_PADDING_MOBILE,
        backgroundColor: surfaceColor,
      },
      animatedWidthStyle,
    ],
    [animatedWidthStyle, insets.top, isOpen, surfaceColor],
  );
  return (
    <RetainedPanelActivity active={isOpen}>
      <Animated.View style={dockStyle} testID="native-explorer-sidebar-dock">
        <View style={styles.nativeDockContent}>
          <SidebarResizeHandle
            edge="left"
            gesture={resizeGesture}
            pressed={resizePressed}
            testID="native-explorer-sidebar-resize-handle"
          />
          {children}
        </View>
      </Animated.View>
    </RetainedPanelActivity>
  );
}

const styles = StyleSheet.create((theme) => ({
  nativeDockContent: {
    flex: 1,
    minHeight: 0,
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
  },
}));

export const CompactExplorerSidebar = withUnistyles(CompactExplorerSidebarBase, (theme) => ({
  surfaceColor: theme.colors.surfaceSidebar,
}));
export const NativeExplorerSidebarDock = withUnistyles(NativeExplorerSidebarDockBase, (theme) => ({
  surfaceColor: theme.colors.surfaceSidebar,
}));
