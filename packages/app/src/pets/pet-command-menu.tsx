import { memo, useCallback, useEffect, useMemo } from "react";
import { BackHandler, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { PressHighlight } from "@/components/ui/press-highlight";
import { DshIcon } from "@/components/icons/dsh-icon";
import { StyleSheet as ThemedStyleSheet } from "react-native-unistyles";
import type { PetSlashCommand } from "./pet-slash-commands";

/**
 * The desk pet's slash-command sheet.
 *
 * Extracted from `pet-overlay.tsx` so that file's render tree stops at the JSX
 * depth the project allows, and because the sheet has its own obligations the pet
 * sprite does not: it is a modal surface, so it owns the Android back button and
 * tells accessibility that it covers the screen.
 *
 * It is drawn with plain views on purpose — the overlay sits at the app root and
 * must not depend on a particular screen's bottom-sheet provider.
 */

/** Paseo's own mark, so its commands are visually distinct from DSH's. */
const PASEO_MARK = require("../../assets/images/favicon-light.png");

/**
 * One command row.
 *
 * A `memo` component rather than an inline render function: the row sits in a
 * horizontally scrolling `ScrollView`, and re-creating its `onPress` on every
 * parent render both re-renders the row and breaks the scroll view's ability to
 * keep a stable child.
 */
const CommandRow = memo(function CommandRow({
  command,
  onSelect,
}: {
  command: PetSlashCommand;
  onSelect: (command: PetSlashCommand) => void;
}) {
  const handlePress = useCallback(() => onSelect(command), [onSelect, command]);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.menuItemScroll}>
      {/*
        The row scrolls, so the ScrollView has to own the gesture: a pressable
        wrapping it would swallow the horizontal drag before the scroll view ever
        sees it. The row therefore sits inside, sized to the content it activates.
      */}
      <PressHighlight
        accessibilityRole="button"
        accessibilityLabel={`${command.label}：填入 ${command.insert}`}
        onPress={handlePress}
        style={styles.menuItem}
      >
        <View style={styles.menuItemRow}>
          {command.source === "paseo" ? (
            <Image source={PASEO_MARK} style={styles.menuItemMark} contentFit="contain" />
          ) : (
            <DshIcon size={16} />
          )}
          <Text style={styles.menuItemLabel}>{command.label}</Text>
        </View>
      </PressHighlight>
    </ScrollView>
  );
});

interface PetCommandMenuProps {
  readonly visible: boolean;
  readonly commands: readonly PetSlashCommand[];
  readonly onSelect: (command: PetSlashCommand) => void;
  readonly onClose: () => void;
  /** Bottom safe area, so the sheet clears the home indicator. */
  readonly bottomInset: number;
  /** Window height, for the capped scroll region. */
  readonly windowHeight: number;
}

export function PetCommandMenu({
  visible,
  commands,
  onSelect,
  onClose,
  bottomInset,
  windowHeight,
}: PetCommandMenuProps) {
  // Android's back gesture must close the sheet, not leave the app. Returning true
  // consumes the press; subscribing only while visible keeps the handler from
  // swallowing back presses on every other screen.
  useEffect(() => {
    if (!visible) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [visible, onClose]);

  const scrollHeight = useMemo(() => Math.min(windowHeight * 0.55, 420), [windowHeight]);

  // A stable mapper so the ScrollView's children do not change identity on every
  // parent render. `key` goes on the element because `map` cannot supply it.
  const renderRow = useCallback(
    (command: PetSlashCommand) => (
      <CommandRow key={command.name} command={command} onSelect={onSelect} />
    ),
    [onSelect],
  );
  // Memoised so the sheet's own style objects keep their identity across renders.
  const backdropStyle = useMemo(
    () => [styles.menuBackdrop, { paddingBottom: bottomInset + 12 }],
    [bottomInset],
  );
  const scrollStyle = useMemo(() => ({ maxHeight: scrollHeight }), [scrollHeight]);

  if (!visible) return null;

  return (
    <View
      style={backdropStyle}
      // A modal surface for assistive tech: the pet behind it is not reachable
      // while the sheet is open.
      accessibilityViewIsModal
    >
      <PressHighlight
        accessibilityRole="button"
        accessibilityLabel="关闭命令菜单"
        onPress={onClose}
        style={styles.menuDismiss}
      />
      <View style={styles.menuSheet}>
        <Text style={styles.menuTitle}>桌宠命令（选中后填入输入框）</Text>
        {/* The daemon can report a long command list, so the sheet scrolls inside a
            capped height instead of growing past the screen top. */}
        <ScrollView
          style={scrollStyle}
          contentContainerStyle={styles.menuScrollContent}
          showsVerticalScrollIndicator
        >
          {commands.map(renderRow)}
        </ScrollView>
        <PressHighlight
          accessibilityRole="button"
          accessibilityLabel="关闭命令菜单"
          onPress={onClose}
          style={styles.menuItem}
        >
          <Text style={styles.menuCancelLabel}>取消</Text>
        </PressHighlight>
      </View>
    </View>
  );
}

/**
 * The sheet's own styles.
 *
 * Unistyles (not `useUnistyles()`, which `docs/unistyles.md` bans): the Babel
 * plugin tracks the theme reads inside the factory, so a theme or colour-scheme
 * change repaints the sheet without re-rendering the whole overlay.
 */
const styles = ThemedStyleSheet.create((theme) => ({
  menuBackdrop: {
    ...StyleSheet.absoluteFill,
    justifyContent: "flex-end",
    // A dim scrim, not a themed surface: it has to darken whatever screen the sheet
    // opens over, in light and dark mode alike.
    backgroundColor: "rgba(0, 0, 0, 0.35)",
  },
  menuDismiss: {
    ...StyleSheet.absoluteFill,
  },
  menuSheet: {
    marginHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: theme.colors.background,
    borderColor: theme.colors.border,
  },
  menuTitle: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  menuScrollContent: {
    paddingBottom: 4,
  },
  menuItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuItemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  menuItemMark: {
    width: 16,
    height: 16,
    marginTop: 2,
  },
  menuItemScroll: {
    flexGrow: 0,
  },
  menuItemLabel: {
    flexShrink: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.content,
  },
  menuCancelLabel: {
    textAlign: "center",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.content,
  },
}));
