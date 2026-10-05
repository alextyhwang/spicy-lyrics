# Spicy Lyrics — Performance fork

An independent fork of [Spikerko/spicy-lyrics](https://github.com/Spikerko/spicy-lyrics), based on upstream 6.3.142 (`fcc5f836`). Original lyrics experience and author credit are retained. Alex Hwang's October 2026 changes add on-demand lyrics and suspend rendering while the app is inactive.

- Sidebar lyrics start collapsed. Open them with the existing sidebar control or Spicy Lyrics playbar button.
- The owned lyric frame loop and visual animations pause when its document is hidden or loses focus, and resume against current playback position when focused again. A visible Picture-in-Picture view also follows its own focus, so it pauses while another app has keyboard focus. Focus is not an exact occlusion detector.
- Offscreen lyrics pause when scrolling or ancestor clipping puts the actual view outside its document viewport. An owner-document IntersectionObserver detects changes without polling or per-frame layout reads. Scrolling back into view resumes rendering at current playback. This does not detect another app covering Spotify.
- The optional `spotify-background-performance.js` companion pauses other main-window CSS/WAAPI animations. CSS remains in control of CSS keyframes and transitions. Media, timers and Spotify's global RAF API are untouched.
- **Lyrics On Demand**, **Pause Background Rendering**, and **Pause Offscreen Rendering** experiments provide opt-outs; the companion has a profile-menu switch.
- Optional **Glass Lite** supplies minimal macOS-inspired static styling. No theme JavaScript, blur, refraction, remote fonts, animated backgrounds or extra rendering loops.

The companion excludes fork-owned lyric animations from JavaScript ownership. Generic non-lyric document transfers are reconciled at the next focus/visibility/settings or animation-creation event; no transfer poller is added. Ordinary instance `animation.pause()` is respected, but saved native/prototype calls cannot signal ownership.

Spotify remains a Chromium app. The theme approximates a glass appearance; it does not install Apple's native Liquid Glass renderer. Additional Spotify/lyrics timers, network requests and UI rendering can still consume resources. Lower CPU in background checks is not a guarantee of an exact battery-life improvement.

## Installation from the fork release

Download the assets from [performance-v1.2.0](https://github.com/alextyhwang/spicy-lyrics/releases/tag/performance-v1.2.0) into a fresh directory. Quit Spotify before applying changes. Verify the SHA-256 checksums, then copy the two JavaScript files into Spicetify's Extensions directory. Disable the original Marketplace **Spicy Lyrics** and **Beautiful Lyrics** entries first; avoid running multiple lyrics renderers simultaneously.

```sh
shasum -a 256 -c SHA256SUMS
mkdir -p ~/.config/spicetify/Extensions
cp spicy-lyrics-performance.js spotify-background-performance.js ~/.config/spicetify/Extensions/
spicetify config extensions spicy-lyrics-performance.js
spicetify config extensions spotify-background-performance.js
spicetify apply
```

Reopen Spotify after applying the changes.

For the optional theme, extract `GlassLite.zip` into `~/.config/spicetify/Themes/` and follow [its instructions](performance/GlassLite/README.md). The theme adds no JavaScript; the animation companion is independent of its appearance.

## Music-only Spotify setup

See [MUSIC-ONLY.md](performance/MUSIC-ONLY.md) for disabling Canvas and automatic Now Playing panel opening in Spotify’s native settings. Those preferences belong to Spotify and persist independently of this extension; the fork does not repeatedly force them. You can still open the panel manually or use the existing Spicy Lyrics playbar button for the full lyric page.

## Build and verify

Install Bun, use the checked-in lockfile with `bun install --frozen-lockfile`, then:

```sh
bun test performance
SPICETIFY_SKIP=true bun run build --no-copy
cp dist/spicy-lyrics.js builds/spicy-lyrics-performance.js
node performance/verify-release.mjs
```

The `--no-copy` flag and environment variable keep release builds from modifying a local Spotify installation. The fork's Marketplace manifest points directly at this standalone generated bundle; it does not use upstream executable loaders.

This fork uses **manual reviewed releases**. The upstream updater cannot rebuild or replace this standalone variant. Check the Settings footer's **Fork releases** link; merge/rebase upstream deliberately, rerun tests, rebuild, inspect the release bundle and publish a new immutable tag. Spicetify 2.45.3 fixes the older nested-component polling problem, so no private helper patch is required.

To remove, unregister both extension filenames with a trailing `-`, select your previous theme, reapply Spicetify, and optionally re-enable your original Marketplace lyrics extension. Preserve your own selected-settings/config backup before installation; no personal configuration, credentials, screenshots or measurement data are distributed in this repository.

## License

Spicy Lyrics and the modified standalone bundle remain **AGPL-3.0**; see [LICENSE](LICENSE). Full corresponding source is available at the release tag. The independently written animation companion and Glass Lite theme are **MIT** licensed under [performance/LICENSE-MIT](performance/LICENSE-MIT). Original project and dependency attribution is retained.
