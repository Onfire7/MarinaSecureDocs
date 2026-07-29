import { useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Drag-to-reorder list with a keyboard-operable handle.
 *
 * Replaces paired ↑/↓ buttons, where moving an item from position 15 to 1
 * cost 14 clicks *and* 14 transactions. Dragging is tracked in local state
 * and `onReorder` fires once on drop, so a long drag is still a single write.
 *
 * Pointer events rather than HTML5 drag-and-drop: the same code then covers
 * touch, which matters because Admin gets used on a tablet at the dock.
 * Arrow keys on the focused handle do the same job for keyboard and
 * screen-reader users, who can't drag at all.
 */
export function ReorderableList<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
  enabled = true,
}: {
  items: T[];
  /** Called once per completed move, with the full new id order. */
  onReorder: (orderedIds: string[]) => void;
  renderItem: (item: T, index: number) => ReactNode;
  /** Off for unordered modes (a freeform tour has no sequence to express). */
  enabled?: boolean;
}) {
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  // The order at pointer-down, so a drag that lands where it started writes
  // nothing rather than churning a no-op transaction.
  const startOrder = useRef<string[]>([]);

  const byId = new Map(items.map((it) => [it.id, it]));
  const ordered =
    dragOrder
      ? (dragOrder.map((rowId) => byId.get(rowId)).filter(Boolean) as T[])
      : items;

  const move = (order: string[], from: number, to: number): string[] => {
    if (from === to || from < 0 || to < 0 || to >= order.length) return order;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  };

  const onPointerDown = (e: React.PointerEvent, rowId: string) => {
    if (!enabled) return;
    e.preventDefault();
    const order = ordered.map((it) => it.id);
    startOrder.current = order;
    setDragOrder(order);
    setDraggingId(rowId);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingId || !dragOrder) return;
    // Rows sit in DOM order, so the first one whose midpoint is below the
    // pointer is the slot the dragged row belongs in.
    let target = dragOrder.length - 1;
    for (let i = 0; i < dragOrder.length; i++) {
      const el = rowRefs.current.get(dragOrder[i]);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        target = i;
        break;
      }
    }
    const from = dragOrder.indexOf(draggingId);
    const next = move(dragOrder, from, target);
    if (next !== dragOrder) setDragOrder(next);
  };

  const onPointerUp = () => {
    if (dragOrder && dragOrder.join() !== startOrder.current.join()) {
      onReorder(dragOrder);
    }
    setDragOrder(null);
    setDraggingId(null);
  };

  const nudge = (rowId: string, delta: -1 | 1) => {
    const order = ordered.map((it) => it.id);
    const from = order.indexOf(rowId);
    const next = move(order, from, from + delta);
    if (next !== order) onReorder(next);
  };

  return (
    <div className="stack" style={{ gap: 4 }}>
      {ordered.map((item, i) => (
        <div
          key={item.id}
          ref={(el) => {
            if (el) rowRefs.current.set(item.id, el);
            else rowRefs.current.delete(item.id);
          }}
          className={
            "reorder-row" + (draggingId === item.id ? " reorder-dragging" : "")
          }
        >
          {enabled && (
            <button
              type="button"
              className="reorder-handle"
              aria-label={`Reorder — item ${i + 1} of ${ordered.length}. Use arrow keys to move.`}
              onPointerDown={(e) => onPointerDown(e, item.id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  nudge(item.id, -1);
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  nudge(item.id, 1);
                }
              }}
            >
              ⠿
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>{renderItem(item, i)}</div>
        </div>
      ))}
    </div>
  );
}
