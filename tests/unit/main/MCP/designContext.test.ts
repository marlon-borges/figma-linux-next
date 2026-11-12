/**
 * get_design_context renders layers as markup with CSS. The script runs against
 * a small fake Plugin API: these tests pin what an agent relies on — variables
 * by name, text style names with one definition, components named and written
 * out once, icons collapsed, nothing at its default value.
 */

import { describe, expect, it } from "bun:test";

import { DESIGN_CONTEXT_SCRIPT } from "Main/MCP/scripts";

const run = async (figma: any, nodeId: string | null, depth = 10) =>
  JSON.parse(
    await new Function("window", `return (${DESIGN_CONTEXT_SCRIPT(nodeId, depth)});`)({ figma }),
  );

const solid = (r: number, g: number, b: number, varId?: string) => ({
  type: "SOLID",
  visible: true,
  opacity: 1,
  blendMode: "NORMAL",
  color: { r, g, b },
  ...(varId ? { boundVariables: { color: { type: "VARIABLE_ALIAS", id: varId } } } : {}),
});

function base(id: string, name: string, type: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    type,
    visible: true,
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    rotation: 0,
    opacity: 1,
    blendMode: "PASS_THROUGH",
    fills: [],
    strokes: [],
    effects: [],
    strokeWeight: 1,
    cornerRadius: 0,
    topLeftRadius: 0,
    topRightRadius: 0,
    bottomRightRadius: 0,
    bottomLeftRadius: 0,
    constraints: { horizontal: "MIN", vertical: "MIN" },
    layoutMode: "NONE",
    paddingLeft: 0,
    paddingRight: 0,
    paddingTop: 0,
    paddingBottom: 0,
    itemSpacing: 0,
    ...extra,
  } as any;
}

function text(id: string, characters: string, extra: Record<string, unknown> = {}) {
  return base(id, characters, "TEXT", {
    characters,
    textAutoResize: "WIDTH_AND_HEIGHT",
    fontName: { family: "Inter", style: "Bold" },
    fontSize: 22,
    lineHeight: { unit: "PIXELS", value: 29 },
    letterSpacing: { unit: "PERCENT", value: 0 },
    textAlignHorizontal: "LEFT",
    textStyleId: "S:heading",
    fills: [solid(0.08, 0.1, 0.12, "V:text")],
    layoutSizingHorizontal: "HUG",
    layoutSizingVertical: "HUG",
    ...extra,
  });
}

