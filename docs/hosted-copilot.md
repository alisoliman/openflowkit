# Hosted Copilot

The hosted server is a different trust boundary from the loopback-only Vite
bridge. Never publish `npm run dev` or `npm run preview`, copy an operator's
Copilot credentials into a container, or use one person's token for all users.

The deployment target is `https://app.getopenflowkit.com`. Selecting this name
does not register the domain. Domain purchase, recurring charges, Azure
provisioning, and production activation require separate approval.

## User experience

The editor works without signing in. For the Copilot provider, users choose
**Connect GitHub** in Flowpilot or Settings > AI. GitHub App user authorization
uses OAuth state, PKCE, and a server-side code exchange. An ordinary GitHub
account is not sufficient: the user also needs Copilot access, available quota,
and an organization policy that allows it.

Connections last seven days from sign-in, including across server restarts.
GitHub's expiring user tokens are renewed server-side; the application session
does not slide indefinitely. An agent turn keeps the token it starts with, so
the server first renews any token with less than four of its eight hours left;
a turn running longer than that loses Copilot access and keeps the changes it
already made. The SDK's `gitHubTokenProvider` would renew tokens during a turn,
but in SDK 1.0.14 it leaves the session unauthenticated. **Disconnect GitHub**
removes that browser's server-side credential record and clears its cookie. It
does not delete diagrams, change other AI provider settings, or revoke the
entire GitHub App grant on other devices. Users can revoke the grant in GitHub's
application settings.
Active generations and agent turns recheck their application authorization
every five seconds, including when disconnection happens on another replica.
Generations also recheck before returning a completed draft; a disconnected
agent turn stops and keeps the changes it already made. An agent turn whose
check cannot reach the store is interrupted instead, so the browser can
continue it. Cancellation can still consume Copilot usage.

Flowpilot chat runs as agent turns that edit the canvas live and may take many
steps. Turns have no step or time limit; **Stop** ends one at any point. Most
Copilot plans bill by tokens since 2026-06-01, so a long turn costs the user more
than a single diagram request.

The server admits at most 20 simultaneous generations or agent turns and one per
GitHub account across browser tabs, devices, replicas, and deployment revisions.
There is no queue: excess requests receive an explicit busy response and can be
retried. Stale admission leases expire after five minutes following a crash;
agent turns renew theirs every minute while they run. These are admission
limits, not a measured throughput guarantee.

## Runtime and data boundaries

- A shared, explicitly selected stdio Copilot runtime uses `mode: "empty"`.
  Its environment excludes the web server's GitHub App secret, Azure managed
  identity credentials, and operator GitHub/Copilot tokens.
- Every model-discovery, generation, or agent session receives the requesting
  user's token and a server-generated session ID. There is no client-controlled
  session resume, deletion, tool, filesystem, or credential parameter.
- Agent sessions expose only the OpenFlowKit canvas tools and `ask_user`, with a
  server-owned system message; every other permission request is rejected.
  Their tool handlers relay each call to the browser that started the turn and
  return its result. They have no filesystem, environment, or network access.
- Models are discovered through the user's session, never a global account
  cache. Missing entitlement and quota errors are distinct from GitHub sign-in.
- Host tools, MCP, configuration discovery, skills, host Git operations,
  cross-session memory, shared embedding retrieval, and session telemetry are
  disabled. Runtime content logging is disabled.
- Prompts, requested diagram context, chat context, images, and agent tool
  results transit the backend to GitHub. They are not deliberately persisted by
  the application.
  Temporary SDK sessions are deleted after processing; cleanup failure makes
  the runtime unhealthy so the container is restarted. Do not mount persistent
  storage at its temporary runtime directory.
- GitHub access and refresh tokens are AES-256-GCM encrypted and bound to their
  storage record. Browser cookies contain only random session handles and use
  `HttpOnly`, `Secure`, `SameSite=Lax`, and the `__Host-` prefix in production.
  GitHub tokens never enter frontend state, local storage, or response payloads.
