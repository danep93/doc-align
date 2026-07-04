package services

// BuildChangeSummary converts a computed diff into the storable summary. This is the
// only artifact of a confirm that persists: headings and counts, never document text.
func BuildChangeSummary(result DriftResult, note, fromRevID, toRevID string) ChangeSummary {
	sections := make([]ChangeSection, 0, len(result.Sections))
	for _, s := range result.Sections {
		sections = append(sections, ChangeSection{Title: s.Title, Added: s.Added, Removed: s.Removed})
	}
	return ChangeSummary{
		Note:           note,
		Sections:       sections,
		TotalAdded:     result.Added,
		TotalRemoved:   result.Removed,
		FromRevisionID: fromRevID,
		ToRevisionID:   toRevID,
	}
}
