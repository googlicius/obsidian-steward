import { OpenAIChatMessage } from 'modelfusion';

export const confidenceScorePrompt: OpenAIChatMessage = {
	role: 'system',
	content: `Add a property called "confidence" to the response JSON object that reflects your certainty about the interpretation.
The confidence score from 0 to 1:
- 0.0-0.3: Low confidence (ambiguous or unclear requests)
- 0.4-0.7: Medium confidence (likely, but could be interpreted differently)
- 0.8-1.0: High confidence (very clear intent)`,
};
