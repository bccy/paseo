import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceTabSwitcherStore } from "./workspace-tab-switcher-store";

function reset() {
  useWorkspaceTabSwitcherStore.setState({ isOpen: false, consumerCount: 0 });
}

beforeEach(reset);

describe("workspace-tab-switcher-store", () => {
  it("ignores open when nothing can show the panel", () => {
    // The desk pet's triple tap fires from any screen, including screens with no
    // workspace header — arming the panel there made it pop open on the next visit.
    useWorkspaceTabSwitcherStore.getState().open();

    expect(useWorkspaceTabSwitcherStore.getState().isOpen).toBe(false);
  });

  it("ignores toggle when nothing can show the panel", () => {
    useWorkspaceTabSwitcherStore.getState().toggle();

    expect(useWorkspaceTabSwitcherStore.getState().isOpen).toBe(false);
  });

  it("opens once a consumer is registered", () => {
    const unregister = useWorkspaceTabSwitcherStore.getState().register();

    useWorkspaceTabSwitcherStore.getState().open();

    expect(useWorkspaceTabSwitcherStore.getState().isOpen).toBe(true);
    unregister();
  });

  it("resets after the last consumer unregisters", () => {
    const unregister = useWorkspaceTabSwitcherStore.getState().register();
    useWorkspaceTabSwitcherStore.getState().open();

    unregister();

    expect(useWorkspaceTabSwitcherStore.getState()).toMatchObject({
      consumerCount: 0,
      isOpen: false,
    });
  });

  it("stays open while another consumer remains", () => {
    const unregisterFirst = useWorkspaceTabSwitcherStore.getState().register();
    const unregisterSecond = useWorkspaceTabSwitcherStore.getState().register();
    useWorkspaceTabSwitcherStore.getState().open();

    unregisterFirst();

    expect(useWorkspaceTabSwitcherStore.getState()).toMatchObject({
      consumerCount: 1,
      isOpen: true,
    });
    unregisterSecond();
    expect(useWorkspaceTabSwitcherStore.getState().isOpen).toBe(false);
  });

  it("ignores a second call to the same unregister", () => {
    const unregister = useWorkspaceTabSwitcherStore.getState().register();
    const other = useWorkspaceTabSwitcherStore.getState().register();

    unregister();
    unregister();

    expect(useWorkspaceTabSwitcherStore.getState().consumerCount).toBe(1);
    other();
    expect(useWorkspaceTabSwitcherStore.getState().consumerCount).toBe(0);
  });

  it("closes an open panel through close()", () => {
    const unregister = useWorkspaceTabSwitcherStore.getState().register();
    useWorkspaceTabSwitcherStore.getState().open();

    useWorkspaceTabSwitcherStore.getState().close();

    expect(useWorkspaceTabSwitcherStore.getState().isOpen).toBe(false);
    unregister();
  });
});
