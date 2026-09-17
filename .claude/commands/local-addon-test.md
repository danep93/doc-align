Spin up the doc-align add-on backend against a local ngrok tunnel, point the shared Workspace deployment at it, and open the test doc in Chrome so its sidebar hits the local Go server.

Repo root: `/Users/daniel/git_repos/doc-align`
Test doc: `https://docs.google.com/document/d/1_hXY42fLX-LR5qm2oaOUOqIzfwo8VlO9AwDHFLzdlr4/edit?usp=sharing`
GCP account: `depstein@docalign.app`

Steps:

1. **Preconditions.**
   - Confirm `packages/addon-backend/.env` exists. If not, stop and tell the user to copy `.env.example` to `.env` and fill in `NGROK_URL` / `DEBUG_EMAIL` first.
   - Run `git -C /Users/daniel/git_repos/doc-align diff --quiet -- packages/addon-backend/deployment.json`. If it's already dirty, stop and show the diff — don't touch a file the user is mid-edit on.

2. **Clear out any stale instances of this same command** so re-running it doesn't hit "address already in use":
   ```
   source /Users/daniel/git_repos/doc-align/packages/addon-backend/.env
   pkill -f "ngrok http --url=$NGROK_URL" 2>/dev/null
   lsof -ti:8080 | xargs kill 2>/dev/null
   ```

3. **Start ngrok** in the background (run_in_background):
   ```
   source /Users/daniel/git_repos/doc-align/packages/addon-backend/.env && ngrok http --url=$NGROK_URL 8080
   ```

4. **Start the Go server** in the background (run_in_background). Must run from inside `packages/addon-backend` — there's no `go.mod` at the repo root, so `go run ./packages/addon-backend/` from the repo root fails with "cannot find main module":
   ```
   cd /Users/daniel/git_repos/doc-align/packages/addon-backend && source .env && go run .
   ```

5. **Wait for the tunnel to come up**, polling rather than a long blind sleep:
   ```
   source /Users/daniel/git_repos/doc-align/packages/addon-backend/.env
   for i in $(seq 1 30); do
     curl -s -o /dev/null -w "%{http_code}" "https://$NGROK_URL/healthz" | grep -q 200 && break
     sleep 1
   done
   ```
   If it never returns 200 within the loop, stop and show the ngrok/go server output — don't proceed to the deployment step against a dead tunnel.

6. **Point the shared deployment at the tunnel.** This temporarily edits the committed `deployment.json`, pushes it, then immediately reverts the file so the ngrok URL never sits in the working tree longer than needed:
   ```
   cd /Users/daniel/git_repos/doc-align
   source packages/addon-backend/.env
   sed -i '' "s#https://doc-align-addon-856331950906.us-central1.run.app#https://$NGROK_URL#g" packages/addon-backend/deployment.json
   gcloud workspace-add-ons deployments replace my-addon \
     --deployment-file=packages/addon-backend/deployment.json \
     --project=docalign-prod \
     --account=depstein@docalign.app
   git checkout -- packages/addon-backend/deployment.json
   ```
   Tell the user this just repointed the **shared** org-wide deployment at their laptop — anyone else's add-on session is now hitting their tunnel too, until `/local-addon-stop` is run.

7. **Open the test doc in Chrome.** Load the Chrome tools if not already loaded (`ToolSearch` with `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp`), then create a new tab at:
   ```
   https://docs.google.com/document/d/1_hXY42fLX-LR5qm2oaOUOqIzfwo8VlO9AwDHFLzdlr4/edit?usp=sharing
   ```

8. **Tell the user, verbatim in substance:** "Local stack is up — ngrok and the Go server are running in the background, the shared deployment now points at your tunnel, and the test doc is open in Chrome. Click the doc-align icon in the right sidebar to load the add-on (Google renders that panel itself, so I can't auto-open it). When you're done testing, run `/local-addon-stop` to point the deployment back at Cloud Run and stop the local processes."
