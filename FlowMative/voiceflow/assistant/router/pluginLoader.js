const fs = require("fs");
const path = require("path");

const PLUGINS_DIR = path.join(__dirname, "..", "..", "plugins");

let pluginsCache = null;

function loadPlugins() {
  if (pluginsCache) {
    return pluginsCache;
  }

  if (!fs.existsSync(PLUGINS_DIR)) {
    pluginsCache = [];
    return pluginsCache;
  }

  pluginsCache = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const pluginDir = path.join(PLUGINS_DIR, entry.name);
      const pluginConfigPath = path.join(pluginDir, "plugin.json");
      const pluginModulePath = path.join(pluginDir, "index.js");

      if (!fs.existsSync(pluginConfigPath) || !fs.existsSync(pluginModulePath)) {
        return null;
      }

      try {
        const pluginConfig = JSON.parse(fs.readFileSync(pluginConfigPath, "utf-8"));
        const pluginModule = require(pluginModulePath);

        if (typeof pluginModule.execute !== "function") {
          return null;
        }

        return {
          name: pluginConfig.name || entry.name,
          description: pluginConfig.description || "",
          triggerWords: Array.isArray(pluginConfig.triggerWords) ? pluginConfig.triggerWords : [],
          execute: pluginModule.execute
        };
      } catch (error) {
        console.error(`Failed to load plugin ${entry.name}: ${error.message}`);
        return null;
      }
    })
    .filter(Boolean);

  return pluginsCache;
}

module.exports = {
  loadPlugins
};
