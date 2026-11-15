// A model viewer fits its model tightly, never cut, whatever the view's shape, turn or tilt (DrawnUi.Net FramingTests),
// checked in Node (`npm run check:add3d-framing`): a 2.6 x 1 x 1 box with FrameMargin 0.3 in views of several shapes, turned
// by the user (Orbit) or not: every corner of the box with its margin projects inside the view, and the box spans most of
// it along the side that limits it; a ball keeps its size on screen when tilted.
import { Super, SKRect } from "../src/index.ts";
import { SkiaModel3D } from "../add3d/src/SkiaModel3D.ts";
import { Model3D, Mesh3D } from "../add3d/src/shapes.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

const viewer = (model: Model3D, w: number, h: number, props: Partial<SkiaModel3D>) => {
  const m = Object.assign(new SkiaModel3D(model), { HorizontalOptions: "Fill", VerticalOptions: "Fill", ...props });
  m.Measure(w, h, 1); m.Arrange(new SKRect(0, 0, w, h), -1, -1, 1);
  return m;
};

(async () => {
  const CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });
  (Super as unknown as { CK: unknown }).CK = CK;

  const half = [1.3, 0.5, 0.5], margin = 0.3;
  const corners = Array.from({ length: 8 }, (_, i) => [(i & 1) ? half[0] + margin : -half[0] - margin, (i & 2) ? half[1] + margin : -half[1] - margin, (i & 4) ? half[2] + margin : -half[2] - margin] as [number, number, number]);
  const cases: [number, number, number, number, boolean][] = [
    [800, 250, 0, 0, true], [800, 250, 37, 30, true], [200, 400, 0, 0, true], [200, 400, 63, 60, true], [300, 300, 125, -40, true],
    // nobody turns it: fitted exactly as seen
    [800, 250, 0, 32, false], [200, 400, 0, 32, false], [300, 300, 125, -40, false],
  ];
  for (const [w, h, yaw, pitch, orbit] of cases) {
    const m = viewer(new Model3D().Part("box", Mesh3D.Cuboid(2.6, 1, 1), "#FFFFFF"), w, h, { Yaw: yaw, Pitch: pitch, FrameMargin: margin, Orbit: orbit });
    const at = corners.map((c) => m.ScreenPosition(c)!);
    const xs = at.map((p) => p.X), ys = at.map((p) => p.Y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const inView = minX >= -0.5 && maxX <= w + 0.5 && minY >= -0.5 && maxY <= h + 0.5;
    const fill = orbit ? 0.55 : 0.75;
    const tight = (maxX - minX) / w > fill || (maxY - minY) / h > fill;
    check(`${w}x${h} yaw ${yaw} pitch ${pitch} ${orbit ? "turned by the user" : "fixed"}: the whole box stays in view, tightly`, inView && tight,
      `x ${minX.toFixed(0)}..${maxX.toFixed(0)} of ${w}, y ${minY.toFixed(0)}..${maxY.toFixed(0)} of ${h}`);
  }

  // a ball keeps its size when tilted (turning a globe to a city tilts it)
  const ball = viewer(new Model3D().Part("earth", Mesh3D.Sphere(1), "#FFFFFF"), 600, 400, {});
  const width = () => { const y = (ball.Yaw * Math.PI) / 180, r: [number, number, number] = [Math.cos(y), 0, -Math.sin(y)]; return Math.abs(ball.ScreenPosition(r)!.X - ball.ScreenPosition([-r[0], 0, -r[2]])!.X); };
  const level = width();
  const widths = [20, 45, 70, -40].map((p) => { ball.Pitch = p; return width(); });
  check("a ball keeps its size on screen when tilted", widths.every((v) => v > level * 0.97 && v < level * 1.03), `${level.toFixed(0)} level, ${widths.map((v) => v.toFixed(0)).join(", ")}`);

  // SkiaModel3D.Fling (DrawnUi.Net ViewerApiTests): a fling turns, slows and stops; turning Fling off stops it
  {
    const m = viewer(new Model3D().Part("box", Mesh3D.Cuboid(1, 1, 1), "#FFFFFF"), 300, 300, { Fling: true, Yaw: 0 });
    m.StartFling(200, 0);
    const y0 = m.Yaw; m.Advance(0.1); const y1 = m.Yaw; m.Advance(0.1); const y2 = m.Yaw;
    const turns = y1 - y0 > 5 && y2 - y1 > 0 && y2 - y1 < y1 - y0;
    for (let i = 0; i < 400; i++) m.Advance(0.016);
    const ya = m.Yaw; m.Advance(0.1);
    check("a fling turns the model, slows down and stops", turns && Math.abs(m.Yaw - ya) < 1e-6, `steps ${(y1 - y0).toFixed(1)}, ${(y2 - y1).toFixed(1)}; after 6.5 s ${(m.Yaw - ya).toFixed(4)}`);
    m.StartFling(200, 0); m.Fling = false;
    const yb = m.Yaw; m.Advance(0.1);
    check("turning Fling off stops a fling", Math.abs(m.Yaw - yb) < 1e-6);
  }

  // Mesh3D.RoundedCuboid (DrawnUi.Net RoundedCuboidTests)
  {
    const m = Mesh3D.RoundedCuboid(2, 1, 1, 0.2), P = m.Positions, N = m.Normals, n = P.length / 3;
    let inside = true, sharp = false, unitOut = true;
    const top: number[] = [];
    for (let i = 0; i < n; i++) {
      const [x, y, z] = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], [nx, ny, nz] = [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]];
      if (Math.abs(x) > 1.0001 || Math.abs(y) > 0.5001 || Math.abs(z) > 0.5001) inside = false;
      if (Math.abs(x) > 0.99 && Math.abs(y) > 0.49 && Math.abs(z) > 0.49) sharp = true;
      if (Math.abs(Math.hypot(nx, ny, nz) - 1) > 1e-3 || x * nx + y * ny + z * nz <= 0) unitOut = false;
      if (Math.abs(x) <= 0.8001 && Math.abs(z) <= 0.3001 && y > 0.4999) top.push(ny);
    }
    check("RoundedCuboid: points inside the box, no sharp corner, unit normals pointing out, a flat top facing up",
      m.Indices.length > 0 && inside && !sharp && unitOut && top.length > 0 && top.every((v) => Math.abs(v - 1) < 1e-4), `inside ${inside}, sharp ${sharp}, normals ${unitOut}, top ${top.length}`);
    const a = Mesh3D.RoundedCuboid(1, 1, 1, 0.1, true), per = a.Uvs.length / 2 / 6;
    let cells = true;
    for (let f = 0; f < 6; f++) for (let k = 0; k < per; k++) {
      const u = a.Uvs[(f * per + k) * 2], v = a.Uvs[(f * per + k) * 2 + 1], col = f % 3, row = Math.floor(f / 3);
      if (u < col / 3 - 1e-4 || u > (col + 1) / 3 + 1e-4 || v < row / 2 - 1e-4 || v > (row + 1) / 2 + 1e-4) cells = false;
    }
    check("RoundedCuboid with an atlas: each face takes its own cell of the 3 x 2 image", cells);
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: a viewer fits its model tightly and never cuts it; rounded cuboids");
  process.exit(failures ? 1 : 0);
})();
