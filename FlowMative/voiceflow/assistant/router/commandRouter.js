const codeTool = require("../tools/codeTool");
const contextManager = require("../context/contextManager");
const { processEditingCommand } = require("../editing/editProcessor");
const emailTool = require("../tools/emailTool");
const summarizeTool = require("../tools/summarizeTool");
const macroManager = require("../macros/macroManager");
const memoryManager = require("../memory/memoryManager");
const { loadPlugins } = require("./pluginLoader");
const { executePrompt } = require("../tools/toolSupport");
const slackIntegration = require("../../integrations/slackIntegration");
const gmailIntegration = require("../../integrations/gmailIntegration");
const notionIntegration = require("../../integrations/notionIntegration");

const ROUTES = [
  {
    toolName: "codeTool",
    keywords: ["code", "function", "program"],
    tool: codeTool
  },
  {
    toolName: "summarizeTool",
    keywords: ["summarize", "summary"],
    tool: summarizeTool
  },
  {
    toolName: "emailTool",
    keywords: ["email", "draft email"],
    tool: emailTool
  }
];

const INTEGRATIONS = [
  {
    name: "slackIntegration",
    matcher: (context) => normalizeTranscript(`${context?.appName || ""} ${context?.windowTitle || ""}`).includes("slack"),
    integration: slackIntegration,
    action: "type"
  },
  {
    name: "gmailIntegration",
    matcher: (context) => normalizeTranscript(`${context?.appName || ""} ${context?.windowTitle || ""}`).includes("gmail"),
    integration: gmailIntegration,
    action: "type"
  },
  {
    name: "notionIntegration",
    matcher: (context) => normalizeTranscript(`${context?.appName || ""} ${context?.windowTitle || ""}`).includes("notion"),
    integration: notionIntegration,
    action: "type"
  }
];

const FALLBACK_TOOL_NAME = "llmFallback";
const EDITING_TOOL_NAME = "inlineTextEditor";
const FOLLOW_UP_TOOL_NAME = "followUpRewrite";
const CLEAR_MEMORY_TOOL_NAME = "clearMemory";
const MACRO_TOOL_NAME = "macroExpansion";
const FALLBACK_PROMPT = [
  "You are the FlowMative assistant fallback.",
  "Handle general spoken commands that do not match a specialized local tool.",
  "Be direct, useful, and concise."
].join("\n");
const FOLLOW_UP_PHRASES = [
  "shorter",
  "expand this",
  "expand this paragraph",
  "rewrite that",
  "rewrite this",
  "summarize that",
  "summarize this",
  "improve this",
  "make it shorter",
  "make this shorter",
  "make this clearer",
  "rewrite this more clearly",
  "rewrite this formally",
  "summarize this paragraph",
  "expand this section"
];
const INLINE_EDITING_PHRASES = [
  "rewrite this",
  "rewrite this more clearly",
  "rewrite this formally",
  "summarize this",
  "expand this",
  "expand this paragraph",
  "make this shorter",
  "make this clearer"
];
const FOLLOW_UP_PROMPT = [
  "You are the FlowMative follow-up editor.",
  "You receive a user instruction and previous text.",
  "Rewrite the previous text according to the user's new instruction.",
  "Preserve the important meaning unless the user asks to change it."
].join("\n");

function normalizeTranscript(transcript) {
  return typeof transcript === "string" ? transcript.trim().toLowerCase() : "";
}

function selectRoute(transcript) {
  const normalizedTranscript = normalizeTranscript(transcript);

  return ROUTES.find((route) => {
    return route.keywords.some((keyword) => normalizedTranscript.includes(keyword));
  }) || null;
}

function selectContextRoute(context) {
  const appName = normalizeTranscript(context?.appName);
  const windowTitle = normalizeTranscript(context?.windowTitle);
  const contextText = `${appName} ${windowTitle}`.trim();

  if (!contextText) {
    return null;
  }

  if (contextText.includes("code")) {
    return {
      toolName: "codeTool",
      tool: codeTool
    };
  }

  if (contextText.includes("slack")) {
    return {
      toolName: "emailTool",
      tool: emailTool
    };
  }

  return null;
}

function selectIntegration(context) {
  return INTEGRATIONS.find((entry) => entry.matcher(context)) || null;
}

function selectPlugin(transcript) {
  const normalizedTranscript = normalizeTranscript(transcript);

  return loadPlugins().find((plugin) => {
    return plugin.triggerWords.some((triggerWord) => normalizedTranscript.includes(triggerWord.toLowerCase()));
  }) || null;
}

