import { Form } from "react-router";

export function StaffLogoutButton({ dark = false }: { dark?: boolean }) {
  return (
    <Form method="post" action="/staff/logout">
      <button
        type="submit"
        className={
          dark
            ? "rounded border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-800"
            : "rounded border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-100"
        }
      >
        ログアウト
      </button>
    </Form>
  );
}
