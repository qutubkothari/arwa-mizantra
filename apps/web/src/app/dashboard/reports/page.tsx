"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getDefaultMisHref } from "@/lib/mis-catalog";
import { useAuthStore } from "@/stores/auth.store";

export default function ReportsEntryPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isReady = useAuthStore((state) => state.isReady);
  const hydrate = useAuthStore((state) => state.hydrate);

  useEffect(() => { if (!isReady) hydrate(); }, [hydrate, isReady]);
  useEffect(() => { if (isReady) router.replace(getDefaultMisHref(user)); }, [isReady, router, user]);

  return <div className="p-8 text-sm text-gray-600">Opening your MIS workspace…</div>;
}
