// Headless, single-run rename & audit
figma.skipInvisibleInstanceChildren = true;

let HAS_RUN = false; // run-once guard

const DEFAULT_FRAME_NAME_RE = /^Frame( \d+)?$/;
const RELAUNCH_COMMAND = "run-rename-kit";

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
// Also Build Reverse Map: ColorName → Category (for fallback renaming)
const styleCategories = {};
const colorToCategory = new Map();

for (const cat in categories) {
  const newName = categories[cat];
  const color =
    cat === "highlighted"
      ? [colorPaths.brand + cat, colorPaths.inverse + cat]
      : [colorPaths.regular + cat, colorPaths.inverse + cat];
  
  styleCategories[cat] = { newName, color };
  
  // Populate reverse map
  color.forEach(c => colorToCategory.set(c, cat));
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

function setRelaunchForNodes(nodes) {
  const seen = new Set();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node || typeof node.setRelaunchData !== "function") continue;
    if (node.id && seen.has(node.id)) continue;
    if (node.id) seen.add(node.id);
    try {
      node.setRelaunchData({ [RELAUNCH_COMMAND]: "" });
    } catch (e) {}
  }
}

/* ---------------- main ---------------- */

async function main() {
  if (HAS_RUN) return;
  HAS_RUN = true;

  const selection = figma.currentPage.selection;
  if (figma.currentPage && typeof figma.currentPage.setRelaunchData === "function") {
    try {
      figma.currentPage.setRelaunchData({
        [RELAUNCH_COMMAND]: "",
      });
    } catch (e) {}
  }

  if (!selection || selection.length === 0) {
    figma.notify("Select at least one frame or text layer.");
    figma.closePlugin();
    return;
  }

  setRelaunchForNodes(selection);

  // 1) Rename default frames → "item"
  let framesRenamed = 0;
  for (let i = 0; i < selection.length; i++) {
    framesRenamed += renameDefaultFramesIn(selection[i]);
  }

  // 2) Collect text nodes
  const textNodes = collectTextNodes(selection);

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

  // 3) Preload ALL Styles and Variables upfront (for smart detection)
  const styleIds = [];
  const variableIds = [];

  for (let i = 0; i < textNodes.length; i++) {
    const t = textNodes[i];
    if (typeof t.textStyleId === "string" && t.textStyleId) styleIds.push(t.textStyleId);
    if (typeof t.fillStyleId === "string" && t.fillStyleId) styleIds.push(t.fillStyleId);
    
    const varId = firstBoundFillVarId(t);
    if (varId) variableIds.push(varId);
  }

  const styleCache = await preloadStyles(styleIds);
  const varCache = await preloadVariables(variableIds);

  // 4) Rename & Audit
  let textRenamed = 0;
  let mismatched = [];

  for (let i = 0; i < textNodes.length; i++) {
    const tn = textNodes[i];
    let category = null;
    let method = null; // 'text-style' or 'color-fallback'

    // Strategy A: Try Text Style Name
    const ts =
      typeof tn.textStyleId === "string" && tn.textStyleId
        ? styleCache.get(tn.textStyleId)
        : null;

    if (ts && ts.type === "TEXT" && typeof ts.name === "string") {
      const prefix = ts.name.split("/")[0];
      if (styleCategories[prefix]) {
        category = prefix;
        method = 'text-style';
      }
    }

    // Strategy B: Fallback - Try Color (Variable or Style) if Text Style is missing/invalid
    if (!category) {
        // Check Variable
        const varId = firstBoundFillVarId(tn);
        if (varId) {
            const v = varCache.get(varId);
            if (v && v.name && colorToCategory.has(v.name)) {
                category = colorToCategory.get(v.name);
                method = 'color-fallback';
            }
        }
        // Check Fill Style
        else if (typeof tn.fillStyleId === "string" && tn.fillStyleId) {
            const fs = styleCache.get(tn.fillStyleId);
            if (fs && fs.name && colorToCategory.has(fs.name)) {
                category = colorToCategory.get(fs.name);
                method = 'color-fallback';
            }
        }
    }

    // If we still found no category, we simply skip (DON'T FLAG AS MISMATCH)
    if (!category) continue;

    const mapping = styleCategories[category];

    // Rename Logic
    if (tn.name !== mapping.newName) {
      try { tn.name = mapping.newName; textRenamed++; } catch (e) {}
    }

    // Color Audit Logic
    // Only audit if we matched via Text Style. 
    // If we matched via Color (Fallback), the color is by definition correct.
    if (method === 'text-style') {
        const expected = mapping.color;
        let ok = false;
        
        const id0 = firstBoundFillVarId(tn);
        if (id0) {
            const variable = varCache.get(id0);
            const vName = variable && variable.name ? variable.name : null;
            if (vName && (expected.indexOf(vName) !== -1 || stateColors.has(vName))) ok = true;
        } else if (typeof tn.fillStyleId === "string" && tn.fillStyleId) {
            const fillStyle = styleCache.get(tn.fillStyleId);
            const fsName = fillStyle && fillStyle.name ? fillStyle.name : null;
            if (fsName && (expected.indexOf(fsName) !== -1 || stateColors.has(fsName))) ok = true;
        }

        if (!ok) mismatched.push(tn);
    }
  }

  // 5) Final Notify
  const didRename = textRenamed > 0 || framesRenamed > 0;
  const hasMismatches = mismatched.length > 0;
  const countsParts = makeCountsParts(textRenamed, framesRenamed);

  if (hasMismatches) {
    setRelaunchForNodes(mismatched);
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
