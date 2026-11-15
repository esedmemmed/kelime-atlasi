# Deployment

`npm run build` produces a plain static site in `dist/`. It can be hosted on any static host (Nginx, Cloudflare Pages, Vercel, GitHub Pages).

## Subpath

```bash
ATLAS_BASE=/words/ npm run build
```

## Nginx example

```nginx
location ^~ /words/ {
    alias /var/www/kelime-atlasi/;
    try_files $uri $uri/ /words/index.html;
    expires 7d;
}
```

## GitHub Pages

The repository includes `.github/workflows/pages.yml`. It runs on every push to `main`, builds the site with `ATLAS_BASE=./` so that asset paths are relative, and publishes it.

- Live site: https://esedmemmed.github.io/kelime-atlasi/
- One-time setup: in Settings → Pages, set the source to "GitHub Actions".

## Local commands

```bash
npm ci               # install dependencies
npm run dev          # local development server
npm run build        # production build into dist/
npm test             # unit tests
npm run check:atlas  # dataset and media structure checks
```

## Size

Illustrations and audio together come to several hundred MB. Serve them behind a CDN, or publish only `thumb/` and a subset of the audio if storage or bandwidth is limited.