function isFollowUpCommand(transcript) {
  const normalizedTranscript = normalizeTranscript(transcript);

  return FOLLOW_UP_PHRASES.some((phrase) => normalizedTranscript.includes(phrase));
}

function isInlineEditingCommand(transcript) {
  const normalizedTranscript = normalizeTranscript(transcript);

  return INLINE_EDITING_PHRASES.some((phrase) => normalizedTranscript.includes(phrase));
}

function shouldUseSelectedText(transcript, selectedText) {
  if (!selectedText || !selectedText.trim()) {
    return false;
  }

  const normalizedTranscript = normalizeTranscript(transcript);
  return /\b(this|selected|paragraph|section|formally|shorter|clearer|clearly|rewrite|summarize|expand)\b/.test(normalizedTranscript);
}

function isClearMemoryCommand(transcript) {
  return normalizeTranscript(transcript) === "clear memory";
}

function getMacroExpansion(transcript) {
  const macros = macroManager.getMacros();
  const normalizedTranscript = normalizeTranscript(transcript);

  const matchedEntry = Object.entries(macros).find(([phrase]) => normalizeTranscript(phrase) === normalizedTranscript);
  return matchedEntry ? matchedEntry[1] : null;
}

function describeToolAction(toolName) {
  switch (toolName) {
    case "codeTool":
      return "Generating code";
    case "inlineTextEditor":
      return "Editing selected text";
    case "summarizeTool":
      return "Summarizing content";
    case "emailTool":
      return "Drafting email";
    case "followUpRewrite":
      return "Rewriting previous output";
    case "macroExpansion":
      return "Expanding saved macro";
    case "clearMemory":
      return "Clearing assistant memory";
    case "slackIntegration":
      return "Preparing Slack response";
    case "gmailIntegration":
      return "Drafting Gmail response";
    case "notionIntegration":
      return "Preparing Notion content";
    case "llmFallback":
      return "Generating response";
    default:
      return `Running ${toolName}`;
  }
}