- Authentication state and admission leases use an Azure table with conditional
  writes. Refresh locking prevents two replicas from consuming a refresh token
  concurrently. Storage failure fails closed; there is no in-memory production
  fallback. Expired records are swept every minute and rejected even before
  physical deletion.
- Diagrams and chats remain in the browser, tied to its origin. There is no
  cross-device synchronization or old-site migration in this release. GitHub's
  own processing and retention policies still apply.

## Agent socket

Copilot chat uses a WebSocket at `/api/copilot/agent`, one per turn, so a turn
never needs to reach the same replica twice. Upgrades bypass the request
listener, so the server repeats the hosted checks before accepting one:

- Other upgrade paths receive 404.
- `Host` must match the `PUBLIC_ORIGIN` host, `Origin` must equal
  `PUBLIC_ORIGIN`, and `Sec-Fetch-Site`, when sent, must be `same-origin`. The
  `flowpilot-agent.v1` subprotocol stands in for the client header that browsers
  cannot set on a socket. Failures receive 403.
- The session cookie is authorized before the upgrade completes. Without a
  GitHub connection the upgrade receives 401; during shutdown it receives 503.

The socket first takes the account's admission lease and reads nothing until
it has it, so a busy account gets an error message without its start being
read. When the turn ends, the socket stops reading and frees the lease before
it reports the end, so the next turn does not find the account busy. The first
message must be a valid start message within 30 seconds of connecting. Messages
are schema-checked with per-type size limits, and an invalid one closes the
socket with code 1008. The server pings every 25 seconds and drops a socket
that stays silent for 60 seconds.

There is no turn deadline. A question waits up to 10 minutes for an answer, and
the runtime's 15-minute session idle timeout does not reap a waiting session.
On SIGTERM the server stops accepting sockets, ends running turns as
interrupted, and closes them with code 1001 within the 15-second shutdown
deadline. The browser keeps the changes made so far and offers to continue.
Logs record only error codes, never prompts, canvas content, or tool arguments.

### Azure Container Apps findings

These come from Microsoft's documentation, not from a deployment:

