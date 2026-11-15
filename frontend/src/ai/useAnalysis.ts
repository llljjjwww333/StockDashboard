import { useAiRequest } from './useAiRequest';
import { isAnalysisResult } from './analysisPayload';
import type { AiProfile, AnalysisRequest, AnalysisResult } from './types';

export function useAnalysis(contextKey: string, profile?: AiProfile) {
  return useAiRequest<AnalysisRequest, AnalysisResult>(contextKey, profile, '/ai/analyze', isAnalysisResult);
}
