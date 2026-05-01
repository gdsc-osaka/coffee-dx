import { Plus } from "lucide-react";

export function AddLaneButton({ onAdd }: { onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="w-full h-full min-h-[8rem] flex items-center justify-center gap-2 px-6 py-3 rounded-3xl border-2 border-dashed border-stone-300 text-stone-500 hover:bg-stone-100 active:bg-stone-200 transition-colors font-bold"
    >
      <Plus className="w-5 h-5" aria-hidden="true" />
      レーン追加
    </button>
  );
}
