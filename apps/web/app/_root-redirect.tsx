import { redirect } from "react-router";

export async function loader() {
  return redirect("/order");
}

export default function RootRedirect() {
  return null;
}
