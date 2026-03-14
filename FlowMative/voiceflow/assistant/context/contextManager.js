let activeWinModulePromise;

async function getActiveWinModule() {
  if (!activeWinModulePromise) {
    activeWinModulePromise = import("active-win");
  }

  return activeWinModulePromise;
}

async function getActiveContext() {
  try {
    const { activeWindow } = await getActiveWinModule();
    const activeWindowResult = await activeWindow();

    if (!activeWindowResult) {
      return {
        appName: null,
        windowTitle: null,
        processPath: null
      };
    }

    return {
      appName: activeWindowResult.owner?.name || null,
      windowTitle: activeWindowResult.title || null,
      processPath: activeWindowResult.owner?.path || null
    };
  } catch (error) {
    return {
      appName: null,
      windowTitle: null,
      processPath: null
    };
  }
}

module.exports = {
  getActiveContext
};
