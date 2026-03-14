const fs = require("fs");
const path = require("path");

const MACROS_PATH = path.join(__dirname, "macros.json");

function ensureMacrosFile() {
  if (!fs.existsSync(MACROS_PATH)) {
    fs.writeFileSync(MACROS_PATH, JSON.stringify({}, null, 2), "utf-8");
  }
}

function getMacros() {
  ensureMacrosFile();

  try {
    const fileContent = fs.readFileSync(MACROS_PATH, "utf-8");
    const parsed = JSON.parse(fileContent);
    return Object.fromEntries(
      Object.entries(parsed).filter(([key, value]) => {
        return typeof key === "string" && key.trim() && typeof value === "string" && value.trim();
      })
    );
  } catch (error) {
    fs.writeFileSync(MACROS_PATH, JSON.stringify({}, null, 2), "utf-8");
    return {};
  }
}

function saveMacros(macros) {
  ensureMacrosFile();
  fs.writeFileSync(MACROS_PATH, JSON.stringify(macros, null, 2), "utf-8");
  return getMacros();
}

function addMacro(phrase, expansion) {
  const normalizedPhrase = typeof phrase === "string" ? phrase.trim() : "";
  const normalizedExpansion = typeof expansion === "string" ? expansion.trim() : "";

  if (!normalizedPhrase || !normalizedExpansion) {
    throw new Error("Macro phrase and expansion are required.");
  }

  const macros = getMacros();
  macros[normalizedPhrase] = normalizedExpansion;
  return saveMacros(macros);
}

function deleteMacro(phrase) {
  const macros = getMacros();
  delete macros[phrase];
  return saveMacros(macros);
}

module.exports = {
  MACROS_PATH,
  getMacros,
  saveMacros,
  addMacro,
  deleteMacro
};
