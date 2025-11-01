## CONTEXT ENGINEERING

1. Use JSON format to present schemas need to be enforced.
2. Simplified instructions/system prompts by including the necessary and related to the current query/context.
3. Don't ask LLM repeat or copy something, specially complicated patterns. The larger the content the higher risk the model making mistakes. Ask for sending placeholders instead and the client will process to transform placeholders into the actual contents.
4. Use IDs to connect things together, for example: If the model uses a tool call, attach the same ID (toolCallID) to the tool call request and the result.
5. Test the outcomes with as many models as possible. Each model has their own approach of resolving the query and tool usage.
6. Specialized agents can process some related tasks beyond their capacity by requesting other agents for more context.
7. Repair model's responses in-flight that are still correct but varies due to their creativity/randomness.
8. Option to see human-readable explanation (YAML) about what it did.

### Some scenarios lead to an infinite tool calls:

1. Update command need to read content, it sends a request to the Read command (1). The Read agent return a text response instead of a tool call -> Return back to the Update command, the Update agent still need to read -> resend another request (1) -> Loop created.
2. Conflict between the user query and strict system instructions -> Leave no way to escape the loop.
