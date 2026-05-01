import type { LaneIdleState, LanePendingState } from "./LaneIdle";
import { LaneIdle } from "./LaneIdle";
import { LanePending } from "./LanePending";
import { LaneActive } from "./LaneActive";

export type LaneActiveDescriptor = {
  kind: "active";
  batchId: string;
  menuItemName: string;
  count: number;
  createdAt: string;
  targetDurationSec: number | null;
};

export type BrewLaneState = LaneIdleState | LanePendingState | LaneActiveDescriptor;

export function BrewLane({
  laneNumber,
  state,
  menus,
  eventId,
  onChangeState,
  onStart,
  isStarting,
  isCompleting,
  isCancelling,
}: {
  laneNumber: number;
  state: BrewLaneState;
  menus: Array<{ id: string; name: string }>;
  eventId: string;
  onChangeState: (next: LaneIdleState | LanePendingState) => void;
  onStart: () => void;
  isStarting: boolean;
  isCompleting: boolean;
  isCancelling: boolean;
}) {
  if (state.kind === "idle") {
    return (
      <LaneIdle laneNumber={laneNumber} state={state} menus={menus} onChangeState={onChangeState} />
    );
  }
  if (state.kind === "pending") {
    const menuItemName = menus.find((m) => m.id === state.menuItemId)?.name ?? state.menuItemId;
    return (
      <LanePending
        laneNumber={laneNumber}
        state={state}
        menuItemName={menuItemName}
        eventId={eventId}
        onChangeState={onChangeState}
        onStart={onStart}
        isStarting={isStarting}
      />
    );
  }
  return (
    <LaneActive
      laneNumber={laneNumber}
      menuItemName={state.menuItemName}
      count={state.count}
      batchId={state.batchId}
      createdAt={state.createdAt}
      targetDurationSec={state.targetDurationSec}
      eventId={eventId}
      isCompleting={isCompleting}
      isCancelling={isCancelling}
    />
  );
}
