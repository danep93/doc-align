package services

import (
	"context"
	"strings"

	"google.golang.org/api/docs/v1"
	"google.golang.org/api/option"
)

type DocSection struct {
	Title string
	Text  string
}

// FetchDocText reads the current document content using the provided OAuth token.
// Returns the full text and sections parsed by H1/H2 headings.
func FetchDocText(ctx context.Context, userToken, docID string) (string, []DocSection, error) {
	svc, err := docs.NewService(ctx, option.WithTokenSource(
		staticTokenSource(userToken),
	))
	if err != nil {
		return "", nil, err
	}

	doc, err := svc.Documents.Get(docID).Context(ctx).Do()
	if err != nil {
		return "", nil, err
	}

	var sb strings.Builder
	for _, elem := range doc.Body.Content {
		if elem.Paragraph != nil {
			for _, pe := range elem.Paragraph.Elements {
				if pe.TextRun != nil {
					sb.WriteString(pe.TextRun.Content)
				}
			}
		}
	}
	fullText := sb.String()
	sections := parseSections(doc)
	return fullText, sections, nil
}

// parseSections groups document content into sections by H1/H2 heading.
func parseSections(doc *docs.Document) []DocSection {
	var sections []DocSection
	var current *DocSection

	for _, elem := range doc.Body.Content {
		if elem.Paragraph == nil {
			continue
		}
		p := elem.Paragraph

		isHeading := false
		if p.ParagraphStyle != nil {
			style := p.ParagraphStyle.NamedStyleType
			if style == "HEADING_1" || style == "HEADING_2" {
				isHeading = true
			}
		}

		var lineText strings.Builder
		for _, pe := range p.Elements {
			if pe.TextRun != nil {
				lineText.WriteString(pe.TextRun.Content)
			}
		}
		text := strings.TrimRight(lineText.String(), "\n")

		if isHeading {
			if current != nil {
				sections = append(sections, *current)
			}
			current = &DocSection{Title: text}
		} else if current != nil {
			current.Text += text + "\n"
		}
	}
	if current != nil {
		sections = append(sections, *current)
	}
	return sections
}
