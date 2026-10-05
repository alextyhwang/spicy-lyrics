# Music-only setup

The performance fork pauses its owned lyric rendering while inactive or offscreen and keeps lyrics on demand. Its default experiment switches can be changed in Spicy Lyrics Settings → Experiments. Turning off **Pause Offscreen Rendering** restores viewport-independent lyric rendering while retaining the separate background/focus policy. Turning off **Pause Background Rendering** restores the original continuous rendering policy, including disabling the offscreen gate.

For the rest of the music-only setup, use Spotify’s own settings. These account/client preferences persist independently of the extension; installing a fork does not secretly force video or panel preferences on other users.

On Spotify desktop 1.2.71:

1. Open profile menu → Settings → Display.
2. Turn off **Display short, looping visuals on tracks (Canvas)**.
3. Turn off **Show the now-playing panel on click of play**.
4. Close the current Now Playing panel if you want an uncluttered browsing view. The panel remains available manually, and the Spicy Lyrics magic-wand button can still open the full lyrics page when wanted.

Newer clients can group music videos, other videos, and Canvas under **Videos and Canvas** or **Content and display**. Spotify notes that account video controls can affect all devices: [official video settings](https://support.spotify.com/us/article/video-settings/).

The changes disable looping artwork videos and automatic sidebar opening. They do not lower audio quality, alter the equalizer/normalization, delete cached audio/downloads, or change macOS Low Power Mode/ProMotion. Rendering savings depend on the song, client and window state; no fixed wattage saving is promised.

To undo: enable those native Spotify toggles again; disable the relevant fork experiments or remove the extension as described in PERFORMANCE.md. Offscreen detection catches viewport/ancestor clipping, not physical occlusion by other applications. PiP uses its own document; unavailable IntersectionObserver support falls back to the existing focus/visibility behavior.
