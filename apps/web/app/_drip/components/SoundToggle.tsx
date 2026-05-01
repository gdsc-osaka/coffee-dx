import { Volume2, VolumeOff } from "lucide-react";

export function SoundToggle({
  unlocked,
  onUnlock,
}: {
  unlocked: boolean;
  onUnlock: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onUnlock}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold transition-colors ${
        unlocked
          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
          : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
      }`}
      title={unlocked ? "サウンドは有効です" : "タップしてサウンドを有効化"}
    >
      {unlocked ? (
        <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
      ) : (
        <VolumeOff className="w-3.5 h-3.5" aria-hidden="true" />
      )}
      {unlocked ? "サウンド: 有効" : "サウンドを有効化"}
    </button>
  );
}
