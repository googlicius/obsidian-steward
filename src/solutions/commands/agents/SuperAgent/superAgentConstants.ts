/**
 * Max conversation messages (after topic filter and step-preserving slice) sent to the model per
 * SuperAgent / streamText turn. Default extractConversationHistory is 10, which is too small for
 * multi-step tool use.
 */
export const SUPER_AGENT_MAX_CONVERSATION_MESSAGES = 40;
