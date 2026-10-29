import { meterLanguageModel } from '@gitroom/nestjs-libraries/services/ai-usage.model-wrap';

// Meters CopilotKit's OpenAIAdapter. The runtime does not call the adapter
// itself: it asks it for an AI SDK model (getLanguageModel) and runs that in
// its built-in agent, out of reach of our model wrappers. Wrapping the model
// it hands over records every completion; the organization comes from
// aiUsageOrgContext, which the controller sets around the request.
export const meterCopilotAdapter = <T>(adapter: T, engine: 'autocomplete'): T => {
  const target = adapter as { getLanguageModel?: () => any };
  if (typeof target?.getLanguageModel !== 'function') {
    return adapter;
  }

  const getLanguageModel = target.getLanguageModel.bind(adapter);
  target.getLanguageModel = () => meterLanguageModel(getLanguageModel(), engine);
  return adapter;
};
