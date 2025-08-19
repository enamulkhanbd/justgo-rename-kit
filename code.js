/**
 * Rename & Color Audit — Fixed counters
 * -------------------------------------
 * - Always reports how many text layers were renamed
 * - Also reports how many default frames were renamed
 * - Keeps your existing color audit + selection behavior
 */

figma.showUI(__html__, { visible: false });
figma.skipInvisibleInstanceChildren = true;

/* ---------- Config ---------- */

const DEFAULT_FRAME_NAME_RE = /^Frame( \d+)?$/;

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

const colorPaths = {
  regular: "colors/content/text/regular/",
  inverse: "colors/content/text/inverse/",
  brand: "colors/content/text/brand/",
};

// Allowed globally (never a mismatch)
const stateColors = new Set([
  "colors/state/info",
  "colors/state/success",
  "colors/state/warning",
  "colors/state/error",
  "colors/content/text/regular/disabled",
]);

// category → { newName, color[] }
const styleCategories = {};
for (const cat in categories) {
  const newName = categories[cat];
  const color =
    cat === "highlighted"
      ? [colorPaths.brand + cat, colorPaths.inverse + cat]
      : [colorPaths.regular + cat, colorPaths.inverse + cat];
  styleCategories[cat] = { newName, color };
}

/* ---------- Tiny helpers ---------- */

function isVisible(node) {
  return typeof node.visible === "boolean" ? node.visible : true;
}

// Rename frames like "Frame 1" → "item" and return how many were renamed
function renameDefaultFramesIn(root) {
  let count = 0;
  if (root.type === "FRAME" && DEFAULT_FRAME_NAME_RE.test(root.name)) {
    try {
      root.name = "item";
      count++;
    } catch (e) {}
  }
  if ("findAll" in root) {
    const frames = root.findAll(
      (n) => n.type === "FRAME" && isVisible(n) && DEFAULT_FRAME_NAME_RE.test(n.name)
    );
    for (let i = 0; i < frames.length; i++) {
      try {
        frames[i].name = "item";
        count++;
      } catch (e) {}
    }
  }
  return count;
}

// Fast text collection
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

// First bound variable id per your rule: fills[0]
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

// Batch-load styles once
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
        .catch(() => cache.set(id, null))
    )
  );
  return cache;
}

// Batch-load variables once
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
        .catch(() => cache.set(id, null))
    )
  );
  return cache;
}

/* ---------- Main ---------- */

async function main() {
  const selection = figma.currentPage.selection;
  if (!selection || selection.length === 0) {
    figma.notify("Select at least one frame or text layer.");
    figma.closePlugin();
    return;
  }

  // 1) Quick frame rename & text collection
  let framesRenamed = 0;
  for (let i = 0; i < selection.length; i++) {
    framesRenamed += renameDefaultFramesIn(selection[i]);
  }
  const textNodes = collectTextNodes(selection);
  if (textNodes.length === 0) {
    const msg =
      framesRenamed > 0
        ? `${framesRenamed} frame${framesRenamed === 1 ? "" : "s"} renamed.`
        : "No text layers found.";
    figma.notify(msg);
    figma.closePlugin();
    return;
  }

  // 2) Preload all referenced styles
  const textStyleIds = [];
  const fillStyleIds = [];
  for (let i = 0; i < textNodes.length; i++) {
    const t = textNodes[i];
    if (typeof t.textStyleId === "string" && t.textStyleId) textStyleIds.push(t.textStyleId);
    if (typeof t.fillStyleId === "string" && t.fillStyleId) fillStyleIds.push(t.fillStyleId);
  }
  const styleCache = await preloadStyles([].concat(textStyleIds, fillStyleIds));

  // 3) Rename text by category + stage for color audit
  let renamed = 0;
  const staged = []; // { node, mapping }
  for (let i = 0; i < textNodes.length; i++) {
    const tn = textNodes[i];
    const ts =
      typeof tn.textStyleId === "string" && tn.textStyleId
        ? styleCache.get(tn.textStyleId)
        : null;
    if (!ts || ts.type !== "TEXT" || typeof ts.name !== "string") continue;

    const category = ts.name.split("/")[0]; // original rule
    const mapping = styleCategories[category];
    if (!mapping) continue;

    if (tn.name !== mapping.newName) {
      try {
        tn.name = mapping.newName;
        renamed++;
      } catch (e) {}
    }
    staged.push({ node: tn, mapping });
  }

  // If nothing matched your categories, still report frame/text renames (if any)
  if (staged.length === 0) {
    const parts = [];
    if (renamed > 0)
      parts.push(`${renamed} text layer${renamed === 1 ? "" : "s"} renamed`);
    if (framesRenamed > 0)
      parts.push(`${framesRenamed} frame${framesRenamed === 1 ? "" : "s"} renamed`);
    figma.notify(parts.length ? parts.join(". ") + "." : "✨ Everything is perfect!");
    figma.closePlugin();
    return;
  }

  // 4) Preload ONLY first-bound variable ids (your rule)
  const firstVarIds = [];
  for (let i = 0; i = staged.length; i++) {
    const id0 = firstBoundFillVarId(staged[i].node);
    if (id0) firstVarIds.push(id0);
  }
  const varCache = await preloadVariables(firstVarIds);

  // 5) Color audit (first var name → fallback to fill style name)
  const mismatched = [];
  for (let i = 0; i < staged.length; i++) {
    const node = staged[i].node;
    const expected = staged[i].mapping.color; // array
    let ok = false;

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

  // 6) Select & notify (ALWAYS include rename counts)
  const parts = [];
  if (renamed > 0)
    parts.push(`${renamed} text layer${renamed === 1 ? "" : "s"} renamed`);
  if (framesRenamed > 0)
    parts.push(`${framesRenamed} frame${framesRenamed === 1 ? "" : "s"} renamed`);

  if (mismatched.length) {
    try {
      figma.currentPage.selection = mismatched;
    } catch (e) {}
    const mis = `${mismatched.length} mismatched layer${
      mismatched.length === 1 ? "" : "s"
    } selected.`;
    figma.notify(parts.length ? `${parts.join(". ")}. ${mis}` : mis);
  } else {
    figma.notify(parts.length ? `${parts.join(". ")}. ✨ Everything is perfect!` : "✨ Everything is perfect!");
  }

  figma.closePlugin();
}

/* ---------- Start ---------- */

figma.ui.onmessage = function (msg) {
  if (msg && msg.type === "rename-and-check") main();
};

main();
