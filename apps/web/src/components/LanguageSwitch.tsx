"use client";

import { Languages } from "lucide-react";
import { useLocale } from "@/lib/locale";

export default function LanguageSwitch({
  compact = false,
  variant = "default",
}: {
  compact?: boolean;
  variant?: "default" | "sidebar";
}) {
  const { language, setLanguage } = useLocale();
  const next = language === "ar" ? "en" : "ar";
  const isSidebar = variant === "sidebar";

  return (
    <button
      data-i18n-skip
      type="button"
      onClick={() => setLanguage(next)}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold shadow-sm transition-colors ${
        isSidebar
          ? `border-[#8B6F47] bg-[#5B402E] text-[#FFFDF8] hover:bg-[#6F4E37] ${compact ? "" : "w-full"}`
          : "border-[#D8C8AA] bg-white text-[#5C402D] hover:bg-[#FFF8E8]"
      }`}
      aria-label={next === "ar" ? "Switch to Arabic" : "التبديل إلى الإنجليزية"}
      title={next === "ar" ? "العربية" : "الإنجليزية"}
    >
      <Languages className="h-4 w-4" />
      {!compact && (
        <span>{next === "ar" ? "العربية" : "الإنجليزية"}</span>
      )}
    </button>
  );
}
