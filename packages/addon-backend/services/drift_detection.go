package services

import (
	"strings"

	"github.com/doc-align/addon-backend/cards"
)

const driftThreshold = 0.80

// DriftResult holds the result of comparing the current doc against a signed revision.
type DriftResult struct {
	Drifted  bool
	Added    int
	Removed  int
	Sections []cards.DiffSection
}

// DetectDrift compares current doc text against the signed-revision text.
// Returns true if any section similarity dropped below the threshold or a section was added/removed.
func DetectDrift(currentText, signedText string) DriftResult {
	currentSections := splitBySections(currentText)
	signedSections := splitBySections(signedText)

	drifted := false
	var added, removed int
	var diffSections []cards.DiffSection

	for title, current := range currentSections {
		signed, exists := signedSections[title]
		if !exists {
			// New section added
			drifted = true
			diffSections = append(diffSections, cards.DiffSection{
				Title: title,
				Added: lineCount(current),
			})
			added += lineCount(current)
			continue
		}
		sim := similarity(signed, current)
		if sim < driftThreshold {
			drifted = true
		}
		a, r, lines := lineDiff(signed, current)
		added += a
		removed += r
		if a > 0 || r > 0 {
			diffSections = append(diffSections, cards.DiffSection{
				Title:   title,
				Added:   a,
				Removed: r,
				Lines:   lines,
			})
		}
	}

	for title := range signedSections {
		if _, exists := currentSections[title]; !exists {
			drifted = true
			r := lineCount(signedSections[title])
			removed += r
			diffSections = append(diffSections, cards.DiffSection{
				Title:   title,
				Removed: r,
			})
		}
	}

	return DriftResult{
		Drifted:  drifted,
		Added:    added,
		Removed:  removed,
		Sections: diffSections,
	}
}

// splitBySections parses plain text into a map of heading → body text.
func splitBySections(text string) map[string]string {
	result := make(map[string]string)
	lines := strings.Split(text, "\n")
	var current string
	var body strings.Builder

	for _, line := range lines {
		if isHeadingLine(line) {
			if current != "" {
				result[current] = body.String()
			}
			current = strings.TrimSpace(line)
			body.Reset()
		} else if current != "" {
			body.WriteString(line)
			body.WriteByte('\n')
		}
	}
	if current != "" {
		result[current] = body.String()
	}
	return result
}

func isHeadingLine(line string) bool {
	t := strings.TrimSpace(line)
	return len(t) > 0 && len(t) < 60 && !strings.Contains(t, " ") == false
}

// similarity returns the fraction of shared lines between two texts (Jaccard-like).
func similarity(a, b string) float64 {
	aLines := lineSet(a)
	bLines := lineSet(b)
	if len(aLines)+len(bLines) == 0 {
		return 1.0
	}
	intersection := 0
	for l := range aLines {
		if bLines[l] {
			intersection++
		}
	}
	union := len(aLines) + len(bLines) - intersection
	if union == 0 {
		return 1.0
	}
	return float64(intersection) / float64(union)
}

func lineSet(text string) map[string]bool {
	m := make(map[string]bool)
	for _, l := range strings.Split(text, "\n") {
		t := strings.TrimSpace(l)
		if t != "" {
			m[t] = true
		}
	}
	return m
}

func lineCount(text string) int {
	n := 0
	for _, l := range strings.Split(text, "\n") {
		if strings.TrimSpace(l) != "" {
			n++
		}
	}
	return n
}

// lineDiff runs an LCS diff between two texts and returns added/removed counts + annotated lines.
func lineDiff(oldText, newText string) (added, removed int, lines []cards.DiffLine) {
	a := nonEmptyLines(oldText)
	b := nonEmptyLines(newText)

	table := lcsTable(a, b)
	lines = backtrack(a, b, table, len(a), len(b))

	for _, l := range lines {
		switch l.Type {
		case "added":
			added++
		case "removed":
			removed++
		}
	}
	return
}

func nonEmptyLines(text string) []string {
	var result []string
	for _, l := range strings.Split(text, "\n") {
		if strings.TrimSpace(l) != "" {
			result = append(result, l)
		}
	}
	return result
}

func lcsTable(a, b []string) [][]int {
	m, n := len(a), len(b)
	dp := make([][]int, m+1)
	for i := range dp {
		dp[i] = make([]int, n+1)
	}
	for i := 1; i <= m; i++ {
		for j := 1; j <= n; j++ {
			if a[i-1] == b[j-1] {
				dp[i][j] = dp[i-1][j-1] + 1
			} else if dp[i-1][j] >= dp[i][j-1] {
				dp[i][j] = dp[i-1][j]
			} else {
				dp[i][j] = dp[i][j-1]
			}
		}
	}
	return dp
}

func backtrack(a, b []string, dp [][]int, i, j int) []cards.DiffLine {
	if i == 0 && j == 0 {
		return nil
	}
	if i > 0 && j > 0 && a[i-1] == b[j-1] {
		return append(backtrack(a, b, dp, i-1, j-1), cards.DiffLine{Type: "context", Text: a[i-1]})
	}
	if j > 0 && (i == 0 || dp[i][j-1] >= dp[i-1][j]) {
		return append(backtrack(a, b, dp, i, j-1), cards.DiffLine{Type: "added", Text: b[j-1]})
	}
	return append(backtrack(a, b, dp, i-1, j), cards.DiffLine{Type: "removed", Text: a[i-1]})
}
