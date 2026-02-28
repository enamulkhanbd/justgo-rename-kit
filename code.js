// Headless, single-run rename and audit
figma.skipInvisibleInstanceChildren = true;

let HAS_RUN = false;

const DEFAULT_FRAME_NAME_RE = /^Frame( \d+)?$/;
const RELAUNCH_COMMAND = "run-rename-kit";
const SETTINGS_COMMAND = "open-settings";
const SETTINGS_STORAGE_KEY = "rename-kit-settings-v1";
const DEFAULT_FRAME_LAYER_NAME = "item";
const VALID_RULE_PATH_TYPES = ["regular", "inverse", "brand"];

const DEFAULT_RENAME_RULES = [
  { newName: "heading-text", path: "colors/content/text/regular/heading" },
  { newName: "heading-text", path: "colors/content/text/inverse/heading" },
  { newName: "title-text", path: "colors/content/text/regular/title" },
  { newName: "title-text", path: "colors/content/text/inverse/title" },
  { newName: "subtitle-text", path: "colors/content/text/regular/subtitle" },
  { newName: "subtitle-text", path: "colors/content/text/inverse/subtitle" },
  { newName: "body-text", path: "colors/content/text/regular/body" },
  { newName: "body-text", path: "colors/content/text/inverse/body" },
  { newName: "highlighted-text", path: "colors/content/text/brand/highlighted" },
  { newName: "highlighted-text", path: "colors/content/text/inverse/highlighted" },
  { newName: "info-text", path: "colors/content/text/regular/info" },
  { newName: "info-text", path: "colors/content/text/inverse/info" },
  { newName: "caption-text", path: "colors/content/text/regular/caption" },
  { newName: "caption-text", path: "colors/content/text/inverse/caption" },
  { newName: "overline-text", path: "colors/content/text/regular/overline" },
  { newName: "overline-text", path: "colors/content/text/inverse/overline" },
];

const DEFAULT_SETTINGS = Object.freeze({
  frameLayerName: DEFAULT_FRAME_LAYER_NAME,
  colorPaths: {
    regular: "colors/content/text/regular/",
    inverse: "colors/content/text/inverse/",
    brand: "colors/content/text/brand/",
  },
  renameRules: DEFAULT_RENAME_RULES,
  alwaysAllowedColors: [
    { name: "info", color: "colors/content/text/state/info" },
    { name: "success", color: "colors/content/text/state/success" },
    { name: "warning", color: "colors/content/text/state/warning" },
    { name: "error", color: "colors/content/text/state/error" },
    { name: "disabled", color: "colors/content/text/regular/disabled" },
  ],
});

function sanitizePath(value, fallback) {
  const next = typeof value === "string" ? value.trim() : "";
  const resolved = next || fallback;
  return resolved.endsWith("/") ? resolved : resolved + "/";
}

function sanitizeLayerName(value, fallback) {
  const next = typeof value === "string" ? value.trim() : "";
  return next || fallback;
}

function normalizeTokenPath(value) {
  const token = typeof value === "string" ? value.trim() : "";
  if (!token) return "";
  let end = token.length;
  while (end > 0 && token.charAt(end - 1) === "/") {
    end--;
  }
  return token.slice(0, end);
}

function normalizeAlwaysAllowedColorRow(row) {
  if (typeof row === "string") {
    const colorValue = row.trim();
    if (!colorValue) return null;
    return { name: colorValue, color: colorValue };
  }

  const next = row && typeof row === "object" ? row : {};
  const nameRaw = typeof next.name === "string" ? next.name.trim() : "";
  const colorRaw =
    typeof next.color === "string"
      ? next.color.trim()
      : typeof next.value === "string"
        ? next.value.trim()
        : typeof next.path === "string"
          ? next.path.trim()
          : "";
  if (!colorRaw) return null;

  return {
    name: nameRaw || colorRaw,
    color: colorRaw,
  };
}

function normalizeAlwaysAllowedColors(values) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(values) ? values : [];

  for (let i = 0; i < list.length; i++) {
    const normalized = normalizeAlwaysAllowedColorRow(list[i]);
    if (!normalized) continue;

    const key = normalized.color.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }

  return out;
}

function normalizeRenameRuleRow(row) {
  const next = row && typeof row === "object" ? row : {};
  const newName =
    typeof next.newName === "string"
      ? next.newName.trim()
      : typeof next.layerName === "string"
        ? next.layerName.trim()
        : "";
  let path = normalizeTokenPath(
    typeof next.path === "string"
      ? next.path
      : typeof next.color === "string"
        ? next.color
        : typeof next.value === "string"
          ? next.value
          : ""
  );

  // Backward compatibility: convert legacy { category, pathType } rules to full path.
  if (!path) {
    const category = typeof next.category === "string" ? next.category.trim() : "";
    const pathTypeRaw = typeof next.pathType === "string" ? next.pathType.trim() : "";
    const pathType =
      VALID_RULE_PATH_TYPES.indexOf(pathTypeRaw) !== -1 ? pathTypeRaw : "regular";
    if (category) {
      const basePath =
        pathType === "brand"
          ? DEFAULT_SETTINGS.colorPaths.brand
          : pathType === "inverse"
            ? DEFAULT_SETTINGS.colorPaths.inverse
            : DEFAULT_SETTINGS.colorPaths.regular;
      path = normalizeTokenPath(basePath + category);
    }
  }

  if (!newName || !path) return null;
  return { newName, path };
}

