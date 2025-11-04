// Headless, single-run rename & audit
figma.skipInvisibleInstanceChildren = true;

let HAS_RUN = false; // run-once guard

const DEFAULT_FRAME_NAME_RE = /^Frame( \d+)?$/;

// Style-category → new layer name
const categories = {
  heading: "heading-text",
  title: "title-text",
  subtitle: "subtitle-text",
  body: "body-text",
  highlighted: "highlighted-text",
  info: "info-text",
  caption: "caption-text",
  overline: "overline-text",
};

// Allowed text color variable/style paths
const colorPaths = {
  regular: "colors/content/text/regular/",
  inverse: "colors/content/text/inverse/",
  brand: "colors/content/text/brand/",
};

// Colors always allowed (never flagged mismatched)
const stateColors = new Set([
  "colors/content/text/state/info",
  "colors/content/text/state/success",
  "colors/content/text/state/warning",
  "colors/content/text/state/error",
  "colors/content/text/regular/disabled",
]);

// Build category → { newName, color[] }
const styleCategories = {};
for (const cat in categories) {
  const newName = categories[cat];
  const color =
    cat === "highlighted"
      ? [colorPaths.brand + cat, colorPaths.inverse + cat]
      : [colorPaths.regular + cat, colorPaths.inverse + cat];
  styleCategories[cat] = { newName, color };
}

/* ---------------- helpers ---------------- */

function isVisible(node) {
  return typeof node.visible === "boolean" ? node.visible : true;
}

// Rename "Frame"/"Frame N" → "item" under a root; return count
function renameDefaultFramesIn(root) {
  let count = 0;

  if (root.type === "FRAME" && DEFAULT_FRAME_NAME_RE.test(root.name)) {
    try { root.name = "item"; count++; } catch (e) {}
  }
  if ("findAll" in root) {
    const frames = root.findAll(
      (n) => n.type === "FRAME" && isVisible(n) && DEFAULT_FRAME_NAME_RE.test(n.name)
    );
    for (let i = 0; i < frames.length; i++) {
      try { frames[i].name = "item"; count++; } catch (e) {}
    }
  }
  return count;
}

// Collect all visible TEXT nodes under current selection
function collectTextNodes(selection) {
  const texts = [];
  for (let i = 0; i < selection.length; i++) {
    const root = selection[i];
    if (!isVisible(root)) continue;

    if (root.type === "TEXT") texts.push(root);
    if ("findAll" in root) {
      const found = root.findAll((n) => n.type === "TEXT" && isVisible(n));
      if (found && found.length) texts.push(...found);
    }
  }
  return texts;
}

// Return first bound fill variable id per your rule (fills[0])
function firstBoundFillVarId(node) {
  const bv = node.boundVariables && node.boundVariables.fills;
  if (!bv) return null;

  if (Array.isArray(bv) && bv.length > 0) {
    const v0 = bv[0];
    if (typeof v0 === "string") return v0;
    if (v0 && typeof v0 === "object" && v0.id) return v0.id;
  } else if (typeof bv === "object" && bv !== null && bv.hasOwnProperty("0")) {
    const v00 = bv["0"];
    if (typeof v00 === "string") return v00;
    if (v00 && typeof v00 === "object" && v00.id) return v00.id;
  } else if (typeof bv === "string") {
    return bv;
  }
  return null;
}

// Batch-load styles into a cache (id → Style|null)
async function preloadStyles(ids) {
  const cache = new Map();
  const seen = new Set();
  const unique = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (id && typeof id === "string" && !seen.has(id)) {
      seen.add(id);
      unique.push(id);
    }
  }
  await Promise.all(
    unique.map((id) =>
      figma
        .getStyleByIdAsync(id)
        .then((s) => cache.set(id, s || null))
        .catch((e) => cache.set(id, null))
    )
  );
  return cache;
}

// Batch-load variables into a cache (id → Variable|null)
async function preloadVariables(ids) {
  const cache = new Map();
  const seen = new Set();
  const unique = [];
  const hasVarApi =
    figma.variables && typeof figma.variables.getVariableByIdAsync === "function";

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (id && typeof id === "string" && !seen.has(id)) {
      seen.add(id);
      unique.push(id);
    }
  }

  if (!hasVarApi) {
    for (let i = 0; i < unique.length; i++) cache.set(unique[i], null);
    return cache;
  }

  await Promise.all(
    unique.map((id) =>
      figma.variables
        .getVariableByIdAsync(id)
        .then((v) => cache.set(id, v || null))
        .catch((e) => cache.set(id, null))
    )
  );
  return cache;
}

