# Optional local Scandia webfonts

This folder is intentionally empty except for this README.

Scandia is a licensed commercial font. Do not commit font files here unless your license allows web embedding and distribution within this project.

You now have two options:

## Option 1: Adobe Fonts kit URL

Set this in Netlify and in local `.env`:

```env
VITE_ADOBE_FONTS_URL=https://use.typekit.net/yourkitid.css
```

Then set the display font family if your Adobe kit uses a different CSS family name:

```env
VITE_SCANDIA_FONT_FAMILY="scandia-web", "Scandia", "IBM Plex Sans", Arial, sans-serif
```

After changing `VITE_` variables, rebuild/redeploy the frontend.

## Option 2: Self-hosted licensed files

Place licensed files here:

```text
Scandia-Regular.woff2
Scandia-Medium.woff2
Scandia-Bold.woff2
```

The CSS already includes matching `@font-face` declarations.
