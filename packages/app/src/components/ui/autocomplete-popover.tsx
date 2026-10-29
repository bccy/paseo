import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
  type ReactNode,
} from "react";
import {
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Portal } from "@gorhom/portal";
import Animated, { useAnimatedReaction, useAnimatedStyle } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Autocomplete, type AutocompleteOption } from "@/components/ui/autocomplete";
import {
  measureFloatingPanelPortalHost,
  useFloatingPanelPortalHostName,
} from "@/components/ui/floating-panel-portal";
import { KeyboardTranslateView, useKeyboardAnchor, useKeyboardShift } from "@/keyboard/shift";
import { SPACING } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

const OFFSET_FROM_ANCHOR = SPACING[3];

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

interface RelativeAnchorRect {
  x: number;
  y: number;
  width: number;
  hostHeight: number;
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
  isLoading?: boolean;
  errorMessage?: string;
  loadingText?: string;
  emptyText?: string;
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
  isLoading,
  errorMessage,
  loadingText,
  emptyText,
}: AutocompletePopoverProps): ReactElement | null {
  "use no memo";
  // React Compiler memoizes effect captures by reading SharedValue.value during render.
  const anchorRef = useRef<View>(null);
  // Mirror the element into the caller's ref: a callback ref (not an effect) so the
  // external owner has it before the first layout, when its first measurement runs.
  const setAnchorElement = useCallback(
    (element: View | null) => {
      anchorRef.current = element;
      if (externalAnchorRef !== undefined) externalAnchorRef.current = element;
    },
    [anchorRef, externalAnchorRef],
  );
  const [relativeAnchorRect, setRelativeAnchorRect] = useState<RelativeAnchorRect | null>(null);
  const windowDimensions = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const portalHostName = useFloatingPanelPortalHostName();
  const { isMoving } = useKeyboardShift();
  const anchor = useKeyboardAnchor();
  const { measureAtRest } = anchor;
  const measurementGeneration = useRef(0);
  const canMeasure = visible && (options.length === 0 || selectedIndex >= 0);

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
      setRelativeAnchorRect({
        x: anchorRect.x - hostRect.x,
        y: anchorRect.y - hostRect.y,
        width: anchorRect.width,
        hostHeight: hostRect.height,
      });
      return undefined;
    });
  }, [anchorRef, canMeasure, measureAtRest, portalHostName]);

  useEffect(() => {
    measurementGeneration.current += 1;
    if (!canMeasure) {
      setRelativeAnchorRect(null);
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

  // Lay out at the anchor's resting position; the KeyboardTranslateView below lifts
  // it with the anchor. Height changes only at keyboard boundaries.
  const baseStyle = useMemo(() => {
    if (!relativeAnchorRect) return null;
    return inlineUnistylesStyle({
      position: "absolute" as const,
      left: relativeAnchorRect.x,
      width: relativeAnchorRect.width,
      bottom: relativeAnchorRect.hostHeight - relativeAnchorRect.y + OFFSET_FROM_ANCHOR,
    });
  }, [relativeAnchorRect]);

  const anchorY = relativeAnchorRect?.y ?? 0;
  const reservedLift = anchor.reservedLift;
  const heightStyle = useAnimatedStyle(
    () => ({
      maxHeight: Math.max(
        0,
        anchorY - reservedLift.value - safeAreaInsets.top - OFFSET_FROM_ANCHOR * 2,
      ),
    }),
    [anchorY, reservedLift, safeAreaInsets.top],
  );

  const showPopover = canMeasure && relativeAnchorRect && baseStyle;

  // The translate view is the popover's own frame, so it lifts only the popover.
  return (
    <View
      ref={setAnchorElement}
      onLayout={onAnchorLayout === undefined ? remeasure : composeLayout(remeasure, onAnchorLayout)}
      style={anchorStyle}
      collapsable={false}
    >
      {children}
      {showPopover ? (
        <Portal hostName={portalHostName}>
          <KeyboardTranslateView {...anchor.translation} style={baseStyle}>
            <Animated.View testID="composer-autocomplete-popover" style={heightStyle}>
              <Autocomplete
                options={options}
                selectedIndex={selectedIndex}
                onSelect={onSelect}
                isLoading={isLoading}
                errorMessage={errorMessage}
                loadingText={loadingText}
                emptyText={emptyText}
              />
            </Animated.View>
          </KeyboardTranslateView>
        </Portal>
      ) : null}
    </View>
  );
}