- HTTP ingress supports WebSocket and documents a 240-second request timeout
  ([ingress overview](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview)).
  Only premium ingress can change it, as an idle request timeout of 4 to 30
  minutes ([environment ingress configuration](https://learn.microsoft.com/en-us/azure/container-apps/ingress-environment-configuration));
  this Consumption environment does not use premium ingress. The 25-second ping
  keeps a waiting socket active, assuming the limit applies to idle sockets.
  Confirm this once on the canonical origin by leaving a Flowpilot question
  unanswered for more than four minutes and then answering it. That check uses
  a small amount of Copilot quota and needs the same approval as other live checks.
- On scale-in or revision deactivation, a replica receives SIGTERM and then
  SIGKILL after `terminationGracePeriodSeconds`, 30 seconds by default
  ([application lifecycle](https://learn.microsoft.com/en-us/azure/container-apps/application-lifecycle-management),
  [template reference](https://learn.microsoft.com/en-us/dotnet/api/azure.resourcemanager.appcontainers.models.containerapptemplate.terminationgraceperiodseconds?view=azure-dotnet)).
  The 15-second shutdown deadline fits within it.
- How open WebSockets drain when traffic moves between revisions is not
  documented ([azure-container-apps#493](https://github.com/microsoft/azure-container-apps/issues/493)).
  New turns open on the new revision. A turn still running on the old revision
  when it is deactivated ends as interrupted and can be continued. No session
  affinity is needed, because each turn uses one socket and leases live in the
  shared table.
- The 180-second runtime and 210-second request timeouts apply only to one-shot
  generations at `/api/copilot/chat`, which the importers and documentation
  answers still use. The 240-second ingress timeout may also apply to agent
  sockets, as described above; this is unverified. Both paths take the
  300-second admission lease; agent turns renew it every minute.

## GitHub App prerequisites

Register a GitHub App for user authorization, available to the intended public
users. Do not request repository content or administration permissions. Keep
expiring user tokens enabled. App installation tokens and operator CLI tokens
are not substitutes for user authorization.

Configure:

| Setting | Value |
| --- | --- |
| Homepage | `https://app.getopenflowkit.com` |
| User authorization callback | `https://app.getopenflowkit.com/api/copilot/auth/callback` |
| User token expiration | Enabled |

Record the **client ID** and **client secret** (not the App ID). Put the secret
in Azure Key Vault, never a `VITE_*` variable, repository file, or browser field.
No App private key or installation token is required for this OAuth flow.

For a local authorization proof, register a separate development callback such
as `http://127.0.0.1:3045/api/copilot/auth/callback`. Do not point production
callbacks at localhost. First verify sign-in, model discovery, a single
quota-consuming diagram request, and disconnection with an authorized account.
Mocked tests cannot establish real Copilot entitlement or organization policy.
Obtain explicit permission before a live, quota-consuming load test.

## Server configuration

Use Node 22.12+ for the production container. Build with `npm run build:hosted`
and start with `npm run start:hosted`.

`Dockerfile.hosted` defaults to the public npm registry. In a network that
requires an approved, credential-free registry mirror, pass
`--build-arg NPM_REGISTRY=https://your-approved-mirror/` to the container build.
Do not put registry credentials in build arguments. Its project-scoped npm cache
is locked while each dependency stage installs packages.

| Environment variable | Purpose |
| --- | --- |
| `PUBLIC_ORIGIN` | Exact HTTPS origin, without a path; used for Host/Origin checks and the fixed OAuth callback |
| `HOSTED_GITHUB_CLIENT_ID` | GitHub App client ID |
| `HOSTED_GITHUB_CLIENT_SECRET` | GitHub App client secret; Key Vault reference in Azure |
| `HOSTED_SESSION_KEY` | Random 32-byte encryption key, base64 encoded; Key Vault reference |
| `HOSTED_STORAGE_ACCOUNT` | Azure Storage account containing the `Flowpilot` table |
| `AZURE_CLIENT_ID` | Azure user-assigned managed identity client ID |
| `PORT` | HTTP port; defaults to `3045` |
| `APP_REVISION` | Build commit, returned by health endpoints |

Keep the encryption key stable across replicas and deployments. Rotating it
invalidates existing sign-ins; coordinate a reconnect and expired-state cleanup.
Azure managed identity grants the app access only to its own table storage,
registry, and secret vault. The application does not create these resources at
startup.

For **local development only**, `HOSTED_DEVELOPMENT=true` requires an HTTP
loopback origin and binds to `127.0.0.1`. It uses an explicitly announced,
in-memory auth store; restarting it loses sign-ins. It still requires GitHub App
credentials and an encryption key. A gitignored `.env.hosted.local` can be loaded
with `node --env-file=.env.hosted.local dist-server/entry.js`.

## Azure infrastructure and first rollout

`infra/hosted/main.bicep` defines a West Europe Consumption Container Apps
environment, a private Basic container registry, encrypted credential storage,
a managed identity with scoped roles, Key Vault secrets, and content-free
operational logs. The app uses one warm 1-vCPU/2-GiB replica and may scale to two.
Old revisions also cost money while active. The earlier EUR 50/month figure is
a planning target, not a quote or a hard spending cap; assess actual costs and
load before provisioning. Azure budget alerts do not automatically stop charges.

Where subscription policy disables public network access to storage accounts or
key vaults, deploy with `privateNetworking=true`. The environment then joins a
VNet and reaches the table and Key Vault through private endpoints, which add
their own hourly charge. Decide before the first deployment: an existing
environment cannot be moved into a VNet, and recreating it changes the generated
Azure hostname.

After resource and cost approval:

1. Register the GitHub App and prepare secure deployment parameters. Generate
   the encryption key with a cryptographically secure generator; do not print
   secrets into shared logs or commit parameter values.
2. Deploy `infra/hosted/main.bicep` to the approved resource group with
   `deployApplication=false`. This creates the foundation, including **paid
   resources**, but not a running application. Secure parameters are required.
   The provisioning identity needs permission to create the defined resources,
   secrets, and scoped role assignments.
3. Use the output registry to build and push `Dockerfile.hosted`, supplying the
   source commit as the `APP_REVISION` build argument. Keep the image private.
4. Redeploy with `deployApplication=true` and `containerImage` set to the pushed
   immutable image digest. Allow Azure role assignment propagation before
   expecting managed identity and Key Vault references to work.
5. After approving the registrar's exact price, registration contact details,
   renewal setting, and terms, purchase `getopenflowkit.com` through Azure
   App Service Domains. This also incurs DNS charges. No App Service compute
   plan is needed for a domain used with Container Apps.
6. In its DNS zone, point `app` at the Container App ingress FQDN and add Azure's
   domain-verification record. Add the custom hostname and a free Container
   Apps managed TLS certificate. Do not purchase an App Service TLS certificate.
   Preserve the certificate ID as `managedCertificateId` on later Bicep runs.
7. Verify `/readyz`, anonymous editing, real GitHub App sign-in and Copilot
   access, streaming, agent turns and questions, cancellation, account
   separation, token renewal, disconnection, and error recovery on the
   canonical origin before opening it publicly. The generated Azure hostname is suitable for health checks; the
   authenticated API deliberately accepts only `PUBLIC_ORIGIN`.

The original static deployment and nginx `Dockerfile` remain separate and
unchanged. Avoid reapplying the initial Bicep traffic rule during routine code
releases: the deployment workflow manages exact revision routing.

## Automatic releases

The existing **Quality Checks** workflow calls `hosted-deploy.yml` only after its
tests, frontend/server builds, browser checks, and Linux-container proof succeed
for a push to `main`. The container runs as its non-root runtime user under the
planned 1-vCPU/2-GiB limits, and its baked revision must match the tested commit.
The deployment workflow repeats the proof against the exact published image
digest before staging it in Azure.
Deployment also requires repository variable `HOSTED_DEPLOY_ENABLED=true`.
Leave this unset until first-rollout verification and separate activation
approval are complete.

Configure the `hosted-production` GitHub environment and a separate Azure
deployment identity using GitHub OIDC, restricted to this repository and
environment. Restrict the environment's deployment branches to `main`.
Grant the deployment identity registry push and management of this Container
App, not subscription-wide ownership. GitHub App user credentials are not CI
credentials.

Set these repository/environment variables:

```text
HOSTED_DEPLOY_ENABLED
HOSTED_RESOURCE_GROUP
HOSTED_CONTAINER_APP
HOSTED_ACR_NAME
HOSTED_AZURE_CLIENT_ID
HOSTED_AZURE_TENANT_ID
HOSTED_AZURE_SUBSCRIPTION_ID
```

`scripts/deploy-hosted.sh` pins traffic to the current revision, stages the new
image by digest, and checks that the candidate `/readyz` reports the expected
commit and serves the hosted frontend. Only then does it move production traffic
and verify the main ingress URL. It waits four minutes for existing streams
and agent turns before deactivating the old revision. Failure before successful promotion
restores the previous routing and attempts to deactivate the candidate, with
explicit errors if recovery fails.

`npm run test:hosted-runtime` checks the compiled Node server and its real bundled
stdio runtime in isolated loopback mode, using placeholder GitHub App values.
It verifies health, the anonymous editor, compressed assets, rejection of
unauthenticated generation and agent sockets, OAuth initiation, and graceful
shutdown. It does not authorize a GitHub account, send a model request, or use
Azure resources.

The API uses native Node streaming and WebSockets and does not pass through the
Static Web Apps 45-second API proxy. `/healthz` checks the local Copilot runtime; `/readyz` also
checks access to the auth store. Neither requires a personal GitHub token or
consumes a model request.
