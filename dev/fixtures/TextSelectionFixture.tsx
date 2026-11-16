// A page for the text-selection checks (drawnui-cross 6cb / 6cc: dev/check-text-selection.mjs,
// dev/check-touch-contextmenu.mjs), mounted over the demo by the checks through the dev server: three selectable labels
// and a selectable link in a column with padding around them, a button, and a scroll 200 pt tall that holds ten selectable
// labels (more than it shows). Exposes window.__sel: the canvas, the text copied through Super.SetClipboardText, the link's
// taps, every context menu the canvas routes (its Source and what was selected then), and At(text, index): the page point
// (CSS px) at the left edge of a character of the label showing that text, mid-height of its line.
import { createRoot } from "react-dom/client";
import { Canvas, SkiaButton, SkiaLabel, SkiaScroll, SkiaStack, Super, Thickness } from "drawnui-react";
import { SkiaControl, SkiaShape as SkiaShapeCtrl, SkiaStack as SkiaStackCtrl, type Canvas as CanvasView, type SkiaLabel as Label } from "drawnui-react/core";

interface Sel { Canvas?: CanvasView; Copied: string[]; LinkTaps: number; LinkMenuChosen: number; Menus: { Source: string; Selected: string }[]; Find(text: string): Label | undefined; At(text: string, index: number): { X: number; Y: number } }

export function Mount(): void {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:600px;height:700px;z-index:10000;background:#111";
  document.body.appendChild(host);
  const sel: Sel = {
    Copied: [], LinkTaps: 0, LinkMenuChosen: 0, Menus: [],
    Find(text) {
      const walk = (c: SkiaControl | undefined): Label | undefined => {
        if (!c) return undefined;
        if ((c as Label).Text === text && "SelectedText" in c) return c as Label;
        const kids = "Views" in c ? (c as unknown as { Views: SkiaControl[] }).Views : (c as unknown as { Content?: SkiaControl }).Content ? [(c as unknown as { Content: SkiaControl }).Content] : [];
        for (const k of kids) { const f = walk(k); if (f) return f; }
        return undefined;
      };
      return walk(sel.Canvas?.Content as SkiaControl | undefined);
    },
    At(text, index) {
      const label = sel.Find(text)!, canvas = sel.Canvas!, k = canvas.RenderingScale, el = canvas.Element.getBoundingClientRect();
      const r = label.GetAccessibilityPixelRect(), box = label.GetGlyphBoxes().find((b) => b.Index === index);
      const line = label.GetLineBoxes().find((l) => index <= l.End)!;
      const x = box ? box.Left + 1 : line.Left + line.Width + 1, y = box ? box.Top + box.Height / 2 : line.Top + line.Height / 2;
      return { X: el.left + (r.Left + x) / k, Y: el.top + (r.Top + y) / k };
    },
  };
  (window as unknown as { __sel: Sel }).__sel = sel;
  Super.SetClipboardText = (t) => { sel.Copied.push(t); };
  // every context menu the canvas routes into its tree (the outermost call), with what was selected then
  let depth = 0;
  const route = SkiaControl.prototype.ProcessContextMenu;
  SkiaControl.prototype.ProcessContextMenu = function (this: SkiaControl, point, e) {
    if (depth === 0) sel.Menus.push({ Source: e.Source, Selected: sel.Canvas?.SelectedText ?? "" });
    depth++;
    try { return route.call(this, point, e); } finally { depth--; }
  };
  const label = (text: string) => <SkiaLabel AccessibilityTextSelectable Text={text} FontSize={16} TextColor="#FFFFFF" />;
  createRoot(host).render(
    <Canvas ref={(v: CanvasView | null) => { sel.Canvas = v ?? undefined; }}
      BackgroundColor="#111111" Gestures="Enabled" style={{ width: "600px", height: "700px" }}>
      <SkiaStack Padding={new Thickness(40, 30)} Spacing={24} HorizontalOptions="Fill">
        {label("Alpha label one")}
        {label("Bravo label two")}
        <SkiaLabel AccessibilityTextSelectable Text="Delta link" FontSize={16} TextColor="#FFD06E" AccessibilityRole="link" AccessibilityLabel="Delta link"
          Tapped={() => { sel.LinkTaps++; }}
          ContextMenu={(me, e) => {
            // the link's menu: one item that closes it, as an app's Copy Link
            const canvas = me.Superview!;
            let id = 0;
            const item = new SkiaShapeCtrl(); item.WidthRequest = 140; item.HeightRequest = 36; item.BackgroundColor = "#333333";
            item.AccessibilityRole = "menuitem"; item.AccessibilityLabel = "Copy Link"; item.AccessibilityCanInteract = true;
            item.Tapped = () => { sel.LinkMenuChosen++; canvas.ClosePopupWindow(id); };
            const menu = new SkiaStackCtrl(); menu.AccessibilityRole = "menu"; menu.AccessibilityLabel = "Link"; menu.AddSubView(item);
            id = canvas.OpenPopupWindow(menu, e.Location);
            return true;
          }} />
        {label("Charlie label three")}
        <SkiaButton Text="Button" WidthRequest={120} />
        <SkiaScroll HeightRequest={200} HorizontalOptions="Fill" BackgroundColor="#222222">
          <SkiaStack Spacing={12} Padding={new Thickness(10)}>
            {Array.from({ length: 10 }, (_, i) => <SkiaLabel key={i} AccessibilityTextSelectable Text={`Scroll line ${i}`} FontSize={16} TextColor="#FFFFFF" />)}
          </SkiaStack>
        </SkiaScroll>
      </SkiaStack>
    </Canvas>,
  );
}
