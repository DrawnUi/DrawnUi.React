# DrawnUI 3D for React

Real 3D inside a drawn UI: glTF models with their skeleton animations, a product viewer that turns, zooms and resets,
many animated characters on a 2D game field in one pass, shapes made in code, images on materials, and Lit, Toon or
Flat looks with an outline. It draws through the WebGL 2 context [DrawnUI for React](https://www.npmjs.com/package/drawnui-react)
already uses, so a 3D view sits in your layouts, scrolls, caches and gestures like any other control.

Live demo: [add3dreact.drawnui.net](https://add3dreact.drawnui.net) · Source of the demo:
[samples/add3d](https://github.com/DrawnUi/DrawnUi.React/tree/master/samples/add3d)

```bash
npm i drawnui-react drawnui-react-add3d
```

## A model viewer

```tsx
import { SkiaModel3D } from "drawnui-react-add3d";

<SkiaModel3D
  Glb={avatarGlb}                     // the .glb file's bytes (keep the same array between renders)
  Animation="Idle"
  Yaw={25} Pitch={10}
  PinchZoom={true}                    // pinch or Ctrl+wheel zooms, a plain wheel scrolls the page
  ResetOnDoubleTap={true}
  HorizontalOptions="Fill"
  HeightRequest={320}
  Tapped3D={(me, hit) => me.PlayOnce("Wave")}
/>
```

- Load from bytes (`Glb`), from an address (`Source`, with `LoadState` and `LoadStateChanged`), or a model made in code
  (`Model`).
- Animations: `Animation` loops, `Play`, `PlayOnce`, `Hold`, `PlayLayer`, `CrossfadeMs`, `Speed`, `AnimationEnded`.
- Nodes and materials by name: `SetNodeVisible`, `SetNodeRotation`, `SetMaterialColor`, `SetMaterialImage`,
  `SetMaterialRoughness`. Names come from the file: `Animations`, `NodeNames`, `MaterialNames`.
- Inside a scroll a drag picks its direction: up and down scrolls the page, sideways turns the model.
- `Look` (`Look.Lit`, `Look.Toon`, `Look.Flat`), `OutlineWidth`, `OutlineColor`, `Antialias`.
- `ScreenPosition(point)` tells where a 3D point is on screen and whether the model hides it, for pins and labels.

## Shapes made in code

```tsx
import { SkiaModel3D, Model3D, Mesh3D, Texture3D } from "drawnui-react-add3d";

const earth = useMemo(() => new Model3D().Part("earth", Mesh3D.Sphere(1), "#FFFFFF"), []);

<SkiaModel3D Model={earth} ref={(m) => { m?.SetMaterialImage("earth", Texture3D.Decode(earthJpg)); }} />
```

Meshes: `Sphere`, `Cylinder`, `Torus`, `Cuboid`, `RoundedCuboid`, `Lathe` (a turned profile) and `Extrude` (any path
made 3D), placed with `At`, `Turned`, `Scaled` and `Inside(parent)`.

## Many characters in one pass

```tsx
import { SkiaScene3D, type SkiaScene3DCtrl } from "drawnui-react-add3d";

const field = useRef<SkiaScene3DCtrl>(null);
useEffect(() => {
  const f = field.current!;
  f.Model("slime", slimeGlb);
  f.Add("mob7", "slime", 120, 80, 48);    // name, model, place in points, height
  f.Play("mob7", "Walk");
}, []);

<SkiaScene3D ref={field} Tilt={30} HorizontalOptions="Fill" VerticalOptions="Fill"
  Tapped3D={(me, hit) => me.PlayOnce(hit.Object, "Hit")} />
```

Objects move like sprites (`SetPosition`, `SetFacing`), each with its own animation, and each model is loaded once
whatever the number of objects.

## License

MIT, as every DrawnUI package.
