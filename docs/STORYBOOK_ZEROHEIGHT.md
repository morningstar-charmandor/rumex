# Storybook and Zeroheight

Rumex uses Storybook as the executable catalogue for production UI components.
Zeroheight remains the editorial documentation layer.

## Local Storybook

```sh
npm run storybook
```

Build the static site with:

```sh
npm run build-storybook
```

The static output is written to `storybook-static/`.

## Credentials

Copy `.env.example` to `.env` and populate:

```dotenv
STORYBOOK_ZH_CLIENT_ID=...
STORYBOOK_ZH_ACCESS_TOKEN=...
```

The populated `.env` is ignored by Git. These credentials are for local
Storybook only. Do not provide them to a public Storybook deployment: the addon
uses them in browser-side API requests, where visitors could inspect them.

The official Zeroheight addon reads those variables and displays linked
Zeroheight documentation inside Storybook. The addon requires a Zeroheight plan
with API access. Add a page URL to a story through the shared helper:

```ts
parameters: {
  ...zeroheightParameters(zeroheightPages.button)
}
```

Keep non-secret page URLs in `.storybook/zeroheight.ts`, not in individual
component stories. Do not put API credentials in source code.

## Connect Storybook inside Zeroheight

Zeroheight's native Storybook integration needs a deployed HTTPS URL:

1. Publish `storybook-static/`.
2. Confirm `<deployment-url>/index.json` is publicly reachable by Zeroheight.
3. Do not send an `X-Frame-Options` header that blocks iframe embedding.
4. In Zeroheight, open **Styleguide settings → Storybook**.
5. Add the deployment URL once. Existing embedded stories will then follow
   compatible Storybook updates automatically.

Keep story IDs stable by avoiding unnecessary story-title and export-name
changes after Zeroheight pages start embedding them.

The public build must be created without
`STORYBOOK_ZH_CLIENT_ID` or `STORYBOOK_ZH_ACCESS_TOKEN`. Zeroheight can still
embed the published stories; only the reverse documentation tab remains a
local, authenticated feature.
