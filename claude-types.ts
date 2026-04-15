export interface ClaudeResult {
  type: "result";
  subtype: "success" | "error";
  is_error: boolean;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  result: string;
  stop_reason: string;
  session_id: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
}

export interface ClaudeBridgeConfig {
  cliPath: string;
  model: string;
  workingDirectory: string;
  timeoutMs: number;
  maxBudgetUsd: number;
  bare: boolean;
  systemPrompt?: string;
  allowedTools?: string[];
  permissionMode: string;
}

export interface ConversationSession {
  conversationId: string;
  claudeSessionId: string | null;
  totalCostUsd: number;
  messageCount: number;
  busy: boolean;
  queue: QueuedMessage[];
  lastActivity: number;
}

export interface QueuedMessage {
  text: string;
  resolve: (result: string) => void;
  reject: (error: Error) => void;
}
