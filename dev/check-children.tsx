// Children changes reach what is drawn, in collection order (C# 66a1eb02, GitHub #156), checked in Node through the real
// React reconciler (`npm run check:children`): insert, replace, move and clear of keyed JSX children, the same with a
// part the control made itself (it keeps its place), the `Children` list, keyed TextSpans, and a toggle rebuilding
// its own content.
import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { SkiaLayer, SkiaStack, SkiaLabel, TextSpan } from "../src/react/index.tsx";
import { createDrawnRoot, Registry } from "../src/react/reconciler.ts";
import {
  Super, SKRect, SkiaStack as SkiaStackCtrl, SkiaLayer as SkiaLayerCtrl, SkiaSwitch, type SkiaControl, type SkiaLabel as SkiaLabelCtrl, type Canvas,
} from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
let failures = 0;
const check = (name: string, got: string, want: string) => { const ok = got === want; if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${got}${ok ? "" : ` (want ${want})`}`); };

/** A stack with a part it made itself, like a control's own content (not an app child). */
class Owned extends SkiaStackCtrl {
  readonly own = new SkiaLayerCtrl();
  constructor() { super(); this.own.Tag = "own"; this.own.HeightRequest = 5; this.AddSubView(this.own); }
}
Registry.Owned = Owned as never;
const OwnedTag = "Owned" as unknown as typeof SkiaStack;

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  Super.Fonts.set("FontText", new Map([[400, CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer)]]));
  Super.DefaultFontAlias = "FontText";

  const canvas = { Content: undefined } as unknown as Canvas;
  const root = createDrawnRoot(canvas);
  const render = async (el: ReactElement) => { root.render(el); await new Promise((r) => setTimeout(r, 30)); };
  const tags = (l: SkiaControl) => (l as SkiaStackCtrl).Views.map((v) => v.Tag).join(",");
  /** Tags in drawn order: laid out as a column, sorted by where each child is arranged. */
  const drawn = (l: SkiaControl) => {
    l.Measure(100, 2000, 1); l.Arrange(new SKRect(0, 0, 100, 2000), -1, -1, 1);
    return [...(l as SkiaStackCtrl).Views].filter((v) => v.Tag !== "own").sort((a, b) => a.DrawingRect.Top - b.DrawingRect.Top).map((v) => v.Tag).join(",");
  };
  const item = (k: string) => <SkiaLayer key={k} Tag={k} HeightRequest={10} />;
  let layout!: SkiaControl;
  const stack = (keys: string[]) => <SkiaStack ref={(c: SkiaControl | null) => { if (c) layout = c; }}>{keys.map(item)}</SkiaStack>;

  // plain layout: insert, replace, move, clear
  await render(stack(["A", "B", "C"]));
  check("start", tags(layout), "A,B,C");
  await render(stack(["A", "X", "B", "C"]));
  check("insert in the middle (views)", tags(layout), "A,X,B,C");
  check("insert in the middle (drawn)", drawn(layout), "A,X,B,C");
  const b = (layout as SkiaStackCtrl).Views[2];
  await render(stack(["A", "Y", "C"]));
  check("replace", tags(layout), "A,Y,C");
  check("replaced child detached", String(b.Parent === undefined), "true");
  await render(stack(["C", "A", "Y"]));
  check("move (views, no copies)", tags(layout), "C,A,Y");
  check("move (drawn)", drawn(layout), "C,A,Y");
  await render(stack(["Y", "C"]));
  check("move + remove", tags(layout), "Y,C");
  await render(stack([]));
  check("clear", tags(layout), "");

  // a control with its own part: app children follow the collection, the own part keeps its place
  const owned = (keys: string[]) => <OwnedTag ref={(c: SkiaControl | null) => { if (c) layout = c; }}>{keys.map(item)}</OwnedTag>;
  await render(<SkiaLayer />);
  await render(owned(["A", "B"]));
  check("own part + children", tags(layout), "own,A,B");
  await render(owned(["B", "A"]));
  check("own part + move", tags(layout), "own,B,A");
  await render(owned(["Z", "B", "A"]));
  check("own part + insert first", tags(layout), "own,Z,B,A");
  await render(owned([]));
  check("own part survives a clear", tags(layout), "own");

  // a part the control adds after its children (a toggle builds its content at the first measure) keeps its index,
  // like C# OrderViews: the children fill the slots around it
  await render(<SkiaLayer />);
  await render(stack(["A", "B"]));
  const late = new SkiaLayerCtrl(); late.Tag = "late"; layout.AddSubView(late);
  await render(stack(["X", "A", "B"]));
  check("late part + insert first", tags(layout), "X,A,late,B");
  await render(stack(["B", "X", "A"]));
  check("late part + move", tags(layout), "B,X,late,A");
  await render(stack(["B", "X", "A", "N"]));
  check("late part + append", tags(layout), "B,X,late,A,N");
  await render(stack([]));
  check("late part survives a clear", tags(layout), "late");

  // the Children list (C# collection reset): drops only app children, keeps the own part's slot
  const o = new Owned();
  const mk = (t: string) => { const v = new SkiaLayerCtrl(); v.Tag = t; v.HeightRequest = 10; return v; };
  const [p, q, r] = [mk("P"), mk("Q"), mk("R")];
  o.Children = [p, q, r];
  check("Children = [P,Q,R]", tags(o), "own,P,Q,R");
  o.Children = [r, p];
  check("Children = [R,P]", tags(o), "own,R,P");
  check("dropped child detached", String(q.Parent === undefined), "true");
  check("Children = [R,P] (drawn)", drawn(o), "R,P");
  o.Children = [];
  check("Children = [] keeps the own part", tags(o), "own");

  // keyed spans of a label
  let label!: SkiaLabelCtrl;
  const spans = (keys: string[]) => <SkiaLabel ref={(c: SkiaLabelCtrl | null) => { if (c) label = c; }}>{keys.map((k) => <TextSpan key={k} Text={k} />)}</SkiaLabel>;
  await render(spans(["a", "b", "c"]));
  await render(spans(["c", "a", "b"]));
  check("span move", label.Spans.map((s) => s.Text).join(","), "c,a,b");

  // a toggle rebuilding its own content drops all of it (C# ClearChildren), then builds it once
  const toggle = new SkiaSwitch();
  toggle.Measure(200, 100, 1);
  const parts = toggle.Views.length;
  toggle.RebuildDefaultContent();
  check("toggle rebuild clears its parts", String(toggle.Views.length), "0");
  toggle.Measure(200, 100, 1);
  check("toggle rebuild builds them once", String(toggle.Views.length), String(parts));

  console.log(failures ? `FAIL: ${failures} checks` : "OK: children changes follow the collection");
  process.exit(failures ? 1 : 0);
})();
