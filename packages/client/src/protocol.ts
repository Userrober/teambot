// WebSocket protocol shared between bot and client.
// Every request from bot carries an `id`; client echoes it back in the response
// so the bot can correlate replies with the originating Teams context.

export type BotToClient =
  | { type: "user_message"; id: string; text: string }
  | { type: "list_sessions"; id: string }
  | { type: "bind_session"; id: string; sessionId: string }
  | { type: "reset"; id: string }
  | { type: "set_model"; id: string; model: string }
  | { type: "get_model"; id: string }
  | { type: "status"; id: string }
  | { type: "compact"; id: string }
  | { type: "ping"; id: string };

export type ClientToBot =
  | { type: "hello"; token: string; clientVersion: string }
  | { type: "reply"; id: string; text: string }
  | { type: "error"; id: string; message: string }
  | { type: "session_list"; id: string; items: Array<{ id: string; date: string; messageCount: number; preview: string }> }
  | { type: "ok"; id: string; data?: unknown }
  | { type: "model_info"; id: string; current: string }
  | { type: "status_info"; id: string; data: { active: boolean; sessionId?: string | null; messageCount?: number; totalCostUsd?: number; busy?: boolean; queueLength?: number; lastActivity?: string } }
  | { type: "mirror_push"; text: string }
  | { type: "pong"; id: string };
