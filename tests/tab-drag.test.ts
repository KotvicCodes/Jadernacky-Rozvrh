import { describe, expect, it } from 'vitest';
import { tabDragFrame, type TabSlot } from '../src/tab-drag';

// Three 100 px tabs with a 4 px gap: 0–100, 104–204, 208–308.
const slots: TabSlot[] = [0, 104, 208].map((left) => ({ left, width: 100 }));

describe('tabDragFrame', () => {
  it('stays in place for a small movement', () => {
    expect(tabDragFrame(slots, 0, 20, 4)).toEqual({ target: 0, offset: 20, shifts: [0, 0, 0] });
  });

  it('opens a gap by sliding the passed tab the other way', () => {
    // At +40 the first tab's right edge (140) is still before the second tab's middle (154).
    expect(tabDragFrame(slots, 0, 40, 4).target).toBe(0);
    // At +60 it (160) is past it: the second tab slides left by a tab and a gap.
    expect(tabDragFrame(slots, 0, 60, 4)).toEqual({ target: 1, offset: 60, shifts: [0, -104, 0] });
    expect(tabDragFrame(slots, 0, 215, 4)).toEqual({ target: 2, offset: 208, shifts: [0, -104, -104] });
  });

  it('moves tabs right when dragging to the left', () => {
    expect(tabDragFrame(slots, 2, -110, 4)).toEqual({ target: 1, offset: -110, shifts: [0, 104, 0] });
    expect(tabDragFrame(slots, 2, -500, 4)).toEqual({ target: 0, offset: -208, shifts: [104, 104, 0] });
  });

  it('keeps the dragged tab inside the bar', () => {
    expect(tabDragFrame(slots, 1, 999, 4).offset).toBe(104);
    expect(tabDragFrame(slots, 1, -999, 4).offset).toBe(-104);
  });

  it('closes the gap when the pointer is far from the bar', () => {
    expect(tabDragFrame(slots, 0, 215, 4, false)).toEqual({ target: 0, offset: 208, shifts: [0, 0, 0] });
  });

  it('reaches either end even when the dragged tab is wider than the last one', () => {
    const mixed: TabSlot[] = [{ left: 0, width: 200 }, { left: 204, width: 60 }, { left: 268, width: 60 }];
    expect(tabDragFrame(mixed, 0, 999, 4)).toEqual({ target: 2, offset: 128, shifts: [0, -204, -204] });
    const mirrored: TabSlot[] = [{ left: 0, width: 60 }, { left: 64, width: 60 }, { left: 128, width: 200 }];
    expect(tabDragFrame(mirrored, 2, -999, 4)).toEqual({ target: 0, offset: -128, shifts: [204, 204, 0] });
  });

  it('handles tabs of different widths', () => {
    const mixed: TabSlot[] = [{ left: 0, width: 60 }, { left: 64, width: 200 }, { left: 268, width: 80 }];
    // The 80 px tab, dragged left past the wide tab's centre (164), takes its place.
    expect(tabDragFrame(mixed, 2, -150, 4)).toEqual({ target: 1, offset: -150, shifts: [0, 84, 0] });
  });
});