function normalizeRenameRules(values) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(values) ? values : [];

  for (let i = 0; i < list.length; i++) {
    const normalized = normalizeRenameRuleRow(list[i]);
    if (!normalized) continue;

    const key = normalized.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }

  return out;
}

function normalizeSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const sourcePaths =
    source.colorPaths && typeof source.colorPaths === "object"
      ? source.colorPaths
      : {};
  const hasAlwaysAllowedColors = Object.prototype.hasOwnProperty.call(
    source,
    "alwaysAllowedColors"
  );
  const sourceAlwaysAllowedColors = hasAlwaysAllowedColors
    ? Array.isArray(source.alwaysAllowedColors)
      ? source.alwaysAllowedColors
      : []
    : DEFAULT_SETTINGS.alwaysAllowedColors;
  const sourceRenameRules = Array.isArray(source.renameRules)
    ? source.renameRules
    : DEFAULT_SETTINGS.renameRules;

  return {
    frameLayerName: sanitizeLayerName(source.frameLayerName, DEFAULT_SETTINGS.frameLayerName),
    colorPaths: {
      regular: sanitizePath(sourcePaths.regular, DEFAULT_SETTINGS.colorPaths.regular),
      inverse: sanitizePath(sourcePaths.inverse, DEFAULT_SETTINGS.colorPaths.inverse),
      brand: sanitizePath(sourcePaths.brand, DEFAULT_SETTINGS.colorPaths.brand),
    },
    renameRules: normalizeRenameRules(sourceRenameRules),
    alwaysAllowedColors: normalizeAlwaysAllowedColors(sourceAlwaysAllowedColors),
  };
}

async function getSettings() {
  try {
    const stored = await figma.clientStorage.getAsync(SETTINGS_STORAGE_KEY);
    const normalized = normalizeSettings(stored);
    if (!stored || typeof stored !== "object") {
      await figma.clientStorage.setAsync(SETTINGS_STORAGE_KEY, normalized);
    }
    return normalized;
  } catch (e) {
    return normalizeSettings(null);
  }
}

async function saveSettings(nextSettings) {
  const normalized = normalizeSettings(nextSettings);
  await figma.clientStorage.setAsync(SETTINGS_STORAGE_KEY, normalized);
  return normalized;
}

function areSettingsEqual(left, right) {
  return JSON.stringify(normalizeSettings(left)) === JSON.stringify(normalizeSettings(right));
}

function getCategoryFromPath(path) {
  const value = normalizeTokenPath(path);
  if (!value) return "";
  const parts = value.split("/");
  for (let i = parts.length - 1; i >= 0; i--) {
    const segment = parts[i].trim();
    if (segment) return segment;
  }
  return "";
}

function buildStyleMappings(renameRules) {
  const styleCategories = {};
  const colorToCategory = new Map();
  const rules = Array.isArray(renameRules) ? renameRules : [];

  for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
    const rule = rules[ruleIndex];
    const path = normalizeTokenPath(rule.path);
    const cat = getCategoryFromPath(path);
    const newName = typeof rule.newName === "string" ? rule.newName.trim() : "";
    if (!cat || !path || !newName) continue;

    if (!styleCategories[cat]) {
      styleCategories[cat] = { newName, color: [] };
    } else {
      styleCategories[cat].newName = newName;
    }

    if (styleCategories[cat].color.indexOf(path) === -1) {
      styleCategories[cat].color.push(path);
    }
    colorToCategory.set(path, cat);
  }

  return { styleCategories, colorToCategory };
}

/* ---------------- helpers ---------------- */

function isVisible(node) {
  return typeof node.visible === "boolean" ? node.visible : true;
}

// Rename "Frame"/"Frame N" to configured value under a root; return count
function renameDefaultFramesIn(root, targetName) {
  let count = 0;
  const nextName = sanitizeLayerName(targetName, DEFAULT_FRAME_LAYER_NAME);

  if (root.type === "FRAME" && DEFAULT_FRAME_NAME_RE.test(root.name)) {
    if (root.name !== nextName) {
      try {
        root.name = nextName;
        count++;
      } catch (e) {}
    }
  }
  if ("findAll" in root) {
    const frames = root.findAll(
      (n) => n.type === "FRAME" && isVisible(n) && DEFAULT_FRAME_NAME_RE.test(n.name)
    );
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].name !== nextName) {
        try {
          frames[i].name = nextName;
          count++;
        } catch (e) {}
      }
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
      if (found && found.length) {
        for (let j = 0; j < found.length; j++) {
          texts.push(found[j]);
        }
      }
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
  } else if (
    typeof bv === "object" &&
    bv !== null &&
    Object.prototype.hasOwnProperty.call(bv, "0")
  ) {
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
        .catch(() => cache.set(id, null))
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
        .catch(() => cache.set(id, null))
    )
  );
  return cache;
}

