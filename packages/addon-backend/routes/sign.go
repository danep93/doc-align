package routes

import (
	"net/http"

	"github.com/doc-align/addon-backend/services"
)

func Sign(store *services.Store, resendKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ev, err := decodeEvent(r)
		if err != nil {
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}
		completeSign(w, r, store, resendKey, ev, ev.formString("commitMessage"))
	}
}
