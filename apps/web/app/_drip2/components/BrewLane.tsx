import type { LaneIdleState } from "./LaneIdle";
import { LaneIdle } from "./LaneIdle";
import { LaneActive } from "./LaneActive";

export type LaneActiveDescriptor = {
  kind: "active";
  batchId: string;
  menuItemId: string;
  menuItemName: string;
  count: number;
  createdAt: string;
  targetDurationSec: number | null;
  timerStartedAt: string | null;
  /** DB の brew_units.lane_index。全端末で同じレーン位置に表示するため使う */
  laneIndex: number;
};

export type BrewLaneState = LaneIdleState | LaneActiveDescriptor;

export function BrewLane({
  laneNumber,
  laneIndex,
  state,
  menus,
  eventId,
  onChangeState,
  onStart,
  isStarting,
  isCompleting,
  isCancelling,
  isSettingTimer,
}: {
  laneNumber: number;
  laneIndex: number;
  state: BrewLaneState;
  menus: Array<{ id: string; name: string }>;
  eventId: string;
  onChangeState: (next: LaneIdleState) => void;
  onStart: () => void;
  isStarting: boolean;
  isCompleting: boolean;
  isCancelling: boolean;
  isSettingTimer: boolean;
}) {
  if (state.kind === "idle") {
    return (
      <LaneIdle
        laneNumber={laneNumber}
        laneIndex={laneIndex}
        state={state}
        menus={menus}
        eventId={eventId}
        isStarting={isStarting}
        onChangeState={onChangeState}
        onStart={onStart}
      />
    );
  }
  return (
    <LaneActive
      laneNumber={laneNumber}
      menuItemName={state.menuItemName}
      count={state.count}
      batchId={state.batchId}
      targetDurationSec={state.targetDurationSec}
      timerStartedAt={state.timerStartedAt}
      eventId={eventId}
      isCompleting={isCompleting}
      isCancelling={isCancelling}
      isSettingTimer={isSettingTimer}
    />
  );
}
