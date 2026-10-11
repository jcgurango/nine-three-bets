import { notFound } from "next/navigation";
import { AdminPanel } from "@/components/AdminPanel";
import { AutoRefresh } from "@/components/AutoRefresh";
import { getUser, isAdmin } from "@/lib/auth";
import { getBankClosedAt, getSettings, listMatches } from "@/lib/store";

export const metadata = { title: "Admin · 9-3 Bets" };

export default async function AdminPage() {
  if (!isAdmin(await getUser())) notFound();
  const [active, archived, settings, bankClosedAt] = await Promise.all([
    listMatches(false),
    listMatches(true),
    getSettings(),
    getBankClosedAt(),
  ]);
  return (
    <>
      <AutoRefresh />
      <AdminPanel active={active} archived={archived} settings={settings} bankClosedAt={bankClosedAt} />
    </>
  );
}
