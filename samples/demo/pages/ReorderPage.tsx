import { useCallback, useMemo, useRef, useState } from "react";
import { Colors, SkiaButton, SkiaLabel, SkiaLayer, SkiaScroll, SkiaStack, SkiaWrap, Thickness } from "drawnui-react";
import type { SkiaScroll as SkiaScrollCtrl } from "drawnui-react/core";
import { ReorderCell, type DragHost, type ReorderItem } from "./ReorderCell";

const COLORS = ["#0D6EFD", "#6610F2", "#D63384", "#FD7E14", "#20C997", "#0DCAF0", "#FFC107"];
const INITIAL: ReorderItem[] = Array.from({ length: 60 }, (_, i) => ({
  Id: i + 1,
  Title: `Row ${String(i + 1).padStart(2, "0")} · drag me by the grip`,
  Color: COLORS[i % COLORS.length],
}));
const SPACING = 6;
const STATUS_HEIGHT = 58;

/**
 * Drag to reorder: a templated list reordered in place while it is being dragged.
 *
 * Every step writes a permuted array, which the layout recognises as a reorder of the same items: it rebinds the cells
 * it already has and moves their measured heights with them instead of rebuilding the structure, so the list does not
 * jump under the pointer and the scroll keeps its offset. Hold near the top or bottom edge and the list keeps moving,
 * which is how a row reaches a position that was off screen when the drag started.
 */
export function ReorderPage() {
  const [items, setItems] = useState<ReorderItem[]>(INITIAL);
  const [status, setStatus] = useState("drag a row by its grip, or use the buttons");
  const scroll = useRef<SkiaScrollCtrl>(null);
  const live = useRef<ReorderItem[]>(items);
  const dragging = useRef<ReorderItem | undefined>(undefined);
  live.current = items;

  const report = useCallback((what: string) => {
    const offset = scroll.current?.ViewportOffsetY ?? 0;
    setStatus(`${what} · offset ${offset.toFixed(0)} pt · order ${live.current.slice(0, 6).map((i) => i.Id).join(", ")}…`);
  }, []);

  const move = useCallback((from: number, to: number) => {
    const cur = live.current;
    if (to < 0 || to >= cur.length || from < 0 || from >= cur.length) return false;
    const next = cur.slice();
    next.splice(to, 0, next.splice(from, 1)[0]);
    live.current = next;
    setItems(next);
    return true;
  }, []);

  // one object for the whole page: cells are recycled, so the template must not rebuild the host per row
  const host = useMemo<DragHost>(() => ({
    Scroll: () => scroll.current ?? undefined,
    IndexOf: (item) => live.current.indexOf(item),
    Move: (from, to) => { const ok = move(from, to); if (ok) report("dragging"); return ok; },
    Dragging: () => dragging.current,
    SetDragging: (item) => { dragging.current = item; report(item ? "picked up" : "dropped"); },
    Spacing: SPACING,
  }), [move, report]);

  const template = useCallback(() => new ReorderCell(host), [host]);

  return (
    <SkiaLayer VerticalOptions="Fill">
      <SkiaStack Spacing={2} Margin={new Thickness(0, 8, 0, 0)}>
        <SkiaLabel Text={`${items.length} rows · drag by the grip, hold at an edge to keep going`} FontSize={13} TextColor={Colors.LightGray} HorizontalOptions="Center" />
        <SkiaLabel Text={status} FontSize={12} TextColor="#6EA8FE" HorizontalOptions="Center" />
      </SkiaStack>

      <SkiaScroll ref={scroll} Orientation="Vertical" Margin={new Thickness(0, STATUS_HEIGHT, 0, 44)} Scrolled={() => report("scrolled")}>
        <SkiaStack
          ItemsSource={items}
          ItemTemplate={template}
          RecyclingTemplate="Enabled"
          MeasureItemsStrategy="MeasureFirst"
          Spacing={SPACING}
          Padding={new Thickness(12, 8)}
        />
      </SkiaScroll>

      <SkiaWrap Spacing={6} Margin={new Thickness(8, 0, 8, 8)} HorizontalOptions="Center" VerticalOptions="End">
        <SkiaButton Text="Move #1 below #10" FontSize={13} BackgroundColor="#495057" Tapped={() => { move(0, 9); report("moved 1 → 10"); }} />
        <SkiaButton Text="Reverse" FontSize={13} BackgroundColor="#495057" Tapped={() => { live.current = live.current.slice().reverse(); setItems(live.current); report("reversed"); }} />
        <SkiaButton Text="Reset" FontSize={13} BackgroundColor="#495057" Tapped={() => { live.current = INITIAL; setItems(INITIAL); report("reset"); }} />
      </SkiaWrap>
    </SkiaLayer>
  );
}
