// The 3D add-on's CPU side, checked in Node (`npm run check:add3d`): matrix math (inverse, TRS round trip, slerp ends), the
// glTF reader on the gallery's models (animations, nodes, materials, a finite box), the skin matrix order (at the bind pose
// every joint matrix leaves a skinned vertex where the file has it), sampling, and rays (the camera's center ray meets the
// model; one from the side away from it does not).
import { readFileSync } from "node:fs";
import { Super } from "../src/index.ts";
import { FromTRS, Invert, Mul, Decompose, SlerpInto, Mat4Identity } from "../add3d/src/math.ts";
import { Scene3D, LOCAL } from "../add3d/src/scene.ts";
import { Player3D } from "../add3d/src/player.ts";

declare const CanvasKitInit: (o: { locateFile: () => string }) => Promise<any>;
const ROOT = process.cwd();
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const near = (a: number, b: number, e = 1e-4) => Math.abs(a - b) <= e;

(async () => {
  (Super as unknown as { CK: unknown }).CK = await CanvasKitInit({ locateFile: () => `${ROOT}/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` });

  // math
  const m = FromTRS(new Float32Array(16), [1, 2, 3], [0.2, 0.3, 0.1, Math.sqrt(1 - 0.14)], [2, 3, 4]);
  const inv = new Float32Array(16);
  Invert(inv, m);
  const id = Mul(new Float32Array(16), m, inv);
  check("a matrix times its inverse is the identity", Array.from(id).every((v, i) => near(v, Mat4Identity()[i], 1e-5)));
  const d = Decompose(m);
  check("TRS decomposed gives its parts back", near(d.T[0], 1) && near(d.S[2], 4) && near(Math.abs(d.R[3]), Math.sqrt(1 - 0.14)), JSON.stringify(d));
  const q = new Float32Array(4);
  const a = [0, 0, 0, 1], b = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
  SlerpInto(q, 0, a, 0, b, 0, 0); const at0 = Array.from(q);
  SlerpInto(q, 0, a, 0, b, 0, 1); const at1 = Array.from(q);
  check("slerp starts at a and ends at b", at0.every((v, i) => near(v, a[i])) && at1.every((v, i) => near(v, b[i])));

  for (const name of ["avatar", "mob", "dragon", "sofa", "gift"]) {
    const bytes = readFileSync(`${ROOT}/samples/add3d/public/assets/${name}.glb`);
    const { Scene: scene, Error: error } = Scene3D.Shared(new Uint8Array(bytes));
    if (!scene) { check(`${name}: read`, false, error); continue; }
    const size = scene.BoundsMax.map((v, i) => v - scene.BoundsMin[i]);
    check(`${name}: read, a finite box`, size.every((v) => Number.isFinite(v) && v > 0), `${scene.Nodes.length} nodes, ${scene.Materials.length} materials, ${scene.Animations.length} animations, box ${size.map((v) => v.toFixed(2)).join(" x ")}`);
    // a skinned primitive at the bind pose: the posed vertices are where the file has them (joint * inverse bind = 1)
    const pose = scene.Pose(-1, 0);
    let worst = 0, skinned = 0;
    scene.Nodes.forEach((node, i) => {
      if (node.Mesh < 0 || node.Skin < 0) return;
      for (const p of scene.Meshes[node.Mesh]) {
        if (!p.Skinned) continue;
        skinned++;
        const out = new Float32Array(p.Positions.length);
        scene.PosedPositions(i, p, pose, out);
        // exporters bind a skin where its mesh node stands: at the bind pose a skinned vertex lands where the mesh node's
        // world matrix puts it (the wrong multiplication order lands it somewhere else entirely)
        const w = pose.subarray(i * 16, i * 16 + 16);
        for (let v = 0; v < out.length; v += 3) {
          const x = p.Positions[v], y = p.Positions[v + 1], z = p.Positions[v + 2];
          worst = Math.max(worst, Math.abs(out[v] - (w[0] * x + w[4] * y + w[8] * z + w[12])), Math.abs(out[v + 1] - (w[1] * x + w[5] * y + w[9] * z + w[13])), Math.abs(out[v + 2] - (w[2] * x + w[6] * y + w[10] * z + w[14])));
        }
      }
    });
    // only files whose rest pose is their bind pose (the chest) can say it; the avatar and the dragon rest in another pose
    if (skinned && name === "gift") check(`${name}: skinned vertices at the bind pose land where the mesh node stands (joint x inverse bind)`, worst < 0.05 * Math.max(...size), `${skinned} primitives, worst ${worst.toFixed(4)}`);
    // one animation sampled through the player: finite locals, unit rotations
    if (scene.Animations.length) {
      const player = new Player3D(scene);
      player.Advance(scene, 0.37);
      const local = new Float32Array(scene.Nodes.length * LOCAL);
      player.Locals(scene, local);
      let bad = 0;
      for (let i = 0; i < scene.Nodes.length; i++) { const l = Math.hypot(local[i * LOCAL + 3], local[i * LOCAL + 4], local[i * LOCAL + 5], local[i * LOCAL + 6]); if (!near(l, 1, 1e-3) || !Array.from(local.subarray(i * LOCAL, i * LOCAL + LOCAL)).every(Number.isFinite)) bad++; }
      check(`${name}: an animation sampled at 0.37 s gives finite locals and unit rotations`, bad === 0, `${bad} bad nodes`);
    }
    // rays: the camera's center ray meets the model, a ray from far to the side going away does not
    const camera = scene.Camera(new Float32Array(16), 20, 10, 1, 1);
    const { From, Dir } = Scene3D.Ray(camera, 0.5, 0.5);
    const hidden = new Array(scene.Nodes.length).fill(false);
    const hit = scene.RayHit(pose, hidden, [], From, Dir);
    const away = scene.RayHit(pose, hidden, [], [scene.BoundsMax[0] + 10, 0, 0], [1, 0, 0]);
    check(`${name}: the center ray meets the model, a ray going away does not`, !!hit && !away, hit ? `node ${scene.Nodes[hit.Node].Name}` : "no hit");
  }

  console.log(failures ? `FAIL: ${failures} checks` : "OK: the 3D add-on's math, reader, skins, animations and rays");
  process.exit(failures ? 1 : 0);
})();
