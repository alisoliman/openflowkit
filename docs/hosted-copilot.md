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
does not slide indefinitely. **Disconnect GitHub** removes that browser's
server-side credential record and clears its cookie. It does not delete diagrams,
change other AI provider settings, or revoke the entire GitHub App grant on
other devices. Users can revoke the grant in GitHub's application settings.
Active generations recheck their application authorization every five seconds
and before returning a completed draft, including when disconnection happens on
another replica. Cancellation can still consume Copilot usage.

The server admits at most 20 simultaneous generations and one per GitHub
account across browser tabs, devices, replicas, and deployment revisions. There
is no queue: excess requests receive an explicit busy response and can be
retried. Stale admission leases expire after five minutes following a crash.
These are admission limits, not a measured throughput guarantee.

## Runtime and data boundaries

- A shared, explicitly selected stdio Copilot runtime uses `mode: "empty"`.
  Its environment excludes the web server's GitHub App secret, Azure managed
  identity credentials, and operator GitHub/Copilot tokens.
- Every model-discovery or generation session receives the requesting user's
  token and a server-generated session ID. There is no client-controlled
  session resume, deletion, tool, filesystem, or credential parameter.
- Models are discovered through the user's session, never a global account
  cache. Missing entitlement and quota errors are distinct from GitHub sign-in.
- Host tools, MCP, configuration discovery, skills, host Git operations,
  cross-session memory, shared embedding retrieval, and session telemetry are
  disabled. Runtime content logging is disabled.
- Prompts, requested diagram context, chat context, and images transit the
  backend to GitHub. They are not deliberately persisted by the application.
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
   access, streaming, cancellation, account separation, token renewal,
   disconnection, and error recovery on the canonical origin before opening it
   publicly. The generated Azure hostname is suitable for health checks; the
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
and verify the main ingress URL. It drains existing streams for four minutes
before deactivating the old revision. Failure before successful promotion
restores the previous routing and attempts to deactivate the candidate, with
explicit errors if recovery fails.

`npm run test:hosted-runtime` checks the compiled Node server and its real bundled
stdio runtime in isolated loopback mode, using placeholder GitHub App values.
It verifies health, the anonymous editor, compressed assets, rejection of
unauthenticated generation, OAuth initiation, and graceful shutdown. It does
not authorize a GitHub account, send a model request, or use Azure resources.

The API uses native Node streaming and does not pass through the Static Web Apps
45-second API proxy. `/healthz` checks the local Copilot runtime; `/readyz` also
checks access to the auth store. Neither requires a personal GitHub token or
consumes a model request.
