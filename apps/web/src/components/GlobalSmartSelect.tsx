"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { smartSearchMatches } from "@/lib/smart-search";

type SmartOption = {
  value: string;
  label: string;
  searchText: string;
  disabled: boolean;
};

type OpenSelect = {
  element: HTMLSelectElement;
  label: string;
  options: SmartOption[];
  selectedValue: string;
  rect: DOMRect;
};

function selectLabel(select: HTMLSelectElement) {
  const aria = select.getAttribute("aria-label");
  if (aria) return aria;
  if (select.id) {
    const label = document.querySelector<HTMLLabelElement>(
      `label[for="${CSS.escape(select.id)}"]`,
    );
    if (label?.innerText.trim()) return label.innerText.trim();
  }
  const wrappingLabel = select.closest("label");
  if (wrappingLabel?.innerText.trim()) {
    return wrappingLabel.innerText.replace(select.innerText, "").trim();
  }
  return select.name?.replaceAll("_", " ") || "Choose an option";
}

function readOptions(select: HTMLSelectElement): SmartOption[] {
  return Array.from(select.options).map((option) => ({
    value: option.value,
    label: option.text.trim() || option.value,
    searchText: [
      option.text,
      option.value,
      option.dataset.search,
      option.dataset.aliases,
      option.parentElement instanceof HTMLOptGroupElement
        ? option.parentElement.label
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    disabled:
      option.disabled ||
      (option.parentElement instanceof HTMLOptGroupElement &&
        option.parentElement.disabled),
  }));
}

export default function GlobalSmartSelect() {
  const [open, setOpen] = useState<OpenSelect | null>(null);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const show = (select: HTMLSelectElement) => {
    if (
      select.disabled ||
      select.multiple ||
      select.size > 1 ||
      select.dataset.nativeSelect === "true"
    ) {
      return false;
    }
    setOpen({
      element: select,
      label: selectLabel(select),
      options: readOptions(select),
      selectedValue: select.value,
      rect: select.getBoundingClientRect(),
    });
    setQuery("");
    setHighlighted(0);
    return true;
  };

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const select = (event.target as Element | null)?.closest(
        "select",
      ) as HTMLSelectElement | null;
      if (select && show(select)) {
        event.preventDefault();
        event.stopPropagation();
        select.focus({ preventScroll: true });
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const select = event.target as HTMLSelectElement;
      if (!(select instanceof HTMLSelectElement)) return;
      if (
        event.key === "Enter" ||
        event.key === " " ||
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey)
      ) {
        if (show(select)) {
          event.preventDefault();
          if (event.key.length === 1 && event.key !== " ") setQuery(event.key);
        }
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    const closeIfDetached = () => {
      if (!open.element.isConnected || open.element.disabled) setOpen(null);
    };
    const observer = new MutationObserver(closeIfDetached);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", closeIfDetached);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", closeIfDetached);
    };
  }, [open]);

  const matches = useMemo(
    () =>
      (open?.options || []).filter((option) =>
        smartSearchMatches(query, option.searchText),
      ),
    [open, query],
  );

  useEffect(() => setHighlighted(0), [query]);

  if (!open || typeof document === "undefined") return null;

  const choose = (option: SmartOption) => {
    if (option.disabled) return;
    const select = open.element;
    select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    setOpen(null);
    requestAnimationFrame(() => select.focus({ preventScroll: true }));
  };

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const mobile = viewportWidth < 640;
  const width = mobile
    ? viewportWidth
    : Math.min(Math.max(open.rect.width, 320), 560);
  const left = mobile
    ? 0
    : Math.min(Math.max(8, open.rect.left), viewportWidth - width - 8);
  const roomBelow = viewportHeight - open.rect.bottom;
  const top = mobile
    ? undefined
    : roomBelow >= 320
      ? open.rect.bottom + 4
      : Math.max(8, open.rect.top - 324);

  return createPortal(
    <div className="fixed inset-0 z-[100000]" role="presentation">
      <button
        type="button"
        aria-label="Close option search"
        className="absolute inset-0 h-full w-full cursor-default bg-black/20"
        onClick={() => setOpen(null)}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={open.label}
        className="absolute flex max-h-[75vh] flex-col overflow-hidden rounded-t-2xl border border-[#D8C8AA] bg-white shadow-2xl sm:max-h-[320px] sm:rounded-xl"
        style={{
          width,
          left,
          top,
          bottom: mobile ? 0 : undefined,
        }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[#E8DCC8] px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-bold uppercase tracking-wide text-[#8B6F47]">
              {open.label}
            </p>
            <p className="text-[11px] text-slate-500">
              Type any part of the code, name or size
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="rounded-full p-2 text-slate-600 hover:bg-slate-100"
            onClick={() => setOpen(null)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="relative border-b border-[#E8DCC8] p-3">
          <Search
            size={17}
            className="pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlighted((value) =>
                  Math.min(value + 1, matches.length - 1),
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlighted((value) => Math.max(value - 1, 0));
              } else if (event.key === "Enter" && matches[highlighted]) {
                event.preventDefault();
                choose(matches[highlighted]);
              } else if (event.key === "Escape") {
                event.preventDefault();
                setOpen(null);
              }
            }}
            placeholder="Search options…"
            role="combobox"
            aria-expanded="true"
            aria-controls="global-smart-select-options"
            aria-autocomplete="list"
            autoComplete="off"
            className="w-full rounded-lg border border-[#D8C8AA] bg-white py-2.5 pl-10 pr-9 text-sm outline-none focus:border-[#8B6F47] focus:ring-2 focus:ring-[#8B6F47]/20"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              className="absolute right-6 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500"
              onClick={() => setQuery("")}
            >
              <X size={15} />
            </button>
          )}
        </div>
        <div
          id="global-smart-select-options"
          role="listbox"
          className="min-h-0 flex-1 overflow-y-auto p-1.5"
        >
          {matches.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-slate-500">
              No matching options
            </div>
          ) : (
            matches.map((option, index) => {
              const selected = option.value === open.selectedValue;
              return (
                <button
                  key={`${option.value}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={option.disabled}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => choose(option)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                    index === highlighted
                      ? "bg-[#F3EBDD] text-[#3F2D20]"
                      : "text-[#4A3426] hover:bg-[#FAF7F1]"
                  }`}
                >
                  <span className="break-words">{option.label}</span>
                  {selected ? (
                    <Check size={17} className="shrink-0 text-emerald-600" />
                  ) : (
                    <ChevronDown size={15} className="shrink-0 rotate-[-90deg] text-slate-300" />
                  )}
                </button>
              );
            })
          )}
        </div>
        <div className="border-t border-[#E8DCC8] px-3 py-2 text-[11px] text-slate-500">
          {matches.length} of {open.options.length} options
        </div>
      </section>
    </div>,
    document.body,
  );
}
