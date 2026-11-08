"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import type { Address } from "@workspace/shared";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { addressProvider, MIN_QUERY_LENGTH, SUGGEST_DELAY_MS, type AddressSuggestion } from "@/lib/address/provider";

interface AddressAutocompleteProps {
  id: string;
  /** The company's state, so suggestions there come first. */
  near?: string;
  onSelect: (address: Address) => void;
  describedBy?: string;
}

const newSession = () => crypto.randomUUID();

/**
 * Type an address freely and pick a suggestion (spec A6): "123 Main" or "Sacramento, Calif".
 * Suggestions start at three characters after a 250 ms pause; one session runs from the first
 * keystroke to the chosen suggestion. Arrow keys move, Enter picks, Escape closes.
 */
export function AddressAutocomplete({ id, near, onSelect, describedBy }: AddressAutocompleteProps) {
  const provider = useRef(addressProvider());
  const session = useRef(newSession());
  const listId = useId();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < MIN_QUERY_LENGTH) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      provider.current
        .suggest(query, session.current, near)
        .then((found) => {
          if (cancelled) return;
          setItems(found);
          setActive(0);
          setOpen(true);
          setError(null);
        })
        .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "No suggestions."));
    }, SUGGEST_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, near]);

  async function pick(item: AddressSuggestion) {
    try {
      const address = await provider.current.resolve(item, session.current);
      session.current = newSession();
      setOpen(false);
      setQuery(`${item.text}, ${item.secondary}`);
      onSelect(address);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That address could not be looked up.");
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || items.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      void pick(items[active]!);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && query.trim().length >= MIN_QUERY_LENGTH;
  return (
    <div className="relative">
      <MapPin aria-hidden="true" className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
      <Input
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && items[active] ? `${listId}-${active}` : undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        placeholder="Start typing, for example 123 Main"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value.trim().length < MIN_QUERY_LENGTH) setOpen(false);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="pl-8"
      />
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Address suggestions"
          className="bg-popover border-hairline absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border p-1 shadow-md"
        >
          {items.length === 0 ? (
            <li className="text-muted-foreground px-2 py-1.5 text-sm">No suggestions. Enter the address manually.</li>
          ) : (
            items.map((item, i) => (
              <li
                key={item.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void pick(item)}
                onMouseEnter={() => setActive(i)}
                className={cn("cursor-pointer rounded-sm px-2 py-1.5 text-sm", i === active && "bg-muted")}
              >
                <span className="font-medium">{item.text}</span>
                <span className="text-muted-foreground block text-xs">{item.secondary}</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
      {error ? <p className="text-danger-ink mt-1 text-xs">{error}</p> : null}
    </div>
  );
}
