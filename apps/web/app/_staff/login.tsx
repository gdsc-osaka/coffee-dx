import { Form, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/login";
import { authorizeStaff, createAuth } from "~/lib/auth.server";
import { safeStaffReturnTo } from "~/lib/auth-url";

export const meta: Route.MetaFunction = () => [{ title: "スタッフログイン" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const returnTo = safeStaffReturnTo(url.searchParams.get("returnTo"));
  const result = await authorizeStaff(request, context.cloudflare.env);
  if (result.ok) throw redirect(returnTo);
  return { returnTo };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const username = form.get("username");
  const password = form.get("password");
  const returnTo = safeStaffReturnTo(form.get("returnTo")?.toString());
  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    return { error: "ユーザー名とパスワードを入力してください。", returnTo };
  }

  try {
    const response = await createAuth(context.cloudflare.env).api.signInUsername({
      body: { username, password },
      headers: request.headers,
      asResponse: true,
    });
    if (!response.ok) return { error: "ユーザー名またはパスワードが正しくありません。", returnTo };

    const headers = new Headers();
    for (const cookie of response.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
    throw redirect(returnTo, { headers });
  } catch (error) {
    if (error instanceof Response && error.status >= 300 && error.status < 400) throw error;
    return { error: "ユーザー名またはパスワードが正しくありません。", returnTo };
  }
}

export default function StaffLogin({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const returnTo = actionData?.returnTo ?? loaderData.returnTo;

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4 py-8">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-stone-900">スタッフログイン</h1>
        <p className="mt-2 text-sm text-stone-600">
          発行されたユーザー名とパスワードを入力してください。
        </p>
        <Form method="post" className="mt-7 space-y-5">
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="block text-sm font-medium text-stone-700">
            ユーザー名
            <input
              name="username"
              type="text"
              autoComplete="username"
              required
              className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2 text-base"
            />
          </label>
          <label className="block text-sm font-medium text-stone-700">
            パスワード
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2 text-base"
            />
          </label>
          {actionData?.error && (
            <p role="alert" className="text-sm text-red-700">
              {actionData.error}
            </p>
          )}
          <button
            type="submit"
            disabled={navigation.state === "submitting"}
            className="w-full rounded-lg bg-stone-900 px-4 py-3 font-semibold text-white disabled:opacity-50"
          >
            {navigation.state === "submitting" ? "確認中…" : "ログイン"}
          </button>
        </Form>
      </div>
    </main>
  );
}
