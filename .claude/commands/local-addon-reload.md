Rebuild and restart just the local Go server for fast iteration — leaves the ngrok tunnel and the shared deployment's pointer untouched, since neither the tunnel URL nor BASE_URL changes when the Go code changes.

Use this instead of `/local-addon-test` when ngrok is already running and the shared deployment already points at it — i.e. mid-session, after editing Go code.

Repo root: `/Users/daniel/git_repos/doc-align`

Steps:

1. **Confirm ngrok is actually still running** — this command assumes it is; it does not start or touch it:
   ```
   pgrep -f "ngrok http" >/dev/null && echo "ngrok running" || echo "ngrok NOT running — run /local-addon-test instead, not this command"
   ```
   If ngrok isn't running, stop and tell the user to run `/local-addon-test` instead.

2. **Free port 8080** (kills whatever's listening there — covers both the `go run` parent and the compiled binary child it spawns, which `pkill -f "go run"` alone can miss):
   ```
   lsof -ti:8080 | xargs kill 2>/dev/null
   sleep 1
   ```

3. **Rebuild and restart the Go server** in the background:
   ```
   cd /Users/daniel/git_repos/doc-align/packages/addon-backend && source .env && go run .
   ```
   (Note: `go run .` must run from inside `packages/addon-backend` — there's no `go.mod` at the repo root, so `go run ./packages/addon-backend/` from the repo root fails with "cannot find main module".)

4. **Verify it started cleanly** — read the last few lines of the background command's output and confirm it shows `doc-align addon backend listening on :8080`, not an error.

5. **Tell the user:** "Go server rebuilt and restarted — ngrok and the deployment pointer are untouched. Reload the Google Doc (or close/reopen the sidebar) to pick up the change."
