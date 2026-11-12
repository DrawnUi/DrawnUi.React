// Dungeon Run rules and scene builder, checked in Node: `node dev/check.mjs samples/dungeon/tests/check-world.ts`.
// The tests of the .NET port's WorldTests.cs (themselves DrawnUi.Rust examples/dungeon scene.rs tests), the hash
// pinned to values of the Rust formula, and one frame of the title built without a canvas.
import { World, Row, RowKind, Input } from "../src/game/world";
import { Scene, FLOATS } from "../src/game/scene";
import { SKRect } from "drawnui-react/core";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

// The title's player survives by the rules a real player dies by, at the speeds it runs at.
{
  const world = new World();
  world.Start();
  let hit = "";
  for (let frame = 0; frame < 60 * 30 && !hit; frame++) {
    const input = world.Pilot(1.0 / 60.0);
    world.Step(1.0 / 60.0, input);
    if (world.Hits !== 0) hit = `hit at ${world.Z} (row ${World.GetRow(Math.trunc(world.Z / 2.0))})`;
  }
  check("the pilot survives 30 s", !hit, hit || `z ${world.Z.toFixed(3)}`);
  check("the pilot takes > 20 orbs", world.Orbs > 20, `orbs ${world.Orbs}`);
}

// Pillars never close the lane the orbs before them lead to.
{
  let bad = "";
  for (let i = 0; i < 5000 && !bad; i++) {
    const row = World.GetRow(i * 5);
    if (row.Kind === RowKind.Pillars && ((row.Mask & (1 << (World.OrbLane(i - 1) + 1))) !== 0 || row.Mask === 0b111)) bad = `group ${i}: ${row}`;
  }
  check("pillars leave the orb lane free", !bad, bad);
}

// hash(i, salt) and hash01 bit for bit: values of the Rust formula.
const PINS: [number, number, number, number][] = [
  [0, 0, 0, 0.0],
  [1, 1, 2024154872, 0.1522216796875],
  [5, 2, 1511060883, 0.9592742919921875],
  [-7, 3, 1473460281, 0.2196197509765625],
  [123456, 6, 195828540, 0.10638427734375],
  [1499, 9, 135605569, 0.1767730712890625],
  [-1, 10, 1014960292, 0.06500244140625],
  [42, 5, 1156144076, 0.35858154296875],
];
for (const [i, salt, h, h01] of PINS) {
  const got = World.Hash(i, salt), got01 = World.Hash01(i, salt);
  check(`hash(${i}, ${salt})`, got === h && got01 === h01, `${got} ${got01}`);
}

// The 32-bit-halves hash against BigInt u64 math over many rows, negative and large ones included.
{
  const M = (1n << 64n) - 1n;
  const ref = (i: number, salt: number) => {
    let x = ((BigInt.asUintN(64, BigInt(i)) * 0x9e3779b97f4a7c15n) & M) ^ ((BigInt(salt) * 0xbf58476d1ce4e5b9n) & M);
    x ^= x >> 30n; x = (x * 0xbf58476d1ce4e5b9n) & M;
    x ^= x >> 27n; x = (x * 0x94d049bb133111ebn) & M;
    return Number(x >> 33n);
  };
  let bad = "";
  let seed = 12345;
  for (let n = 0; n < 20000 && !bad; n++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const i = n < 10000 ? n - 5000 : (seed - 2147483648) * 1048576 + n; // up to about +-2^51
    const salt = n % 11;
    if (World.Hash(i, salt) !== ref(i, salt)) bad = `i ${i} salt ${salt}: ${World.Hash(i, salt)} vs ${ref(i, salt)}`;
  }
  check("hash equals BigInt u64 math on 20000 rows", !bad, bad);
}

// Floor division and modulo for negative numbers, as Rust's div_euclid / rem_euclid.
for (const [a, div, rem] of [[-1, -1, 4], [-5, -1, 0], [-6, -2, 4], [7, 1, 2]]) {
  check(`euclid(${a}, 5)`, World.DivEuclid(a, 5) === div && World.RemEuclid(a, 5) === rem, `${World.DivEuclid(a, 5)} ${World.RemEuclid(a, 5)}`);
}

// The row cache returns what the rules compute, whatever order rows are asked in.
{
  const forward: Row[] = [];
  for (let i = 0; i < 3000; i++) forward.push(World.GetRow(i));
  let bad = "";
  for (let i = forward.length - 1; i >= 0 && !bad; i -= 7) if (!forward[i].Equals(World.GetRow(i))) bad = `row ${i}`;
  check("row cache is transparent", !bad, bad);
}

// One frame of the title's run, built without a canvas at 1280x800.
{
  const scene = new Scene();
  const rect = new SKRect(0, 0, 1280, 800);
  const report = (what: string, world: World) => {
    const floats = scene.Build(world, rect);
    const triangles = floats / (3 * FLOATS);
    check(`builder: ${what}`, triangles > 0 && Number.isInteger(triangles),
      `z ${world.Z.toFixed(4)}, ${triangles} triangles, bounds ${scene.MeshLeft.toFixed(3)} ${scene.MeshTop.toFixed(3)} ${scene.MeshRight.toFixed(3)} ${scene.MeshBottom.toFixed(3)}`);
    return triangles;
  };
  report("title, first frame", scene.World);
  const input = new Input();
  for (let frame = 0; frame < 600; frame++) scene.World.Step(1.0 / 60.0, input);
  report("title after 600 steps of 1/60 s", scene.World);

  // Builder speed: one frame's build, averaged.
  const t0 = performance.now();
  for (let n = 0; n < 1000; n++) scene.Build(scene.World, rect);
  console.log(`info builder ${((performance.now() - t0) / 1000).toFixed(3)} ms a frame`);
}

if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log("all passed");
