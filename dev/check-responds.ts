// Input off (drawnui-cross 6w, C# RespondsToGesturesTests), checked in Node (`npm run check:responds`) through the
// engine Canvas gesture routing: RespondsToGestures = false switches a control off for the user the same way on every
// control. A tap on a switched-off button, switch, checkbox or radio does nothing and does not reach the control under
// it, keyboard navigation skips the control (CanReceiveGesture) and screen readers report it disabled, also after a
// change at runtime. The button's IsDisabled is its obsolete opposite. A switched-off scroll still lets its content
// take taps.
import { readFileSync } from "node:fs";
import {
  Super, SKRect, SKPoint, Canvas, SkiaAccessibilityManager, HoverManager, SkiaLayer, SkiaShape, SkiaButton, SkiaSwitch,
  SkiaCheckbox, SkiaRadioButton, SkiaSlider, SkiaScroll, SkiaGesturesParameters, TouchActionEventArgs, Aria,
  type SkiaControl, type SkiaToggle, type AnimatorBase, type TouchActionResult,
} from "../src/index.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
const W = 300, H = 300;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

class FakeCanvas {
  readonly AccessibilityManager = new SkiaAccessibilityManager();
  readonly Hover = new HoverManager();
  readonly AnimatingControls = new Map<number, AnimatorBase>();
  RenderingScale = 1;
  GpuEpoch = 0;
  Update(): void {}
  readonly disposeQueue: { Dispose(): void }[] = [];
  DisposeObject(o: { Dispose(): void }): void { this.disposeQueue.push(o); }
  RegisterAnimator(a: AnimatorBase): boolean { this.AnimatingControls.set(a.Uid, a); return true; }
  UnregisterAnimator(uid: number): void { this.AnimatingControls.delete(uid); }
}

/** The control centered over a full-size shape that counts its taps (C# Scene). */
class Scene {
  readonly fake = new FakeCanvas();
  readonly root = new SkiaLayer();
  tapsUnder = 0;
  private readonly canvas = Object.create(Canvas.prototype) as Canvas & { gestureOwner: SkiaControl | null; activeTouchIds: Set<number> };

  constructor(readonly control: SkiaControl, private readonly CK: any) {
    control.HorizontalOptions = "Center"; control.VerticalOptions = "Center";
    control.AccessibilityLabel = "Probe";
    const under = new SkiaShape(); under.HorizontalOptions = "Fill"; under.VerticalOptions = "Fill";
    under.Tapped = () => { this.tapsUnder++; };
    this.root.WidthRequest = W; this.root.HeightRequest = H;
    this.root.AddSubView(under); this.root.AddSubView(control);
    this.root._superview = this.fake as unknown as Canvas;
    this.fake.AccessibilityManager.MinUpdateIntervalMs = 0;
    this.canvas.gestureOwner = null; this.canvas.activeTouchIds = new Set();
    this.frames(3);
  }

  frames(n: number): void {
    for (let i = 0; i < n; i++) {
      const surface = this.CK.MakeSurface(W, H);
      this.root.Measure(W, H, 1); this.root.Arrange(new SKRect(0, 0, W, H), W, H, 1);
      this.root.Render({ Context: { Canvas: surface.getCanvas(), Surface: surface }, Destination: new SKRect(0, 0, W, H), Scale: 1 });
      surface.delete();
      for (const o of this.fake.disposeQueue.splice(0)) o.Dispose();
      this.fake.AccessibilityManager.OnFrameEnd(1, W, H, () => {});
    }
  }

  send(type: TouchActionResult, x = W / 2, y = H / 2): void {
    const a = new TouchActionEventArgs(); a.Location = new SKPoint(x, y); a.StartingLocation = a.Location; a.Scale = 1;
    if (type === "Down") this.canvas.activeTouchIds.add(1);
    (this.canvas as unknown as { ProcessGestures(r: SkiaControl, p: SkiaGesturesParameters): SkiaControl | null }).ProcessGestures(this.root, SkiaGesturesParameters.Create(type, a));
    if (type === "Up") this.canvas.activeTouchIds.delete(1);
  }

  tap(): void { this.send("Down"); this.send("Up"); this.send("Tapped"); this.frames(2); }

