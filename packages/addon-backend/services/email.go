package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

func SendSignoffRequest(apiKey, ownerEmail, docTitle, docID string, signerEmails []string) error {
	if apiKey == "" {
		return fmt.Errorf("RESEND_API_KEY not set")
	}

	ownerName := DisplayName(ownerEmail)
	docURL := "https://docs.google.com/document/d/" + docID + "/edit"

	subject := fmt.Sprintf("%s requested your sign-off on %q", ownerName, docTitle)

	plainText := fmt.Sprintf(
		"%s has asked you to review and sign off on:\n\n  %s\n\nOpen the document to review it. Sign off from the sidebar when ready:\n%s\n\n──\nSent by DocAlign on behalf of %s.\nYou received this because you were added as a signer on this document.",
		ownerName, docTitle, docURL, ownerEmail,
	)

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:560px;margin:40px auto;color:#1f2328">
  <p><strong>%s</strong> has asked you to review and sign off on:</p>
  <p style="font-size:18px;font-weight:600">%s</p>
  <p>Open the document to review it. Sign off from the sidebar when ready.</p>
  <p>
    <a href="%s"
       style="display:inline-block;padding:10px 20px;background:#1a73e8;color:#fff;text-decoration:none;border-radius:4px;font-weight:600">
      Open document
    </a>
  </p>
  <hr style="margin-top:40px;border:none;border-top:1px solid #e1e4e8">
  <p style="color:#6e7781;font-size:12px">
    Sent by DocAlign on behalf of %s.<br>
    You received this because you were added as a signer on this document.
  </p>
</body>
</html>`, ownerName, docTitle, docURL, ownerEmail)

	var errs []string
	for _, to := range signerEmails {
		to = strings.TrimSpace(to)
		if to == "" {
			continue
		}
		if err := resendSend(apiKey, to, subject, plainText, htmlBody); err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", to, err))
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("resend: %s", strings.Join(errs, "; "))
	}
	return nil
}

func resendSend(apiKey, to, subject, text, html string) error {
	payload := map[string]any{
		"from":    "DocAlign <noreply@docalign.app>",
		"to":      []string{to},
		"subject": subject,
		"text":    text,
		"html":    html,
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequest(http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

func SendSignedNotification(apiKey, ownerEmail, signerEmail, docTitle, docID string) error {
	if apiKey == "" {
		return fmt.Errorf("RESEND_API_KEY not set")
	}

	signerName := DisplayName(signerEmail)
	docURL := "https://docs.google.com/document/d/" + docID + "/edit"

	subject := fmt.Sprintf("%s signed off on %q", signerName, docTitle)

	plainText := fmt.Sprintf(
		"%s has signed off on \"%s\".\n\nView the document to check the latest sign-off status:\n%s",
		signerName, docTitle, docURL,
	)

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:560px;margin:40px auto;color:#1f2328">
  <p><strong>%s</strong> has signed off on:</p>
  <p style="font-size:18px;font-weight:600">%s</p>
  <p>
    <a href="%s"
       style="display:inline-block;padding:10px 20px;background:#1a73e8;color:#fff;text-decoration:none;border-radius:4px;font-weight:600">
      View document
    </a>
  </p>
  <hr style="margin-top:40px;border:none;border-top:1px solid #e1e4e8">
  <p style="color:#6e7781;font-size:12px">Sent by DocAlign.</p>
</body>
</html>`, signerName, docTitle, docURL)

	return resendSend(apiKey, ownerEmail, subject, plainText, htmlBody)
}

