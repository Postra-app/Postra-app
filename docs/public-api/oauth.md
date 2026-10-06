# Sign in with Postra (OAuth 2.0)

Build a product that posts on behalf of other Postra users. Each user approves
your app once; you get an access token starting with `pos_` that works
wherever an API key does: the [Public API](README.md), the
[`@postra/node`](https://www.npmjs.com/package/@postra/node) SDK and MCP.

Postra implements the OAuth 2.0 authorization code grant:

| | |
|---|---|
| Authorization page | `https://app.postra.pl/oauth/authorize` |
| Token endpoint | `https://app.postra.pl/api/oauth/token` |
| Grant type | `authorization_code` only |
| Client authentication | `client_id` and `client_secret` in the request body |
| PKCE | Optional, `S256` only |

## 1. Register your app

In Postra, open **Settings → Developers → Apps** (owners and admins on paid
plans) and choose **Create OAuth App**:

| Field | |
|---|---|
| App Name | Required, up to 100 characters. Shown to users on the consent screen. |
| Description | Optional, up to 500 characters. Also shown on the consent screen. |
| Picture | Optional, from your media library. |
| Redirect URL | Required. Postra sends the user back here after they decide. |

You get a **Client ID** (`pca_…`) and a **Client Secret** (`pcs_…`). The
secret is shown only once, after creation or rotation; keep it on your
server. Each organisation can have one OAuth app.

## 2. Send the user to the authorization page

```
https://app.postra.pl/oauth/authorize?client_id=pca_YOUR_CLIENT_ID&response_type=code&state=RANDOM_STATE
```

| Parameter | Required | |
|---|---|---|
| `client_id` | yes | Your Client ID |
| `response_type` | yes | Must be `code` |
| `state` | recommended | Any value; it comes back unchanged so you can match the response to the request |
| `code_challenge` | optional | PKCE: `BASE64URL(SHA256(code_verifier))`, 43 characters |
| `code_challenge_method` | with `code_challenge` | Must be `S256`; `plain` is not supported |

With PKCE, a stolen code is useless without the `code_verifier` that only
your app holds. A code requested with a `code_challenge` can only be
exchanged with the matching `code_verifier` (step 4).

The user must be signed in to Postra in that browser. The consent screen
shows your app's name, description and picture and what it will be able to
do: access the user's channels, create and schedule posts, and read post
analytics.

Approving requires an owner or admin of the organisation currently selected
in Postra; the token you receive acts for that organisation.

## 3. Handle the redirect

Postra always redirects to the **Redirect URL** registered for your app; a
`redirect_uri` parameter is not used.

If the user approves:

```
https://your-app.example/callback?code=AUTHORIZATION_CODE&state=RANDOM_STATE
```

If the user denies:

```
https://your-app.example/callback?error=access_denied&state=RANDOM_STATE
```

Check that `state` matches the value you sent. The code is valid for
10 minutes and can be exchanged once.

## 4. Exchange the code for a token

Call the token endpoint from your server. JSON and
`application/x-www-form-urlencoded` bodies are both accepted.

```bash
curl https://app.postra.pl/api/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "authorization_code",
    "code": "AUTHORIZATION_CODE",
    "client_id": "pca_YOUR_CLIENT_ID",
    "client_secret": "pcs_YOUR_CLIENT_SECRET"
  }'
```

If you sent a `code_challenge` in step 2, add `"code_verifier"` (the
43–128 character string you hashed). Send it only then: a `code_verifier`
for a code requested without a challenge is refused.

Response (`201`):

```json
{
  "id": "ORGANISATION_ID",
  "access_token": "pos_…",
  "token_type": "bearer"
}
```

`id` is the Postra organisation the token acts for.

## 5. Call the API

Send the token in the `Authorization` header as it is, without a `Bearer`
prefix:

```bash
curl https://app.postra.pl/api/public/v1/integrations \
  -H "Authorization: pos_ACCESS_TOKEN"
```

Every endpoint in the [Public API reference](README.md) is available, with
the same limits. For MCP (`https://app.postra.pl/api/mcp`), send the same
token as `Authorization: Bearer pos_ACCESS_TOKEN`.

## Permissions

There are no scopes. A token has the same access as the organisation's API
key, that of an organisation admin.

## Token lifetime and revocation

Access tokens have no fixed expiry and there is no refresh token. A token
works until one of these happens:

- The user removes your app in **Settings → Approved Apps**.
- The same user approves your app again for the same organisation: the new
  authorization replaces the old token.
- The user who approved it leaves the organisation, stops being an owner or
  admin, or is suspended.
- You delete your OAuth app: every token it issued stops working.

When a token stops working, the API answers `401 {"msg": "Invalid OAuth
token"}`; send the user through the flow again. While the organisation has no
active subscription, calls answer `401 {"msg": "No subscription found"}` and
work again once it has one.

## Managing your app

On **Settings → Developers → Apps** you can edit the name, description,
picture and Redirect URL, and:

- **Rotate Secret** issues a new client secret; the old one stops working for
  code exchanges at once. Tokens already issued keep working.
- **Delete App** deletes the app and revokes every token it issued. This
  cannot be undone.

## Errors

From the token endpoint:

| Status | Body | Meaning |
|---|---|---|
| `400` | `{"error": "unsupported_grant_type"}` | `grant_type` is not `authorization_code` |
| `400` | `{"error": "invalid_grant"}` | The code is unknown, already used, or belongs to another app |
| `400` | `{"error": "invalid_grant", "error_description": "Code has expired"}` | More than 10 minutes since approval |
| `400` | `{"error": "invalid_grant", "error_description": "code_verifier does not match the code_challenge"}` | PKCE: missing or wrong `code_verifier`, or one sent for a code requested without a challenge. The code is not used up |
| `400` | `{"message": [ … ], "error": "Bad Request"}` | A required field is missing |
| `401` | `{"error": "invalid_client"}` | Unknown `client_id` or wrong `client_secret` |
| `429` | | More than 30 requests in 5 minutes from one address |

On the authorization page, an unknown `client_id`, a `response_type` other
than `code`, or a `code_challenge` without `code_challenge_method=S256`
shows an error to the user and does not redirect.

For errors from the API itself, see [Errors](README.md#errors).
