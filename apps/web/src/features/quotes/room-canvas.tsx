"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatNumber, type Room } from "@workspace/shared";
import { useNumberSettings } from "@workspace/ui/components/number-settings";
import { cn } from "@workspace/ui/lib/utils";
import { feetText, roomSize } from "./room-geometry";

/** The drawing area in ft; rooms snap to half a foot. */
const FIELD = { width: 48, height: 30 };
const SNAP = 0.5;
const MIN_FT = 2;

type Drag =
  | { mode: "draw"; startX: number; startY: number }
  | { mode: "move"; room: Room; dx: number; dy: number }
  | { mode: "resize"; room: Room };

const snap = (v: number) => Math.round(v / SNAP) * SNAP;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

interface RoomCanvasProps {
  rooms: Room[];
  selectedId: string | null;
  editable: boolean;
  onSelect: (roomId: string | null) => void;
  onAdd: (room: Omit<Room, "id" | "name">) => void;
  onChange: (room: Room) => void;
}

/**
 * The room canvas (spec "Quote builder"): drag on empty floor to draw a room, drag a room to move
 * it, drag its corner to resize. Areas follow in sq ft. Arrow keys move a focused room by half a
 * foot, Shift with arrows resizes it, so the canvas works from the keyboard too.
 */
export function RoomCanvas({ rooms, selectedId, editable, onSelect, onAdd, onChange }: RoomCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [sketch, setSketch] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const settings = useNumberSettings();
  const ft = (value: number | string) => formatNumber(value, "quantity", settings);
  /** "9.50 × 19.00 ft": what the room shows under its name, and part of its name for screen readers. */
  const sizeLabel = (room: Room) => `${ft(room.widthFt)} × ${ft(room.lengthFt)} ft`;

  function toFt(e: PointerEvent) {
    const svg = svgRef.current!;
    const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: clamp(snap(point.x), 0, FIELD.width), y: clamp(snap(point.y), 0, FIELD.height) };
  }

  function begin(e: PointerEvent, next: Drag) {
    if (!editable) return;
    e.stopPropagation();
    svgRef.current!.setPointerCapture(e.pointerId);
    drag.current = next;
  }

  function onMove(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = toFt(e);
    if (d.mode === "draw") {
      setSketch({
        x: Math.min(d.startX, p.x),
        y: Math.min(d.startY, p.y),
        w: Math.abs(p.x - d.startX),
        h: Math.abs(p.y - d.startY),
      });
    } else if (d.mode === "move") {
      const { w, h } = roomSize(d.room);
      const x = clamp(p.x - d.dx, 0, FIELD.width - w);
      const y = clamp(p.y - d.dy, 0, FIELD.height - h);
      if (x !== d.room.x || y !== d.room.y) onChange({ ...d.room, x, y });
    } else {
      const widthFt = feetText(Math.max(MIN_FT, p.x - d.room.x));
      const lengthFt = feetText(Math.max(MIN_FT, p.y - d.room.y));
      onChange({ ...d.room, widthFt, lengthFt });
    }
  }

  function onUp() {
    if (drag.current?.mode === "draw" && sketch && sketch.w >= MIN_FT && sketch.h >= MIN_FT) {
      onAdd({ x: sketch.x, y: sketch.y, widthFt: feetText(sketch.w), lengthFt: feetText(sketch.h) });
    }
    drag.current = null;
    setSketch(null);
  }

  function onRoomKey(e: KeyboardEvent, room: Room) {
    const step = { ArrowLeft: [-SNAP, 0], ArrowRight: [SNAP, 0], ArrowUp: [0, -SNAP], ArrowDown: [0, SNAP] }[e.key];
    if (!step || !editable) return;
    e.preventDefault();
    const [dx, dy] = step as [number, number];
    const { w, h } = roomSize(room);
    if (e.shiftKey) {
      onChange({
        ...room,
        widthFt: feetText(Math.max(MIN_FT, w + dx)),
        lengthFt: feetText(Math.max(MIN_FT, h + dy)),
      });
    } else {
      onChange({
        ...room,
        x: clamp(room.x + dx, 0, FIELD.width - w),
        y: clamp(room.y + dy, 0, FIELD.height - h),
      });
    }
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`-0.5 -0.5 ${FIELD.width + 1} ${FIELD.height + 1}`}
      className={cn("bg-surface block max-h-[26rem] w-full touch-none select-none", editable && "cursor-crosshair")}
      role="group"
      aria-label={`Room plan, ${rooms.length} rooms. ${editable ? "Drag on empty floor to draw a room." : ""}`}
      onPointerDown={(e) => {
        onSelect(null);
        const p = toFt(e);
        begin(e, { mode: "draw", startX: p.x, startY: p.y });
      }}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <defs>
        <pattern id="room-grid" width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M 1 0 L 0 0 0 1" fill="none" stroke="var(--hairline)" strokeWidth="0.03" />
        </pattern>
      </defs>
      <rect width={FIELD.width} height={FIELD.height} fill="url(#room-grid)" />
      {rooms.map((room) => {
        const selected = room.id === selectedId;
        const size = sizeLabel(room);
        const { w, h } = roomSize(room);
        return (
          <g
            key={room.id}
            tabIndex={0}
            role="button"
            aria-label={`${room.name}, ${size}`}
            aria-pressed={selected}
            className="focus-visible:outline-none"
            onFocus={() => onSelect(room.id)}
            onKeyDown={(e) => onRoomKey(e, room)}
            onPointerDown={(e) => {
              onSelect(room.id);
              const p = toFt(e);
              begin(e, { mode: "move", room, dx: p.x - room.x, dy: p.y - room.y });
            }}
            style={{ cursor: editable ? "move" : "default" }}
          >
            <rect
              x={room.x}
              y={room.y}
              width={w}
              height={h}
              fill="var(--brand-soft)"
              stroke={selected ? "var(--brand-ink)" : "var(--brand)"}
              strokeWidth={selected ? 2.5 : 1.25}
              vectorEffect="non-scaling-stroke"
            />
            <text textAnchor="middle" className="fill-foreground" fontSize={0.95} fontWeight={600}>
              <tspan x={room.x + w / 2} y={room.y + h / 2 - 0.2}>
                {room.name}
              </tspan>
              {h >= 4 ? (
                <>
                  {" "}
                  <tspan
                    x={room.x + w / 2}
                    y={room.y + h / 2 + 1.1}
                    className="fill-muted-foreground"
                    fontSize={0.8}
                    fontWeight={400}
                  >
                    {size}
                  </tspan>
                </>
              ) : null}
            </text>
            {selected && editable ? (
              <rect
                x={room.x + w - 0.6}
                y={room.y + h - 0.6}
                width={1.2}
                height={1.2}
                rx={0.15}
                fill="var(--brand-ink)"
                style={{ cursor: "nwse-resize" }}
                aria-hidden="true"
                onPointerDown={(e) => begin(e, { mode: "resize", room })}
              />
            ) : null}
          </g>
        );
      })}
      {sketch ? (
        <rect
          x={sketch.x}
          y={sketch.y}
          width={sketch.w}
          height={sketch.h}
          fill="var(--brand-soft)"
          fillOpacity={0.6}
          stroke="var(--brand-ink)"
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}
