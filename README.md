# Hand Gesture Particles

A browser-based particle effects playground controlled by hand gestures, using your webcam.
Vanilla HTML/CSS/JS, no build step — hand tracking runs via [MediaPipe Hands](https://developers.google.com/mediapipe) loaded from a CDN, rendering happens on an HTML5 canvas layered over the live camera feed.

Both hands are tracked and processed independently, so you can run two different gestures at once. The detected hand skeleton (joints + connections) is drawn live on screen so you can see what the tracker sees.

## Gestures

| Gesture | Effect |
|---|---|
| ☝️ Index finger up (others curled) | Purple-blue comet trail follows your fingertip, continuously while held |
| ✌️ Peace sign (index + middle up) | Fire-toned sparkle fountain from both fingertips, continuously while held |
| 🫰 Finger heart (thumb + index tips close together) | Red-pink heart particles stream from the midpoint between your fingertips, continuously while held |

A gesture must be held steady for a few consecutive frames before it takes effect, to avoid flicker from single-frame misreads. Particle count is capped globally across both hands and all effects, using an object pool so nothing is allocated mid-animation.

## Running locally

Camera access requires a secure context, so opening `index.html` directly via `file://` won't work in most browsers — serve it over `http://localhost` instead:

```bash
# from the project directory
python3 -m http.server 8000
# then open http://localhost:8000
```

Any other static file server works too (e.g. `npx serve`).

## Deploying

This is a static site — push to GitHub and enable GitHub Pages on the repo (Settings → Pages → deploy from branch). The included `.nojekyll` file stops GitHub Pages from running its default Jekyll build, so files are served as-is.

## Notes

- Desktop only — this does not attempt to support mobile browsers.
- No canvas/image export, no backend, no accounts.
