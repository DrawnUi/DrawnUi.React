/**
 * Actions an app declares for the DrawnUI Designer (C# DrawnUi.Draw.DesignerActions): named states it can jump to without
 * being played to them (a level, a game state, a dialog). The designer lists them under the app's screens and runs one on
 * a click; AI agents run them through the designer's MCP (`list_actions`, `run_action`).
 *
 * A path names the action and its groups, slash-separated: "Levels/Level 3" shows as "Level 3" under "Levels". Nothing
 * here runs unless a designer is attached: the list only keeps the names and their callbacks.
 *
 * ```ts
 * for (let level = 1; level <= 20; level++) designerAction(`Levels/Level ${level}`, () => game.startLevel(level));
 * designerAction("Dialogs/Options", () => game.showOptions());
 * ```
 */
export class DesignerActions {
  private static readonly items: { Path: string; Run: () => void }[] = [];

  /** Raised after the list changed (an action added, replaced or removed); the designer agent sends the new list. */
  static readonly Changed = new Set<() => void>();

  private static RaiseChanged(): void { for (const h of [...DesignerActions.Changed]) h(); }

  /**
   * Adds an action, or replaces the one with the same path (keeping its place). Returns the function that removes it
   * again (an action a screen offers while it is shown); it removes only this registration, not a later one of the path.
   */
  static Add(path: string, run: () => void): () => void {
    if (!path || !path.trim()) throw new Error("DesignerActions: an action needs a path");
    if (typeof run !== "function") throw new Error("DesignerActions: an action needs a function");
    const items = DesignerActions.items, at = items.findIndex((x) => x.Path === path);
    const item = { Path: path, Run: run };
    if (at >= 0) items[at] = item; else items.push(item);
    DesignerActions.RaiseChanged();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const i = DesignerActions.items.indexOf(item);
      if (i < 0) return;
      DesignerActions.items.splice(i, 1);
      DesignerActions.RaiseChanged();
    };
  }

  /** Removes the action with this path, if there is one. */
  static Remove(path: string): void {
    const i = DesignerActions.items.findIndex((x) => x.Path === path);
    if (i < 0) return;
    DesignerActions.items.splice(i, 1);
    DesignerActions.RaiseChanged();
  }

  /** The declared actions' paths, in the order they were added. */
  static get Paths(): string[] { return DesignerActions.items.map((x) => x.Path); }

  /** Runs the action with this path; false when there is no such action. */
  static Run(path: string): boolean {
    const item = DesignerActions.items.find((x) => x.Path === path);
    if (!item) return false;
    item.Run();
    return true;
  }
}

/** Declares a Designer action (DesignerActions.Add); returns the function that removes it. Usable outside React. */
export function designerAction(path: string, run: () => void): () => void { return DesignerActions.Add(path, run); }
