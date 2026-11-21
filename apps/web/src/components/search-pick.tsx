"use client";

import { ChevronsUpDown } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@workspace/ui/components/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@workspace/ui/components/command";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { matchOptions, type SearchOption } from "./search-pick-match";

/** Whether a key press is a letter, digit or sign to search with, not a shortcut or a control key. */
const isSearchKey = (event: KeyboardEvent) =>
  event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey;

/**
 * A picker over labelled options that searches as you type (click-through finding #38): typing on
 * the closed button opens it with those letters, the list keeps the names that contain them, and
 * Enter picks the highlighted one. For longer lists such as vendors and locations; short fixed
 * lists keep `Pick`.
 */
export function SearchPick<T extends string>({
  id,
  value,
  options,
  onChange,
  searchLabel,
}: {
  id: string;
  value: T;
  options: readonly SearchOption<T>[];
  onChange: (value: T) => void;
  /** The accessible name of the search box, e.g. "Search vendors". */
  searchLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const selected = options.find(([v]) => v === value);
  const shown = matchOptions(options, query);

  function show(next: boolean) {
    setOpen(next);
    if (!next) setQuery("");
  }

  function typeAhead(event: KeyboardEvent<HTMLButtonElement>) {
    if (!isSearchKey(event)) return;
    event.preventDefault();
    const key = event.key;
    setQuery((typed) => (open ? typed : "") + key);
    setOpen(true);
  }

  function choose(next: T) {
    onChange(next);
    show(false);
  }

  return (
    <Popover open={open} onOpenChange={show}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          onKeyDown={typeAhead}
        >
          <span className="truncate">{selected?.[1] ?? ""}</span>
          <ChevronsUpDown aria-hidden="true" className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="bg-surface w-(--radix-popover-trigger-width) min-w-56 p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const box = input.current;
          box?.focus();
          box?.setSelectionRange(box.value.length, box.value.length);
        }}
      >
        <Command shouldFilter={false} label={searchLabel}>
          <CommandInput ref={input} value={query} onValueChange={setQuery} aria-label={searchLabel} />
          <CommandList className="max-h-72">
            <CommandEmpty>No match.</CommandEmpty>
            {shown.map(([v, text]) => (
              <CommandItem key={v} value={v} data-checked={v === value} onSelect={() => choose(v)}>
                <span className="truncate">{text}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
