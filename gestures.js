// Gesture classification from a single hand's 21 MediaPipe landmarks,
// plus per-hand debouncing so a single misclassified frame doesn't
// flicker the effect on/off.

const DEBOUNCE_FRAMES = 4;
const HEART_DIST_RATIO = 0.35; // thumb-tip/index-tip distance, relative to hand size
const EXTEND_MARGIN = 0.02; // normalized-coordinate slack for "finger is up"

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// A finger reads as "up" when its tip is clearly above both its pip and
// mcp joints in image space (y grows downward), which holds regardless
// of overall hand tilt for the moderate angles a user gestures at.
function isFingerExtended(landmarks, tipIdx, pipIdx, mcpIdx) {
  const tip = landmarks[tipIdx];
  const pip = landmarks[pipIdx];
  const mcp = landmarks[mcpIdx];
  return tip.y < pip.y - EXTEND_MARGIN && pip.y < mcp.y - EXTEND_MARGIN * 0.5;
}

// Classifies a single hand's landmarks into one of: 'heart', 'peace',
// 'trail', or 'idle'. Returns the emission point(s) needed by the caller.
function classifyGesture(landmarks) {
  const wrist = landmarks[0];
  const middleMcp = landmarks[9];
  const handSize = dist(wrist, middleMcp) || 1;

  const indexUp = isFingerExtended(landmarks, 8, 6, 5);
  const middleUp = isFingerExtended(landmarks, 12, 10, 9);
  const ringUp = isFingerExtended(landmarks, 16, 14, 13);
  const pinkyUp = isFingerExtended(landmarks, 20, 18, 17);

  const thumbIndexRatio = dist(landmarks[4], landmarks[8]) / handSize;

  if (thumbIndexRatio < HEART_DIST_RATIO) {
    return { gesture: 'heart', point: midpoint(landmarks[4], landmarks[8]) };
  }

  if (indexUp && middleUp && !ringUp && !pinkyUp) {
    return { gesture: 'peace', points: [landmarks[8], landmarks[12]] };
  }

  if (indexUp && !middleUp && !ringUp && !pinkyUp) {
    return { gesture: 'trail', point: landmarks[8] };
  }

  return { gesture: 'idle' };
}

// Requires a gesture to persist for DEBOUNCE_FRAMES consecutive frames
// before it becomes the reported "stable" gesture (this includes
// transitions back to idle, so a dropped hand doesn't instantly kill
// an effect on a single bad frame either).
class GestureStabilizer {
  constructor(requiredFrames = DEBOUNCE_FRAMES) {
    this.required = requiredFrames;
    this.candidate = 'idle';
    this.count = 0;
    this.stable = 'idle';
  }

  update(rawGesture) {
    if (rawGesture === this.candidate) {
      this.count++;
    } else {
      this.candidate = rawGesture;
      this.count = 1;
    }
    if (this.count >= this.required) {
      this.stable = rawGesture;
    }
    return this.stable;
  }

  reset() {
    this.candidate = 'idle';
    this.count = 0;
    this.stable = 'idle';
  }
}