function makeCountsParts(textRenamed, framesRenamed) {
  const parts = [];
  if (textRenamed > 0) {
    parts.push(`${textRenamed} text layer${textRenamed === 1 ? "" : "s"} renamed`);
  }
  if (framesRenamed > 0) {
    parts.push(`${framesRenamed} frame${framesRenamed === 1 ? "" : "s"} renamed`);
  }
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

/* ---------------- actions ---------------- */

async function openSettingsUI() {
  figma.showUI(__html__, { width: 520, height: 520 });

  async function postStoredSettings() {
    const settings = await getSettings();
    figma.ui.postMessage({ type: "init-settings", payload: settings });
  }

  figma.ui.onmessage = async (msg) => {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "settings-ui-ready") {
      try {
        await postStoredSettings();
      } catch (e) {}
      return;
    }

    if (msg.type === "cancel-settings") {
      figma.closePlugin();
      return;
    }

    if (msg.type === "save-settings") {
      try {
        const currentSettings = await getSettings();
        if (areSettingsEqual(currentSettings, msg.payload)) {
          figma.notify("No changes made.");
          return;
        }
        await saveSettings(msg.payload);
        figma.notify("Settings saved.");
      } catch (e) {
        figma.notify("Could not save settings.");
      }
      figma.closePlugin();
    }
  };

  try {
    await postStoredSettings();
  } catch (e) {}
}

async function runRenameKit() {
  if (HAS_RUN) return;
  HAS_RUN = true;

  const settings = await getSettings();
  const { styleCategories, colorToCategory } = buildStyleMappings(settings.renameRules);
  const stateColors = new Set();
  for (let i = 0; i < settings.alwaysAllowedColors.length; i++) {
    const row = settings.alwaysAllowedColors[i];
    if (typeof row === "string") {
      const stringColor = row.trim();
      if (stringColor) stateColors.add(stringColor);
      continue;
    }
    if (row && typeof row === "object" && typeof row.color === "string") {
      const objectColor = row.color.trim();
      if (objectColor) stateColors.add(objectColor);
    }
  }

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

  // 1) Rename default frames to configured frameLayerName
  let framesRenamed = 0;
  for (let i = 0; i < selection.length; i++) {
    framesRenamed += renameDefaultFramesIn(selection[i], settings.frameLayerName);
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

  // 3) Preload all styles and variables
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

  // 4) Rename and audit
  let textRenamed = 0;
  const mismatched = [];

  for (let i = 0; i < textNodes.length; i++) {
    const tn = textNodes[i];
    let category = null;
    let method = null; // "text-style" or "color-fallback"

    // Strategy A: text style prefix match
    const ts =
      typeof tn.textStyleId === "string" && tn.textStyleId
        ? styleCache.get(tn.textStyleId)
        : null;

    if (ts && ts.type === "TEXT" && typeof ts.name === "string") {
      const prefix = ts.name.split("/")[0];
      if (styleCategories[prefix]) {
        category = prefix;
        method = "text-style";
      }
    }

    // Strategy B: fallback from color variable/style name
    if (!category) {
      const varId = firstBoundFillVarId(tn);
      if (varId) {
        const v = varCache.get(varId);
        if (v && v.name && colorToCategory.has(v.name)) {
          category = colorToCategory.get(v.name);
          method = "color-fallback";
        }
      } else if (typeof tn.fillStyleId === "string" && tn.fillStyleId) {
        const fs = styleCache.get(tn.fillStyleId);
        if (fs && fs.name && colorToCategory.has(fs.name)) {
          category = colorToCategory.get(fs.name);
          method = "color-fallback";
        }
      }
    }

    // If category is unknown, skip and do not flag mismatch.
    if (!category) continue;

    const mapping = styleCategories[category];

    if (tn.name !== mapping.newName) {
      try {
        tn.name = mapping.newName;
        textRenamed++;
      } catch (e) {}
    }

    // Only audit text-style matches.
    if (method === "text-style") {
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

  // 5) Final notify
  const didRename = textRenamed > 0 || framesRenamed > 0;
  const hasMismatches = mismatched.length > 0;
  const countsParts = makeCountsParts(textRenamed, framesRenamed);

  if (hasMismatches) {
    setRelaunchForNodes(mismatched);
    try {
      figma.currentPage.selection = mismatched;
    } catch (e) {}
    const mis = `${mismatched.length} mismatched layer${
      mismatched.length === 1 ? "" : "s"
    } selected.`;
    const msg = countsParts.length ? `${countsParts.join(". ")}. ${mis}` : mis;
    figma.notify(msg);
  } else if (didRename) {
    figma.notify(countsParts.join(". ") + ".");
  } else {
    figma.notify("✨ Everything is perfect!");
  }

  figma.closePlugin();
}

if (figma.command === SETTINGS_COMMAND) {
  openSettingsUI();
} else {
  runRenameKit();
}
