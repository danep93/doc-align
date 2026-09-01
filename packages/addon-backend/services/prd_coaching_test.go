package services_test

import (
	"fmt"
	"testing"

	"github.com/doc-align/addon-backend/services"
)

func TestEvaluateCoaching(t *testing.T) {
	t.Run("both found: fully resolved, no coaching needed", func(t *testing.T) {
		result := &services.PRDCompletenessResult{
			PressReleaseFound: true, PressReleaseText: "PR text",
			DefinitionOfDoneFound: true, DefinitionOfDoneText: "DoD text",
		}
		coaching, needsCoaching := services.EvaluateCoaching(result, nil, "owner@example.com")
		if needsCoaching {
			t.Error("expected needsCoaching=false when both fields found")
		}
		if !coaching.PressReleasePresent || coaching.PressReleaseText != "PR text" || coaching.PressReleaseSource != "llm" {
			t.Errorf("press release: got %+v", coaching)
		}
		if !coaching.DoDPresent || coaching.DoDText != "DoD text" || coaching.DoDSource != "llm" {
			t.Errorf("DoD: got %+v", coaching)
		}
		if coaching.ResolvedBy != "owner@example.com" || coaching.ResolvedAt.IsZero() {
			t.Errorf("expected resolution stamped when fully resolved, got %+v", coaching)
		}
	})

	t.Run("one missing: needs coaching, found field marked llm, missing field blank", func(t *testing.T) {
		result := &services.PRDCompletenessResult{
			PressReleaseFound: true, PressReleaseText: "PR text",
			DefinitionOfDoneFound: false, DefinitionOfDoneText: "",
		}
		coaching, needsCoaching := services.EvaluateCoaching(result, nil, "owner@example.com")
		if !needsCoaching {
			t.Error("expected needsCoaching=true when one field missing")
		}
		if !coaching.PressReleasePresent || coaching.PressReleaseSource != "llm" {
			t.Errorf("press release should be marked found via llm, got %+v", coaching)
		}
		if coaching.DoDPresent || coaching.DoDSource != "" || coaching.DoDText != "" {
			t.Errorf("DoD should be blank/unresolved, got %+v", coaching)
		}
		if !coaching.ResolvedAt.IsZero() {
			t.Error("resolution metadata should not be stamped until fully resolved")
		}
	})

	t.Run("both missing: needs coaching", func(t *testing.T) {
		result := &services.PRDCompletenessResult{}
		coaching, needsCoaching := services.EvaluateCoaching(result, nil, "owner@example.com")
		if !needsCoaching {
			t.Error("expected needsCoaching=true when both fields missing")
		}
		if coaching.PressReleasePresent || coaching.DoDPresent {
			t.Errorf("expected both unpresent, got %+v", coaching)
		}
	})

	t.Run("classification error: needs coaching, zero-value result", func(t *testing.T) {
		coaching, needsCoaching := services.EvaluateCoaching(nil, fmt.Errorf("boom"), "owner@example.com")
		if !needsCoaching {
			t.Error("expected needsCoaching=true on classification error")
		}
		if coaching.PressReleasePresent || coaching.DoDPresent || coaching.PressReleaseSource != "" || coaching.DoDSource != "" {
			t.Errorf("expected zero-value coaching result on error, got %+v", coaching)
		}
	})

	t.Run("nil result with no error is treated as failure defensively", func(t *testing.T) {
		_, needsCoaching := services.EvaluateCoaching(nil, nil, "owner@example.com")
		if !needsCoaching {
			t.Error("expected needsCoaching=true when result is nil, regardless of err")
		}
	})
}
