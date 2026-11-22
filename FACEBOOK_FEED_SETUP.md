# PMBC Facebook posts — one-time connection

**Goal:** Show Facebook Page posts as actual text/image cards on the PMBC Home screen, above Upcoming Events. Church staff continue posting only to Facebook.

## How it works

- `app.js` loads `facebook-posts.js` on Home.
- The site requests `GET /facebook-posts` on the existing Cloudflare Worker.
- The Worker calls Meta's official Graph API `/{PAGE_ID}/posts` using a private Page Access Token, returning the latest public posts with their messages, dates, permalinks and permitted images.
- Successful results are cached for 15 minutes to reduce API requests.
- **Do not put the Facebook token in GitHub, GitHub Pages, Firebase public config, or the PMBC browser.**

## Required one-time Meta setup

1. Someone with full or appropriate content permissions for the church's Facebook Page must authorize access. This can be a church Page administrator; there is no need for the person who posts regularly to maintain PMBC.
2. Open the [Meta for Developers](https://developers.facebook.com/) site and create or use a Meta app with Facebook Login for Business / Pages access as appropriate to Meta's current interface.
3. Use [Graph API Explorer](https://developers.facebook.com/tools/explorer/) for a Page administrator to request `pages_show_list` and `pages_read_engagement` (additional permissions such as `pages_read_user_content` may be required for some Page feed content).
4. With an authorized **User Access Token**, query `/me/accounts?fields=id,name,access_token`. Identify the **Providence Missionary Baptist Church** Page ID and its **Page Access Token**. Page permission and token availability depend on Meta app mode, account role, and review requirements.
5. In Cloudflare → Workers & Pages → **pmbc-push-sender** → Settings → Variables and Secrets, add:
   - **Secret** `FACEBOOK_PAGE_ACCESS_TOKEN`: the full Page access token (keep private).
   - **Variable** `FACEBOOK_PAGE_ID`: the numeric Page ID.
6. Deploy the Cloudflare Worker, then open `https://nicaffus1.github.io/pmbc/?version=51#home`.

Never paste or send any Facebook access token in chat. If a token is accidentally exposed, revoke it in Meta and generate a replacement.

## Troubleshooting

- **Not connected yet**: one or both Cloudflare values are missing.
- **Connection may need attention**: Meta rejected the Page request or access was revoked/expired; check Worker logs, app permissions and token validity.
- **No recent posts**: Meta returned no eligible posts (e.g. no textual or permitted image posts).
- **Posts stale**: up to 15 minutes cache is intentional. A Page token may expire or lose permission later, requiring renewal.
- Automatic notifications of every Facebook post are not implemented. This sync is a **display** of recent posts only.

## Privacy

Only content available through the authorized Page API is displayed. The app should never publish a private Facebook group, direct messages, unpublished Page content, or users' private information.