func SendDriftNotification(apiKey, signerEmail, ownerEmail, docTitle, docID string, summary ChangeSummary) error {
	if apiKey == "" {
		return fmt.Errorf("RESEND_API_KEY not set")
	}

	ownerName := DisplayName(ownerEmail)
	docURL := "https://docs.google.com/document/d/" + docID + "/edit"

	subject := fmt.Sprintf("%s updated %q — please re-review", ownerName, docTitle)

	var sectionLines strings.Builder
	var sectionHTML strings.Builder
	for _, s := range summary.Sections {
		sectionLines.WriteString(fmt.Sprintf("  • %s (+%d / -%d)\n", s.Title, s.Added, s.Removed))
		sectionHTML.WriteString(fmt.Sprintf("<li>%s <span style=\"color:#6e7781\">(+%d / -%d)</span></li>", s.Title, s.Added, s.Removed))
	}
	noteText := ""
	noteHTML := ""
	if summary.Note != "" {
		noteText = fmt.Sprintf("\nNote from %s: %s\n", ownerName, summary.Note)
		noteHTML = fmt.Sprintf("<p><em>Note from %s:</em> %s</p>", ownerName, summary.Note)
	}

	plainText := fmt.Sprintf(
		"%s confirmed changes to \"%s\" since you signed off (+%d added / -%d removed).\n\nChanged sections:\n%s%s\nOpen the document to re-review and sign off again from the sidebar:\n%s",
		ownerName, docTitle, summary.TotalAdded, summary.TotalRemoved, sectionLines.String(), noteText, docURL,
	)

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:560px;margin:40px auto;color:#1f2328">
  <p><strong>%s</strong> confirmed changes to the following document since you signed off (+%d added / -%d removed):</p>
  <p style="font-size:18px;font-weight:600">%s</p>
  <ul>%s</ul>
  %s
  <p>Open the document to re-review and sign off again from the sidebar.</p>
  <p>
    <a href="%s"
       style="display:inline-block;padding:10px 20px;background:#1a73e8;color:#fff;text-decoration:none;border-radius:4px;font-weight:600">
      Open document
    </a>
  </p>
  <hr style="margin-top:40px;border:none;border-top:1px solid #e1e4e8">
  <p style="color:#6e7781;font-size:12px">Sent by DocAlign on behalf of %s.</p>
</body>
</html>`, ownerName, summary.TotalAdded, summary.TotalRemoved, docTitle, sectionHTML.String(), noteHTML, docURL, ownerEmail)

	return resendSend(apiKey, signerEmail, subject, plainText, htmlBody)
}

// SendOwnerNudge tells the owner a signer is waiting on them to confirm the latest changes.
func SendOwnerNudge(apiKey, ownerEmail, signerEmail, docTitle, docID string) error {
	if apiKey == "" {
		return fmt.Errorf("RESEND_API_KEY not set")
	}

	signerName := DisplayName(signerEmail)
	docURL := "https://docs.google.com/document/d/" + docID + "/edit"

	subject := fmt.Sprintf("%s is waiting to sign %q", signerName, docTitle)

	plainText := fmt.Sprintf(
		"%s wants to sign off on \"%s\", but the document has unconfirmed changes.\n\nOpen the document and confirm the new version from the sidebar so signing can continue:\n%s",
		signerName, docTitle, docURL,
	)

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:560px;margin:40px auto;color:#1f2328">
  <p><strong>%s</strong> wants to sign off on:</p>
  <p style="font-size:18px;font-weight:600">%s</p>
  <p>The document has unconfirmed changes. Confirm the new version from the sidebar so signing can continue.</p>
  <p>
    <a href="%s"
       style="display:inline-block;padding:10px 20px;background:#1a73e8;color:#fff;text-decoration:none;border-radius:4px;font-weight:600">
      Open document
    </a>
  </p>
  <hr style="margin-top:40px;border:none;border-top:1px solid #e1e4e8">
  <p style="color:#6e7781;font-size:12px">Sent by DocAlign.</p>
</body>
</html>`, signerName, docTitle, docURL)

	return resendSend(apiKey, ownerEmail, subject, plainText, htmlBody)
}

// DisplayName extracts a capitalized first name from an email address.
// "rahul@docalign.app" → "Rahul"
func DisplayName(email string) string {
	local := strings.SplitN(email, "@", 2)[0]
	local = strings.ReplaceAll(local, ".", " ")
	local = strings.ReplaceAll(local, "_", " ")
	if local == "" {
		return email
	}
	parts := strings.Fields(local)
	for i, p := range parts {
		if len(p) > 0 {
			parts[i] = strings.ToUpper(p[:1]) + p[1:]
		}
	}
	return strings.Join(parts, " ")
}
