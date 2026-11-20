"use client";

import { Plus, Trash2 } from "lucide-react";
import { dec, QUANTITY_TEXT, roomAreaSqFt, type Room } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Num } from "@workspace/ui/components/num";
import { cn } from "@workspace/ui/lib/utils";
import { halfFoot } from "./room-geometry";

interface RoomsListProps {
  rooms: Room[];
  selectedId: string | null;
  editable: boolean;
  onSelect: (roomId: string) => void;
  onChange: (room: Room) => void;
  onRemove: (roomId: string) => void;
  onAddDefault: () => void;
}

/** Feet entered as text, to the half foot; blank or invalid input keeps the previous size. */
function feet(value: string, fallback: string): string {
  const typed = value.trim();
  if (!QUANTITY_TEXT.test(typed) || dec(typed).lt(1)) return fallback;
  return halfFoot(typed);
}

/** Rooms as rows with name and dimensions, the precise alternative to dragging on the canvas. */
export function RoomsList({ rooms, selectedId, editable, onSelect, onChange, onRemove, onAddDefault }: RoomsListProps) {
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1.5">
        {rooms.map((room) => (
          <li
            key={room.id}
            onClick={() => onSelect(room.id)}
            className={cn(
              "grid grid-cols-[4.5rem_auto_4.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1 sm:grid-cols-[minmax(0,1fr)_4.5rem_auto_4.5rem_6.5rem_auto]",
              room.id === selectedId && "bg-brand-soft",
            )}
          >
            <Input
              aria-label="Room name"
              value={room.name}
              disabled={!editable}
              onChange={(e) => onChange({ ...room, name: e.target.value })}
              className="col-span-5 h-8 sm:col-span-1"
            />
            <Input
              aria-label={`${room.name} width in ft`}
              inputMode="decimal"
              defaultValue={room.widthFt}
              key={`w-${room.widthFt}`}
              disabled={!editable}
              onBlur={(e) => onChange({ ...room, widthFt: feet(e.target.value, room.widthFt) })}
              className="h-8 text-right tabular-nums"
            />
            <span className="text-muted-foreground text-xs">×</span>
            <Input
              aria-label={`${room.name} length in ft`}
              inputMode="decimal"
              defaultValue={room.lengthFt}
              key={`l-${room.lengthFt}`}
              disabled={!editable}
              onBlur={(e) => onChange({ ...room, lengthFt: feet(e.target.value, room.lengthFt) })}
              className="h-8 text-right tabular-nums"
            />
            <span className="text-right text-sm">
              <Num kind="quantity" value={roomAreaSqFt(room.widthFt, room.lengthFt).toString()} unit="sq ft" />
            </span>
            {editable ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${room.name}`}
                onClick={() => onRemove(room.id)}
              >
                <Trash2 />
              </Button>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ul>
      {editable ? (
        <Button variant="outline" size="sm" className="self-start" onClick={onAddDefault}>
          <Plus />
          Add room
        </Button>
      ) : null}
    </div>
  );
}