  snapshotCanInteract(): boolean | undefined { return this.fake.AccessibilityManager.Snapshot.find((n) => n.Label === "Probe")?.CanInteract; }
}

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;
  const face = CK.Typeface.MakeFreeTypeFaceFromData(readFileSync(`${ROOT}/samples/public/fonts/OpenSans-Regular.ttf`).buffer);
  Super.Fonts.set("FontText", new Map([[400, face]])); Super.DefaultTypeface = face; Super.DefaultFontAlias = "FontText";

  const toggles: [string, () => SkiaToggle][] = [
    ["switch", () => { const t = new SkiaSwitch(); t.WidthRequest = 60; t.HeightRequest = 32; return t; }],
    ["checkbox", () => { const t = new SkiaCheckbox(); t.WidthRequest = 32; t.HeightRequest = 32; return t; }],
    ["radio", () => { const t = new SkiaRadioButton(); t.WidthRequest = 120; t.HeightRequest = 32; t.Text = "Probe"; return t; }],
  ];
  for (const [kind, make] of toggles) {
    const toggle = make();
    toggle.RespondsToGestures = false;
    const scene = new Scene(toggle, CK);
    toggle.IsToggled = false; // a lone radio button selects itself when it appears
    scene.tap();
    check(`${kind} off: a tap does not toggle it and stops there`, !toggle.IsToggled && scene.tapsUnder === 0, `toggled ${toggle.IsToggled}, taps under ${scene.tapsUnder}`);
    check(`${kind} off: keyboard skips it, reported disabled`, !toggle.AccessibilityCanInteract && !toggle.CanReceiveGesture("Tapped") && scene.snapshotCanInteract() === false, `snapshot ${scene.snapshotCanInteract()}`);
    toggle.RespondsToGestures = true;
    scene.frames(2);
    const after = scene.snapshotCanInteract();
    scene.tap();
    check(`${kind} back on at runtime: reported enabled, a tap toggles it`, after === true && toggle.IsToggled, `snapshot ${after}, toggled ${toggle.IsToggled}`);
  }

  {
    let tapped = 0, down = 0;
    const button = new SkiaButton(); button.Text = "Probe"; button.WidthRequest = 120; button.HeightRequest = 40; button.AccessibilityRole = Aria.RoleButton;
    button.Tapped = () => { tapped++; };
    button.Down = () => { down++; };
    button.RespondsToGestures = false;
    const scene = new Scene(button, CK);
    scene.send("Down");
    const pressed = button.IsPressed;
    scene.send("Up");
    scene.tap();
    check("button off: no press, no Down, no Tapped, the tap stops there", !pressed && down === 0 && tapped === 0 && scene.tapsUnder === 0, `pressed ${pressed}, down ${down}, tapped ${tapped}, taps under ${scene.tapsUnder}`);
    check("button off: keyboard skips it, reported disabled", !button.CanReceiveGesture("Tapped") && scene.snapshotCanInteract() === false, `snapshot ${scene.snapshotCanInteract()}`);
    button.RespondsToGestures = true;
    scene.frames(2);
    const after = scene.snapshotCanInteract();
    scene.tap();
    check("button back on at runtime: reported enabled, a tap reaches it", after === true && tapped === 1, `snapshot ${after}, tapped ${tapped}`);
  }

  {
    const button = new SkiaButton();
    button.IsDisabled = true;
    const a = !button.RespondsToGestures && button.IsDisabled;
    button.RespondsToGestures = true;
    check("button IsDisabled is the opposite of RespondsToGestures", a && !button.IsDisabled);
  }

  {
    const slider = new SkiaSlider(); slider.WidthRequest = 200; slider.HeightRequest = 40; slider.RespondsToGestures = false;
    const scene = new Scene(slider, CK);
    check("slider off: arrow keys skip it, reported disabled", !slider.CanReceiveGesture("Panning") && scene.snapshotCanInteract() === false, `snapshot ${scene.snapshotCanInteract()}`);
  }

  {
    let taps = 0;
    const scroll = new SkiaScroll(); scroll.WidthRequest = 200; scroll.HeightRequest = 200; scroll.RespondsToGestures = false;
    const content = new SkiaShape(); content.HorizontalOptions = "Fill"; content.HeightRequest = 400; content.Tapped = () => { taps++; };
    scroll.Content = content;
    const scene = new Scene(scroll, CK);
    scene.tap();
    check("scroll off: its content still takes taps", taps === 1 && content.CanReceiveGesture("Tapped"), `${taps} taps`);
    check("scroll off: the scroll itself takes no input", !scroll.CanReceiveGesture("Panning"));
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: RespondsToGestures switches input off");
  process.exit(failures ? 1 : 0);
})();
