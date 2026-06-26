package routes

import (
	"net/http"

	"github.com/doc-align/addon-backend/cards"
)

// RequestFileScope returns the editor action that triggers Google's per-file
// drive.file consent dialog for the active document. After the user grants,
// Google fires onFileScopeGrantedTrigger with docs.id populated.
func RequestFileScope() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, cards.RequestFileScopeForActiveDocument())
	}
}