function scene() {
  const tabSet = {
    type: "COMPONENT_SET",
    name: "TabBar",
    key: "tab-key",
    description: "Floating glass bar.",
  };
  const tabMain = {
    id: "9:1",
    name: "Active=Home",
    remote: true,
    key: "tab-variant",
    parent: tabSet,
  };
  const iconMain = {
    id: "9:2",
    name: "Icon/search",
    remote: true,
    key: "icon-key",
    description: "Search glyph",
  };
  const tab = (id: string, label: string) =>
    base(id, "TabBar", "INSTANCE", {
      layoutMode: "HORIZONTAL",
      layoutSizingHorizontal: "FILL",
      layoutSizingVertical: "HUG",
      primaryAxisAlignItems: "MIN",
      counterAxisAlignItems: "CENTER",
      getMainComponentAsync: async () => tabMain,
      componentProperties: {
        Active: { type: "VARIANT", value: "Home" },
        "Badge#12:3": { type: "BOOLEAN", value: true },
      },
      children: [
        text(`${id};1`, label, {
          textStyleId: "",
          fontName: { family: "Inter", style: "Medium" },
          fontSize: 12,
        }),
      ],
    });
  const icon = base("3:1", "Icon/search", "INSTANCE", {
    getMainComponentAsync: async () => iconMain,
    children: [
      base("3:2", "vector", "FRAME", {
        children: [
          base("3:3", "Vector", "VECTOR", { strokes: [solid(0.08, 0.1, 0.12, "V:text")] }),
        ],
      }),
    ],
  });
  const hiddenNote = text("4:1", "Draft note", { visible: false });
  const root = base("1:1", "Home", "FRAME", {
    width: 390,
    height: 844,
    layoutMode: "VERTICAL",
    primaryAxisAlignItems: "MIN",
    counterAxisAlignItems: "MIN",
    itemSpacing: 12,
    paddingTop: 14,
    paddingRight: 16,
    paddingBottom: 0,
    paddingLeft: 16,
    fills: [solid(0.96, 0.97, 0.98, "V:bg")],
    boundVariables: { itemSpacing: { type: "VARIABLE_ALIAS", id: "V:gap" } },
    children: [
      text("2:1", "Consultations"),
      icon,
      hiddenNote,
      tab("5:1", "Home"),
      tab("5:2", "Visits"),
    ],
  });
  const page = { id: "0:1", name: "Screens", type: "PAGE", parent: null as any };
  root.parent = page;
  const variables: Record<string, any> = {
    "V:bg": { name: "color/bg", codeSyntax: { WEB: "var(--ds-color-bg)" } },
    "V:text": { name: "color/text", codeSyntax: {} },
    "V:gap": { name: "space/3", codeSyntax: {} },
    "V:size": { name: "text/xl", codeSyntax: {} },
  };
  const figma: any = {
    root: { name: "App" },
    currentPage: { selection: [] },
    getNodeByIdAsync: async (id: string) => (id === "1:1" ? root : id === "0:1" ? page : null),
    getStyleByIdAsync: async (id: string) =>
      id === "S:heading"
        ? {
            name: "Heading/XL",
            description: "Screen title",
            fontName: { family: "Inter", style: "Bold" },
            fontSize: 22,
            lineHeight: { unit: "PIXELS", value: 29 },
            letterSpacing: { unit: "PERCENT", value: -1 },
            boundVariables: { fontSize: { type: "VARIABLE_ALIAS", id: "V:size" } },
          }
        : null,
    variables: { getVariableByIdAsync: async (id: string) => variables[id] ?? null },
  };
  return { figma };
}

describe("get_design_context", () => {
  it("writes the layout as CSS with variables by name and no default values", async () => {
    const { text } = await run(scene().figma, "1:1");
    const rootLine = text.split("\n").find((l: string) => l.includes('id="1:1"'));
    expect(rootLine).toContain("display:flex;flex-direction:column");
    expect(rootLine).toContain("gap:var(--space-3, 12px)");
    expect(rootLine).toContain("padding:14px 16px 0");
    expect(rootLine).toContain("background:var(--ds-color-bg, #f5f7fa)");
    for (const noise of ["opacity", "rotate", "VariableID", "visible", "constraints", "0.9616"]) {
      expect(text).not.toContain(noise);
    }
  });

  it("names the page the node is on and the file", async () => {
    const { text } = await run(scene().figma, "1:1");
    expect(text.split("\n")[0]).toBe('<!-- file "App", page "Screens" (0:1) -->');
  });

  it("refers to a text style by name and defines it once in the legend", async () => {
    const { text } = await run(scene().figma, "1:1");
    expect(text).toContain(
      '<text id="2:1" text-style="Heading/XL" style="color:var(--color-text, #141a1f)">Consultations</text>',
    );
    expect(text).toContain(
      "- Heading/XL: Inter Bold, 22px/29px, letter-spacing -0.01em; variables fontSize=text/xl (Screen title)",
    );
    expect(text).toContain("- color/bg: --ds-color-bg = #f5f7fa");
  });

  it("writes a repeated component out once, later instances only with the text that differs", async () => {
    const { text } = await run(scene().figma, "1:1");
    expect(text).toContain('component="TabBar" variant="Active=Home" props="Badge=true"');
    expect(text).toContain(">Home</text>");
    expect(text).toContain('same-as="5:1" texts="Visits"');
    expect(text).not.toContain(">Visits</text>");
    expect(text).toContain("- TabBar (library, key tab-key): Floating glass bar.");
  });

  it("collapses an icon to one svg element and leaves hidden layers out", async () => {
    const { text } = await run(scene().figma, "1:1");
    expect(text).toContain('<svg id="3:1" name="Icon/search" component="Icon/search"');
    expect(text).not.toContain('id="3:3"');
    expect(text).not.toContain("Draft note");
    expect(text).toContain("1 hidden layer(s) left out.");
  });

  it("cuts off at the depth asked for and says how to get the rest", async () => {
    const { text } = await run(scene().figma, "1:1", 0);
    expect(text).toContain('children="4 more: call again on this id"');
  });

  it("asks for a frame when given a page", async () => {
    const { error } = await run(scene().figma, "0:1");
    expect(error).toContain("needs a layer, not a page");
  });
});

