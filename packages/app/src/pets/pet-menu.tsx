/**
 * The long-press menu for the desk pet.
 *
 * The upstream plugin opens a context menu on right-click with settings, growth
 * and the two mini-games. A phone has no right-click, so the overlay opens this
 * on long-press instead.
 *
 * @module paseo/pets/pet-menu
 */

import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

export type PetMenuAction = "settings" | "growth" | "bubble-game" | "catch-game";

interface PetMenuProps {
  visible: boolean;
  /** The mini-games entry is hidden when the `game` preference is off. */
  gamesEnabled: boolean;
  onAction: (action: PetMenuAction) => void;
  onClose: () => void;
}

export function PetMenu({ visible, gamesEnabled, onAction, onClose }: PetMenuProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.menu} onPress={(event) => event.stopPropagation()}>
          <Text style={styles.title}>鲸鱼娘</Text>
          <Pressable style={styles.item} onPress={() => onAction("settings")}>
            <Text style={styles.itemText}>设置</Text>
          </Pressable>
          <Pressable style={styles.item} onPress={() => onAction("growth")}>
            <Text style={styles.itemText}>养成 / 成就</Text>
          </Pressable>
          {gamesEnabled ? (
            <>
              <Pressable style={styles.item} onPress={() => onAction("bubble-game")}>
                <Text style={styles.itemText}>小游戏：戳泡泡</Text>
              </Pressable>
              <Pressable style={styles.item} onPress={() => onAction("catch-game")}>
                <Text style={styles.itemText}>小游戏：接点心</Text>
              </Pressable>
            </>
          ) : null}
          <Pressable style={[styles.item, styles.cancel]} onPress={onClose}>
            <Text style={styles.cancelText}>取消</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  menu: {
    minWidth: 220,
    borderRadius: 14,
    backgroundColor: "#1c2026",
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  title: {
    color: "#8b94a1",
    fontSize: 12,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 8,
  },
  item: {
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 9,
  },
  itemText: {
    color: "#dfe6ef",
    fontSize: 15,
  },
  cancel: {
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#2b3038",
  },
  cancelText: {
    color: "#8b94a1",
    fontSize: 15,
  },
});
