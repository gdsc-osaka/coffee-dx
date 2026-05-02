import { useCallback, useRef, useState } from "react";

/**
 * 右スワイプで確定する誤タップ防止 UI。
 * 60% 以上スライドして指を離すと onConfirm が呼ばれる。
 *
 * deltaX は ref で同期管理し、ハンドラ閉包の古い値を見ないようにする。
 * state 側の deltaX は再レンダリングのトリガー専用。
 */
export function SwipeToConfirm({
  onConfirm,
  threshold = 0.6,
  disabled = false,
  label = "→→→ スワイプで完了 →→→",
  reachedLabel = "離して完了",
  className = "",
}: {
  onConfirm: () => void;
  threshold?: number;
  disabled?: boolean;
  label?: string;
  reachedLabel?: string;
  className?: string;
}) {
  const [deltaX, setDeltaX] = useState(0);
  const deltaXRef = useRef(0);
  const startXRef = useRef(0);
  const widthRef = useRef(0);
  const isDraggingRef = useRef(false);

  const updateDelta = (v: number) => {
    deltaXRef.current = v;
    setDeltaX(v);
  };

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      isDraggingRef.current = true;
      startXRef.current = e.clientX;
      widthRef.current = e.currentTarget.offsetWidth;
      updateDelta(0);
    },
    [disabled],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (!isDraggingRef.current) return;
      const raw = e.clientX - startXRef.current;
      const next = Math.max(0, Math.min(raw, widthRef.current));
      updateDelta(next);
    },
    [disabled],
  );

  const handlePointerEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      const reached = widthRef.current > 0 && deltaXRef.current >= widthRef.current * threshold;
      updateDelta(0);
      if (reached) onConfirm();
    },
    [disabled, threshold, onConfirm],
  );

  const progress = widthRef.current > 0 ? deltaX / widthRef.current : 0;
  const reachedThreshold = progress >= threshold;

  return (
    <div
      role="button"
      aria-label={label}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      data-progress={progress.toFixed(2)}
      className={`relative overflow-hidden rounded-2xl select-none ${
        disabled ? "opacity-50 pointer-events-none" : ""
      } ${className}`}
      style={{ touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onKeyDown={(e) => {
        if (disabled) return;
        // キーボード/AT は誤タップ防止のスワイプを行えないため、Enter/Space で
        // 確認操作を発火する（意図的な操作前提）。
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onConfirm();
        }
      }}
    >
      <div
        className={`absolute inset-y-0 left-0 pointer-events-none transition-colors ${
          reachedThreshold ? "bg-emerald-500" : "bg-emerald-300"
        }`}
        style={{ width: `${progress * 100}%` }}
      />
      <span className="relative block text-center font-black text-xl py-4">
        {reachedThreshold ? reachedLabel : label}
      </span>
    </div>
  );
}
