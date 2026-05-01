import { useCallback, useRef, useState } from "react";

/**
 * 1 秒の長押しで onLongPress を発火する誤タップ防止ボタン。
 * 動かしすぎや離した時点で長押しはキャンセルされる。
 */
export function LongPressButton({
  onLongPress,
  duration = 1000,
  disabled = false,
  className = "",
  children,
}: {
  onLongPress: () => void;
  duration?: number;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [isPressing, setIsPressing] = useState(false);
  const timerRef = useRef<number | null>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsPressing(false);
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      startXRef.current = e.clientX;
      startYRef.current = e.clientY;
      setIsPressing(true);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setIsPressing(false);
        onLongPress();
      }, duration);
    },
    [disabled, duration, onLongPress],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (timerRef.current === null) return;
      const dx = Math.abs(e.clientX - startXRef.current);
      const dy = Math.abs(e.clientY - startYRef.current);
      if (dx > 10 || dy > 10) cancel();
    },
    [cancel],
  );

  const handlePointerEnd = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }
      cancel();
    },
    [cancel],
  );

  return (
    <button
      type="button"
      disabled={disabled}
      data-pressing={isPressing ? "true" : "false"}
      className={`relative overflow-hidden ${className}`}
      style={{ touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
    >
      {isPressing && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 bg-red-200 pointer-events-none"
          style={{
            animation: `drip-long-press ${duration}ms linear forwards`,
          }}
        />
      )}
      <span className="relative">{children}</span>
    </button>
  );
}
