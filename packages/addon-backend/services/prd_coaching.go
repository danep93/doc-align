package services

import "time"

// EvaluateCoaching turns a PRD completeness classification (or its absence, on
// any failure) into what should be persisted and whether the owner still needs
// to resolve something before proceeding. callErr or a nil result are treated
// identically — both mean "the check failed, fall back to manual entry" — since
// callers must never distinguish "LLM said no" from "LLM was unreachable" when
// deciding whether to let the owner proceed.
func EvaluateCoaching(result *PRDCompletenessResult, callErr error, resolvedBy string) (coaching PRDCoachingResult, needsCoaching bool) {
	if callErr != nil || result == nil {
		return PRDCoachingResult{}, true
	}

	if result.PressReleaseFound {
		coaching.PressReleasePresent = true
		coaching.PressReleaseText = result.PressReleaseText
		coaching.PressReleaseSource = "llm"
	}
	if result.DefinitionOfDoneFound {
		coaching.DoDPresent = true
		coaching.DoDText = result.DefinitionOfDoneText
		coaching.DoDSource = "llm"
	}

	needsCoaching = !result.PressReleaseFound || !result.DefinitionOfDoneFound
	if !needsCoaching {
		coaching.ResolvedAt = time.Now()
		coaching.ResolvedBy = resolvedBy
	}
	return coaching, needsCoaching
}
