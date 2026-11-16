import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
  type ReactNode,
} from "react";
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Portal } from "@gorhom/portal";
import { useAnimatedReaction, useAnimatedRef } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Autocomplete,
  type AutocompleteOption,
  type AutocompleteStatus,
} from "@/components/ui/autocomplete";
import {
  measureFloatingPanelPortalHost,
  useFloatingPanelPortalHostName,
} from "@/components/ui/floating-panel-portal";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { KeyboardTranslateView, useKeyboardAnchor, useKeyboardShift } from "@/keyboard/shift";
import { PopoverFrame } from "./internal/frame";
import type { AnchorAtRest } from "./internal/placement";

/**
 * Run two layout handlers for one view.
 *
 * The anchor has its own remeasure and may also be another owner's measurement
 * target (the desk pet's ledge). Composing them here keeps the caller from having
 * to wrap the element in a second view just to get a second `onLayout`.
 */
function composeLayout(
  first: (event: LayoutChangeEvent) => void,
  second: (event: LayoutChangeEvent) => void,
): (event: LayoutChangeEvent) => void {
  return (event) => {
    first(event);
    second(event);
  };
}

interface AutocompletePopoverProps {
  visible: boolean;
  children: ReactNode;
  anchorStyle?: StyleProp<ViewStyle>;
  /**
   * The anchor element, exposed so another owner can measure it. It is the column
   * that starts at the bordered input box, which is what the desk pet hangs from.
   */
  anchorRef?: RefObject<View | null>;
  /** Fired on the anchor's layout, in addition to the popover's own remeasure. */
  onAnchorLayout?: (event: LayoutChangeEvent) => void;
  options: readonly AutocompleteOption[];
  selectedIndex: number;
  onSelect: (option: AutocompleteOption) => void;
  status?: AutocompleteStatus | null;
}

export function AutocompletePopover({
  visible,
  children,
  anchorStyle,
  anchorRef: externalAnchorRef,
  onAnchorLayout,
  options,
  selectedIndex,
  onSelect,
  status,
}: AutocompletePopoverProps): ReactElement | null {
  "use no memo";
  // React Compiler memoizes effect captures by reading SharedValue.value during render.
  const anchorRef = useAnimatedRef<View>();
  // The animated ref returns its native handle, which React 19 would call as a ref cleanup.
  // The anchor stays a plain View: its style is the caller's Unistyles style.
  // Mirror the element into the caller's ref: a callback ref (not an effect) so the
  // external owner has it before the first layout, when its first measurement runs.
  const setAnchorElement = useCallback(
    (element: View | null) => {
      anchorRef(element);
      if (externalAnchorRef !== undefined) externalAnchorRef.current = element;
    },
    [anchorRef, externalAnchorRef],
  );
  const [anchorAtRest, setAnchorAtRest] = useState<AnchorAtRest | null>(null);
  const windowDimensions = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const portalHostName = useFloatingPanelPortalHostName();
  const { isMoving } = useKeyboardShift();
  const anchor = useKeyboardAnchor();
  const { measureAtRest } = anchor;
  const measurementGeneration = useRef(0);
  // A retained panel stays mounted while hidden; its anchor cannot be measured until it shows.
  const isPanelActive = useRetainedPanelActive();
  const canMeasure = isPanelActive && visible && (options.length === 0 || selectedIndex >= 0);

  const remeasure = useCallback(() => {
    if (!canMeasure) return;
    const anchorElement = anchorRef.current;
    if (!anchorElement) return;
    const generation = measurementGeneration.current;
    void Promise.all([
      measureAtRest(anchorElement),
      measureFloatingPanelPortalHost(portalHostName),
    ]).then(([anchorRect, hostRect]) => {
      if (generation !== measurementGeneration.current || !anchorRect || !hostRect) {
        return undefined;
      }
      setAnchorAtRest({
        x: anchorRect.x - hostRect.x,
        y: anchorRect.y - hostRect.y,
        width: anchorRect.width,
        height: anchorRect.height,
        hostHeight: hostRect.height,
      });
      return undefined;
    });
  }, [anchorRef, canMeasure, measureAtRest, portalHostName]);

  useEffect(() => {
    measurementGeneration.current += 1;
    if (!canMeasure) {
      setAnchorAtRest(null);
      return;
    }

    remeasure();
    const raf = requestAnimationFrame(remeasure);

    return () => {
      measurementGeneration.current += 1;
      cancelAnimationFrame(raf);
    };
  }, [canMeasure, remeasure, windowDimensions.width, windowDimensions.height]);

  useAnimatedReaction(
    () => isMoving.value,
    (moving, wasMoving) => {
      if (wasMoving && !moving) {
        scheduleOnRN(remeasure);
      }
    },
    [isMoving, remeasure],
  );

  const anchorLayout =
    onAnchorLayout === undefined ? remeasure : composeLayout(remeasure, onAnchorLayout);

  // The layer covers the host and rides the anchor's keyboard translation; the frame inside it
  // places the popover. A layer that spans the host keeps the popover inside its parent's bounds,
  // which Android hit-testing requires.
  return (
    <View ref={setAnchorElement} onLayout={anchorLayout} style={anchorStyle} collapsable={false}>
      {children}
      {canMeasure && anchorAtRest ? (
        <Portal hostName={portalHostName}>
          <KeyboardTranslateView
            {...anchor.translation}
            style={StyleSheet.absoluteFill}
            pointerEvents="box-none"
          >
            <PopoverFrame
              anchorRef={anchorRef}
              anchorAtRest={anchorAtRest}
              reservedLift={anchor.reservedLift}
              topInset={safeAreaInsets.top}
            >
              <Autocomplete
                options={options}
                selectedIndex={selectedIndex}
                onSelect={onSelect}
                status={status}
              />
            </PopoverFrame>
          </KeyboardTranslateView>
        </Portal>
      ) : null}
    </View>
  );
}
