# Glass Lite

A minimal, static macOS-inspired Spotify theme. Slate surfaces, system fonts, fine highlights and a rounded player bar suggest glass without adding blur, refraction, theme JavaScript, timers, remote fonts or decorative animation. Spotify still uses its Chromium interface; this does not replace it with native AppKit or Apple's Liquid Glass renderer.

Place this directory at `~/.config/spicetify/Themes/GlassLite`, then run:

```sh
spicetify config current_theme GlassLite color_scheme Slate inject_css 1 replace_colors 1 inject_theme_js 0
spicetify apply
```

The player bar keeps one lyric entry point: the Spicy Lyrics magic-wand button. When that button is installed, the theme hides Spotify’s native lyrics button; it also hides Spicy Popup Lyrics to leave room for volume. The performance fork allows the theme’s CSS to override the optional popup button’s display. Removing the theme restores those controls according to their existing settings.

The Now Playing sidebar shows artwork, track details and on-demand lyrics. Extra recommendation/merch/artist sections in that sidebar are hidden by CSS; music browsing, search, queue, volume, device selection and resizable sidebars remain available. Removing the theme restores those sidebar sections. This visual hiding does not unload Spotify's underlying React components or claim to prevent network work.

Tested on macOS with Spotify 1.2.71.421 and Spicetify 2.45.3. Selectors may need adjustment after Spotify changes its UI. Static CSS avoids additional recurring code; measured performance must still be checked for each client/platform. This is a dark Slate palette; a light palette is not included in this release.

Independently written theme, MIT licensed; see ../LICENSE-MIT.
