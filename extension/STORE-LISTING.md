# Store listing

## Name

collager.fm - Last.fm companion

## Short description

Manage Last.fm scrobbles, loved tracks, and obsessions directly from collager.fm.

## Detailed description

The collager.fm companion connects the collager.fm interface to the Last.fm
session already open in your browser. It can help you love tracks, manage
obsessions, replace recent scrobble metadata, and delete scrobbles while keeping
a local visual history of completed operations and optional automatic rules.

The extension works only on collager.fm, local collager.fm development pages,
and Last.fm. Its history, rules, language, panel position, and cached covers are
stored locally in the browser.

## Permission justifications

- `storage`: stores language, panel position, history, cached covers, and
  automatic rules locally.
- `tabs`: locates or opens a Last.fm tab when the user explicitly requests an
  operation.
- `scripting`: supports controlled communication with the declared collager.fm
  and Last.fm pages.
- `https://www.last.fm/*`: required to perform the Last.fm operation requested
  by the user through their existing web session.

## Reviewer notes

1. Open `https://collagerfm.vercel.app/` and install the extension.
2. Sign in to a Last.fm account in the same browser.
3. Generate a Recent, Loved, or Obsessions collage.
4. Open a tile to see the actions provided by the extension.

The extension contains no remote executable code. JavaScript is provided as
readable, unminified source. It does not receive or store the user's Last.fm
password or cookies. Privacy policy: `https://collagerfm.vercel.app/privacy.html`
