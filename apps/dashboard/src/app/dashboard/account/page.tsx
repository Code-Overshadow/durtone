import { redirect } from "next/navigation";

export default function AccountIndexPage() {
  redirect("/dashboard/account/tenant");
}