async function routeCommand(transcript, context, options = {}) {
  if (typeof transcript !== "string" || !transcript.trim()) {
    throw new Error("A non-empty command transcript is required.");
  }

  const activeContext = context || await contextManager.getActiveContext();
  const selectedText = typeof options.selectedText === "string" ? options.selectedText.trim() : "";
  const onToolSelected = typeof options.onToolSelected === "function" ? options.onToolSelected : null;
  const onAction = typeof options.onAction === "function" ? options.onAction : null;
  const contextLabel = [
    activeContext.appName || "Unknown app",
    activeContext.windowTitle || "Unknown window"
  ].join(" - ");
  console.log(`Active context: ${contextLabel}`);

  const reportExecutionProgress = async (toolName, actionText) => {
    if (onToolSelected) {
      await onToolSelected(toolName);
    }

    if (onAction) {
      await onAction(actionText || describeToolAction(toolName), toolName);
    }
  };

  if (isClearMemoryCommand(transcript)) {
    await reportExecutionProgress(CLEAR_MEMORY_TOOL_NAME, describeToolAction(CLEAR_MEMORY_TOOL_NAME));
    memoryManager.clearMemory();
    return {
      toolName: CLEAR_MEMORY_TOOL_NAME,
      response: "Memory cleared.",
      context: activeContext,
      action: "clipboard"
    };
  }

  const macroExpansion = getMacroExpansion(transcript);
  if (macroExpansion) {
    await reportExecutionProgress(MACRO_TOOL_NAME, describeToolAction(MACRO_TOOL_NAME));
    memoryManager.saveInteraction(transcript, MACRO_TOOL_NAME, macroExpansion);
    return {
      toolName: MACRO_TOOL_NAME,
      response: macroExpansion,
      context: activeContext,
      action: "type"
    };
  }

  if (isInlineEditingCommand(transcript)) {
    console.log("Editing command detected");

    if (!selectedText) {
      const response = "Please highlight the text you want me to edit and try again.";
      memoryManager.saveInteraction(transcript, EDITING_TOOL_NAME, response);
      return {
        toolName: EDITING_TOOL_NAME,
        response,
        context: activeContext,
        action: "clipboard"
      };
    }

    await reportExecutionProgress(EDITING_TOOL_NAME, describeToolAction(EDITING_TOOL_NAME));
    const response = await processEditingCommand(transcript, selectedText);
    console.log("Edited result generated");
    memoryManager.saveInteraction(transcript, EDITING_TOOL_NAME, response);
    return {
      toolName: EDITING_TOOL_NAME,
      response,
      context: activeContext,
      action: "type"
    };
  }

  if (isFollowUpCommand(transcript)) {
    const previousText = shouldUseSelectedText(transcript, selectedText)
      ? selectedText
      : memoryManager.getLastResult();

    if (!previousText) {
      const response = "I don't have previous text to edit yet. Please give me an initial command first.";
      memoryManager.saveInteraction(transcript, FOLLOW_UP_TOOL_NAME, response);
      return {
        toolName: FOLLOW_UP_TOOL_NAME,
        response,
        context: activeContext,
        action: "clipboard"
      };
    }

    await reportExecutionProgress(FOLLOW_UP_TOOL_NAME, describeToolAction(FOLLOW_UP_TOOL_NAME));
    const response = await executePrompt(
      [
        `User instruction: ${transcript.trim()}`,
        "",
        `Previous output: ${previousText}`,
        "",
        "Rewrite the previous output according to the instruction."
      ].join("\n"),
      {
        model: process.env.OPENAI_COMMAND_MODEL || "gpt-4o-mini",
        instructions: FOLLOW_UP_PROMPT,
        context: activeContext
      }
    );

    memoryManager.saveInteraction(transcript, FOLLOW_UP_TOOL_NAME, response);
    return {
      toolName: FOLLOW_UP_TOOL_NAME,
      response,
      context: activeContext,
      action: shouldUseSelectedText(transcript, selectedText) ? "type" : "clipboard"
    };
  }

  const plugin = selectPlugin(transcript);
  if (plugin) {
    console.log(`Router selected plugin: ${plugin.name}`);
    await reportExecutionProgress(plugin.name, describeToolAction(plugin.name));
    const pluginInput = shouldUseSelectedText(transcript, selectedText)
      ? `${transcript.trim()}\n\nSelected text:\n${selectedText}`
      : transcript;
    const response = await plugin.execute(pluginInput, activeContext);
    memoryManager.saveInteraction(transcript, plugin.name, response);
    return {
      toolName: plugin.name,
      response,
      context: activeContext,
      action: shouldUseSelectedText(transcript, selectedText) ? "type" : "clipboard"
    };
  }

  const integrationEntry = selectIntegration(activeContext);
  if (integrationEntry) {
    await reportExecutionProgress(integrationEntry.name, describeToolAction(integrationEntry.name));
    await integrationEntry.integration.connect();
    const response = await integrationEntry.integration.execute(transcript, activeContext);
    memoryManager.saveInteraction(transcript, integrationEntry.name, response);
    return {
      toolName: integrationEntry.name,
      response,
      context: activeContext,
      action: integrationEntry.action
    };
  }

  const selectedRoute = selectRoute(transcript) || selectContextRoute(activeContext);
  if (selectedRoute) {
    await reportExecutionProgress(selectedRoute.toolName, describeToolAction(selectedRoute.toolName));
    const toolInput = shouldUseSelectedText(transcript, selectedText)
      ? `${transcript.trim()}\n\nSelected text:\n${selectedText}`
      : transcript;
    const response = await selectedRoute.tool.execute(toolInput, activeContext);
    memoryManager.saveInteraction(transcript, selectedRoute.toolName, response);
    return {
      toolName: selectedRoute.toolName,
      response,
      context: activeContext,
      action: shouldUseSelectedText(transcript, selectedText) ? "type" : "clipboard"
    };
  }

  const fallbackInput = shouldUseSelectedText(transcript, selectedText)
    ? `${transcript.trim()}\n\nSelected text:\n${selectedText}`
    : transcript;
  await reportExecutionProgress(FALLBACK_TOOL_NAME, describeToolAction(FALLBACK_TOOL_NAME));
  const response = await executePrompt(fallbackInput, {
    model: process.env.OPENAI_COMMAND_MODEL || "gpt-4o-mini",
    instructions: FALLBACK_PROMPT,
    context: activeContext
  });
  memoryManager.saveInteraction(transcript, FALLBACK_TOOL_NAME, response);

  return {
    toolName: FALLBACK_TOOL_NAME,
    response,
    context: activeContext,
    action: shouldUseSelectedText(transcript, selectedText) ? "type" : "clipboard"
  };
}

module.exports = {
  routeCommand,
  isFollowUpCommand,
  shouldUseSelectedText
};