function makeCountsParts(textRenamed, framesRenamed) {
  const parts = [];
  if (textRenamed > 0)
    parts.push(`${textRenamed} text layer${textRenamed === 1 ? "" : "s"} renamed`);
  if (framesRenamed > 0)
    parts.push(`${framesRenamed} frame${framesRenamed === 1 ? "" : "s"} renamed`);
  return parts;
}

/* ---------------- main ---------------- */

async function main() {
  if (HAS_RUN) return; // prevent double-execution
  HAS_RUN = true;

  const selection = figma.currentPage.selection;
  if (!selection || selection.length === 0) {
    figma.notify("Select at least one frame or text layer.");
    figma.closePlugin();
    return;
  }

  // 1) Rename default frames → "item"
  let framesRenamed = 0;
  for (let i = 0; i < selection.length; i++) {
    framesRenamed += renameDefaultFramesIn(selection[i]);
  }

  // 2) Collect text nodes
  const textNodes = collectTextNodes(selection);

  // If there are no text nodes, decide message now
  if (textNodes.length === 0) {
    const didRename = framesRenamed > 0;
    if (didRename) {
      const msg = makeCountsParts(0, framesRenamed).join(". ") + ".";
      figma.notify(msg);
    } else {
      figma.notify("✨ Everything is perfect!");
    }
    figma.closePlugin();
    return;
  }

  // 3) Preload referenced styles (text + fill)
  const textStyleIds = [];
  const fillStyleIds = [];
  for (let i = 0; i < textNodes.length; i++) {
    const t = textNodes[i];
    if (typeof t.textStyleId === "string" && t.textStyleId) textStyleIds.push(t.textStyleId);
    if (typeof t.fillStyleId === "string" && t.fillStyleId) fillStyleIds.push(t.fillStyleId);
  }
  const styleCache = await preloadStyles([].concat(textStyleIds, fillStyleIds));

  // 4) Rename text layers based on style category
  let textRenamed = 0;
  const staged = []; // { node, mapping }
  for (let i = 0; i < textNodes.length; i++) {
    const tn = textNodes[i];

    const ts =
      typeof tn.textStyleId === "string" && tn.textStyleId
        ? styleCache.get(tn.textStyleId)
        : null;

    if (!ts || ts.type !== "TEXT" || typeof ts.name !== "string") continue;

    const category = ts.name.split("/")[0]; // prefix before '/'
    const mapping = styleCategories[category];
    if (!mapping) continue;

    if (tn.name !== mapping.newName) {
      try { tn.name = mapping.newName; textRenamed++; } catch (e) {}
    }
    staged.push({ node: tn, mapping });
  }

  // 5) Color audit only if we have staged nodes
  let mismatched = [];
  if (staged.length > 0) {
    const firstVarIds = [];
    for (let i = 0; i < staged.length; i++) {
      const id0 = firstBoundFillVarId(staged[i].node);
      if (id0) firstVarIds.push(id0);
    }
    const varCache = await preloadVariables(firstVarIds);

    for (let i = 0; i < staged.length; i++) {
      const node = staged[i].node;
      const expected = staged[i].mapping.color; // array of allowed names
      let ok = false;

      // Prefer variable (fills[0]) if present
      const id0 = firstBoundFillVarId(node);
      if (id0) {
        const variable = varCache.get(id0);
        const vName = variable && variable.name ? variable.name : null;
        if (vName && (expected.indexOf(vName) !== -1 || stateColors.has(vName))) ok = true;
      } else if (typeof node.fillStyleId === "string" && node.fillStyleId) {
        const fillStyle = styleCache.get(node.fillStyleId);
        const fsName = fillStyle && fillStyle.name ? fillStyle.name : null;
        if (fsName && (expected.indexOf(fsName) !== -1 || stateColors.has(fsName))) ok = true;
      }

      if (!ok) mismatched.push(node);
    }
  }

  // 6) Select & notify — EXACTLY ONE bubble with correct content
  const didRename = textRenamed > 0 || framesRenamed > 0;
  const hasMismatches = mismatched.length > 0;
  const countsParts = makeCountsParts(textRenamed, framesRenamed);

  if (hasMismatches) {
    try { figma.currentPage.selection = mismatched; } catch (e) {}
    const mis = `${mismatched.length} mismatched layer${mismatched.length === 1 ? "" : "s"} selected.`;
    const msg = countsParts.length ? `${countsParts.join(". ")}. ${mis}` : mis;
    figma.notify(msg);
  } else if (didRename) {
    figma.notify(countsParts.join(". ") + ".");
  } else {
    figma.notify("✨ Everything is perfect!");
  }

  figma.closePlugin();
}

main();
