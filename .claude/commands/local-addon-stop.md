Tear down the local doc-align test stack started by `/local-addon-test`: point the shared Workspace deployment back at Cloud Run, and kill the local ngrok tunnel and Go server.

Repo root: `/Users/daniel/git_repos/doc-align`
GCP account: `depstein@docalign.app`

Steps:

1. **Repoint the shared deployment at Cloud Run** using the committed `deployment.json` as-is (it already points at Cloud Run once reverted — confirm with `git diff --quiet -- packages/addon-backend/deployment.json` first; if it's dirty, stop and show the diff instead of pushing an unexpected config):
   ```
   cd /Users/daniel/git_repos/doc-align
   gcloud workspace-add-ons deployments replace my-addon \
     --deployment-file=packages/addon-backend/deployment.json \
     --project=docalign-prod \
     --account=depstein@docalign.app
   ```

2. **Stop the local processes:**
   ```
   source /Users/daniel/git_repos/doc-align/packages/addon-backend/.env
   pkill -f "ngrok http --url=$NGROK_URL" 2>/dev/null
   lsof -ti:8080 | xargs kill 2>/dev/null
   ```

3. **Tell the user:** "Shared deployment is back on Cloud Run, and the local ngrok tunnel and Go server are stopped."