describe("get_design_context — 3D transforms", () => {
  // Shapes and expected CSS read from Figma's own Plugin API and getCSSAsync() on 2026-11-12.
  const t3 = (extra: Record<string, number | boolean>) => ({
    type: "FIXED_ORDER",
    translateZ: 0,
    rotateX: 0,
    rotateY: 0,
    rotateZ: 0,
    backfaceVisible: true,
    visible: true,
    ...extra,
  });
  const center = { x: { unit: "PERCENT", value: 50 }, y: { unit: "PERCENT", value: 50 } };

  function stage(
    children: any[],
    scene3d: any = { perspective: 900, preserve3d: true, visible: true },
  ) {
    const root = base("1:1", "Stage", "FRAME", { width: 800, height: 500, scene3d, children });
    root.parent = { id: "0:1", name: "Page", type: "PAGE", parent: null };
    const figma: any = {
      root: { name: "3D" },
      currentPage: { selection: [] },
      getNodeByIdAsync: async (id: string) => (id === "1:1" ? root : null),
      getStyleByIdAsync: async (): Promise<null> => null,
      variables: { getVariableByIdAsync: async (): Promise<null> => null },
    };
    return figma;
  }
  const line = (text: string, id: string) =>
    text.split("\n").find((l: string) => l.includes(`id="${id}"`)) ?? "";
  const card = (id: string, extra: Record<string, unknown>) =>
    base(id, id, "RECTANGLE", { transformOrigin: center, ...extra });

  it("writes the scene's perspective and the children's 3D transforms like Dev Mode", async () => {
    const { text } = await run(
      stage([
        card("2:1", { transform3d: t3({ rotateY: 45.00000125 }) }),
        card("2:2", { transform3d: t3({ translateZ: 80, rotateX: 34.9999998, rotateZ: 12 }) }),
      ]),
      "1:1",
    );
    expect(line(text, "1:1")).toContain("perspective:900px;transform-style:preserve-3d");
    expect(line(text, "2:1")).toContain("transform:rotateY(45deg)");
    expect(line(text, "2:2")).toContain("transform:translateZ(80px) rotateX(35deg) rotateZ(12deg)");
    expect(text).not.toContain("transform-origin");
    expect(text).not.toContain("backface");
  });

  it("puts the 2D rotation first and adds origin and hidden backface when set", async () => {
    const { text } = await run(
      stage([
        card("2:1", { rotation: 20, transform3d: t3({ rotateX: 30 }) }),
        card("2:2", {
          transform3d: t3({ rotateY: 30, backfaceVisible: false }),
          transformOrigin: { x: { unit: "PIXELS", value: 0 }, y: { unit: "PERCENT", value: 100 } },
        }),
      ]),
      "1:1",
    );
    expect(line(text, "2:1")).toContain("transform:rotate(-20deg) rotateX(30deg)");
    expect(line(text, "2:2")).toContain(
      "transform-origin:0px 100%;backface-visibility:hidden;transform:rotateY(30deg)",
    );
  });

  it("leaves out a 3D effect that is toggled off, which the canvas does not draw", async () => {
    const { text } = await run(
      stage(
        [
          card("2:1", { transform3d: t3({ rotateX: 40, visible: false }) }),
          card("2:2", {
            transform3d: { type: "NONE" },
            transformOrigin: { x: { unit: "PERCENT", value: 0 }, y: { unit: "PERCENT", value: 0 } },
          }),
        ],
        { perspective: 300, preserve3d: true, visible: false },
      ),
      "1:1",
    );
    for (const noise of ["transform", "perspective", "rotate"]) expect(text).not.toContain(noise);
  });

  it("writes a perspective without preserve-3d when the scene flattens its children", async () => {
    const { text } = await run(
      stage([], { perspective: 500, preserve3d: false, visible: true }),
      "1:1",
    );
    expect(line(text, "1:1")).toContain("perspective:500px");
    expect(text).not.toContain("preserve-3d");
  });
});
