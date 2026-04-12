const config = {
  MicrosoftAppId: process.env.CLIENT_ID,
  MicrosoftAppType: process.env.BOT_TYPE,
  MicrosoftAppTenantId: process.env.TENANT_ID,
  MicrosoftAppPassword: process.env.CLIENT_PASSWORD,

  // Claude Code Bridge
  ClaudeCliPath: process.env.CLAUDE_CLI_PATH || "claude",
  ClaudeModel: process.env.CLAUDE_MODEL || "claude-opus-4-6-20250514",
  ClaudeWorkingDir: process.env.CLAUDE_WORKING_DIR || process.cwd(),
  ClaudeTimeoutMs: parseInt(process.env.CLAUDE_TIMEOUT_MS || "120000"),
  ClaudeMaxBudgetUsd: parseFloat(process.env.CLAUDE_MAX_BUDGET_USD || "1.0"),
  ClaudeBare: process.env.CLAUDE_BARE === "true",
  ClaudeSkipPermissions: process.env.CLAUDE_SKIP_PERMISSIONS !== "false",
  ClaudeSystemPrompt: process.env.CLAUDE_SYSTEM_PROMPT,
};

export default config;
