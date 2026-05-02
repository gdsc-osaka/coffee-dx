/**
 * 新 UI 用のフィーチャーフラグ。
 *
 * NOTE: タイマー機能は当面 UI 上は非表示。コード本体（DO エンドポイント /
 * LaneTimer / useTimerEndAlert / audioUnlock 等）は将来の復活に備えて温存。
 * 復活させる場合はこの定数を `true` に戻すだけで全ての関連 UI が再有効化される。
 */
export const TIMER_FEATURE_ENABLED = false;
