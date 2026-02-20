# 🚀 Rename Kit for Figma

Rename Kit is a Figma plugin designed to clean up your design files, enforce consistency, and streamline your workflow. It automates tedious organization tasks, allowing you to focus more on designing and less on manual layer management.

---

## ✨ Features

Rename Kit offers three core features to keep your design files tidy and consistent:

1. **Text Layer Renaming**
   - Automatically renames your text layers to match a predefined naming convention based on their applied Text Style.
   - _Example_: A text layer using the `heading/h1` style will be renamed to `heading-text`.

2. **Default Frame Renaming**
   - Scans your selection and renames any frames with default names (e.g., `Frame 1`, `Frame 27`) to a consistent name, `item`.
   - This helps create a clean and predictable structure for lists and components.

3. **Mismatched Color Detection**
   - Intelligently identifies and selects any text layers that are using a Color Style or Variable that doesn't align with the rules defined for its Text Style.
   - Makes it incredibly easy to spot and fix design inconsistencies.

4. **Relaunch Button Support**
   - After a run, tagged nodes expose a relaunch button so you can rerun Rename Kit directly from the properties panel.

---

## 🛠️ How to Use

1. **Select Layers**
   - In your Figma file, select one or more frames, groups, or layers you want to clean up.
2. **Run the Plugin**
   - Go to `Plugins > Rename Kit`.
   - After the first run, select a tagged layer and use the relaunch button `Run Rename Kit` in the right-side properties panel.
   - Or use Figma's Quick Actions (`⌘ + /` or `Ctrl + /`) and type "Rename Kit".
3. **Review the Results**
   - A notification will appear summarizing the changes (e.g., number of frames and text layers renamed).
   - If any text layers with mismatched colors are found, they will be automatically selected on the canvas, allowing you to fix them immediately.

---

## ⚙️ Configuration (For Advanced Users)

Rename Kit is built to be customizable. You can easily modify the naming conventions and color rules by editing the plugin's source code. This is perfect for teams that want to enforce their specific design system standards.

### Text Style Naming Convention
The mapping between Text Style categories and the new layer names is defined in the `categories` object within the `code.ts` file:

```js
const categories = {
  "heading": "heading-text",
  "title": "title-text",
  "subtitle": "subtitle-text",
  "body": "body-text",
  // ...add or edit your own categories here
};
```

The plugin reads the first part of a style's name (e.g., `heading` from `heading/h1`) and uses it as the key to find the new name.

### Color Validation Rules
The plugin validates text layer colors based on the `styleCategories` mapping. The `colorPaths` and `stateColors` objects define which color styles are considered valid for each text style.

- **colorPaths**: Defines the base paths for your color styles in the Figma library.
- **stateColors**: A set of globally valid color styles (like error or success states) that are always considered correct, regardless of the text style applied.

You can modify these to match your team's design system structure:

```js
const colorPaths = {
  regular: "colors/content/text/regular/",
  inverse: "colors/content/text/inverse/",
  brand: "colors/content/text/brand/"
};

const stateColors = new Set([
  "colors/state/info",
  "colors/state/success",
  "colors/state/warning",
  "colors/state/error",
  "colors/content/text/regular/disabled"
]);
```

---

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
