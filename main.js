// Wires together the camera feed, MediaPipe Hands, gesture classification,
// the particle system, and the status panel.

(function () {
  const videoEl = document.getElementById('webcam');
  const canvasEl = document.getElementById('output');
  const ctx = canvasEl.getContext('2d');
  const loadingEl = document.getElementById('loading');

  const statusCamera = document.getElementById('status-camera');
  const statusGesture = document.getElementById('status-gesture');
  const statusParticles = document.getElementById('status-particles');
  const statusTracking = document.getElementById('status-tracking');
  const statusMode = document.getElementById('status-mode');

  const particleSystem = new ParticleSystem(MAX_PARTICLES);

  // One stabilizer + "previous stable gesture" slot per tracked hand
  // (MediaPipe reports up to maxNumHands hands per frame, in a stable-ish
  // order, so indexing by slot is good enough for debounce purposes).
  const NUM_HAND_SLOTS = 2;
  const stabilizers = Array.from({ length: NUM_HAND_SLOTS }, () => new GestureStabilizer());

  const GESTURE_LABELS = {
    idle: 'No gesture detected',
    trail: 'Index finger up',
    peace: 'Peace sign',
    heart: 'Finger heart',
  };

  const MODE_LABELS = {
    idle: 'idle',
    trail: 'drawing',
    peace: 'peace',
    heart: 'heart',
  };

  const TRACKING_COLOR = '120, 220, 255'; // matches the skeleton overlay color

  let loadingHidden = false;
  let frameTick = 0;

  // Pulsing ring + crosshair marking exactly where particles are currently
  // spawning from, in the same color as the hand-tracking overlay so it
  // reads as "this is what the tracker is driving" rather than a random UI dot.
  function drawEmissionIndicator(ctx, x, y) {
    const pulse = 0.5 + 0.5 * Math.sin(frameTick * 0.15);
    const radius = 14 + pulse * 5;
    const armLen = 9;
    const gap = 5;

    ctx.save();
    ctx.strokeStyle = `rgba(${TRACKING_COLOR}, ${0.85})`;
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x - gap - armLen, y);
    ctx.lineTo(x - gap, y);
    ctx.moveTo(x + gap, y);
    ctx.lineTo(x + gap + armLen, y);
    ctx.moveTo(x, y - gap - armLen);
    ctx.lineTo(x, y - gap);
    ctx.moveTo(x, y + gap);
    ctx.lineTo(x, y + gap + armLen);
    ctx.stroke();

    ctx.fillStyle = `rgba(${TRACKING_COLOR}, 0.9)`;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // Fits the video/canvas box to the window while preserving the camera's
  // native aspect ratio (letterboxed), so normalized landmark coordinates
  // map 1:1 onto what's actually drawn on screen.
  function applyLayout() {
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    if (!vw || !vh) return;

    const scale = Math.min(window.innerWidth / vw, window.innerHeight / vh);
    const w = vw * scale;
    const h = vh * scale;
    const left = (window.innerWidth - w) / 2;
    const top = (window.innerHeight - h) / 2;

    for (const el of [videoEl, canvasEl]) {
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    }
    canvasEl.width = w;
    canvasEl.height = h;
  }

  window.addEventListener('resize', applyLayout);
  videoEl.addEventListener('loadedmetadata', applyLayout);

  function hideLoading() {
    if (loadingHidden) return;
    loadingHidden = true;
    loadingEl.style.display = 'none';
  }

  function showLoadingError(message) {
    loadingEl.innerHTML = `<p>${message}</p>`;
  }

  function onResults(results) {
    hideLoading();
    applyLayout();

    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    const hands = results.multiHandLandmarks || [];
    statusTracking.textContent = hands.length > 0 ? 'hand detected' : 'waiting for hand';

    // Skeleton overlay so hand tracking is visible, drawn before particles
    // so the effects render on top of it rather than being obscured.
    for (const landmarks of hands) {
      drawConnectors(ctx, landmarks, HAND_CONNECTIONS, {
        color: 'rgba(120, 220, 255, 0.65)',
        lineWidth: 2,
      });
      drawLandmarks(ctx, landmarks, {
        color: 'rgba(255, 255, 255, 0.9)',
        fillColor: 'rgba(120, 220, 255, 0.9)',
        lineWidth: 1,
        radius: 3,
      });
    }

    const activeLabels = [];
    const emissionPoints = [];
    let displayMode = 'idle';

    for (let slot = 0; slot < NUM_HAND_SLOTS; slot++) {
      const landmarks = hands[slot];
      const raw = landmarks ? classifyGesture(landmarks) : { gesture: 'idle' };
      const stable = stabilizers[slot].update(raw.gesture);

      if (stable !== 'idle') {
        activeLabels.push(GESTURE_LABELS[stable]);
        if (displayMode === 'idle') displayMode = stable;
      }

      // Only emit using the current-frame point when the raw classification
      // still agrees with the stable gesture (avoids emitting from a stale
      // point on frames where the hand briefly disagrees but hasn't
      // flipped the debounced state yet).
      if (stable !== 'idle' && raw.gesture === stable) {
        const [cw, ch] = [canvasEl.width, canvasEl.height];
        if (stable === 'trail') {
          const x = raw.point.x * cw;
          const y = raw.point.y * ch;
          particleSystem.emitTrail(x, y);
          emissionPoints.push({ x, y });
        } else if (stable === 'heart') {
          const x = raw.point.x * cw;
          const y = raw.point.y * ch;
          particleSystem.emitHeart(x, y);
          emissionPoints.push({ x, y });
        } else if (stable === 'peace') {
          // Continuous sparkly fountain from both fingertips while held.
          for (const pt of raw.points) {
            const x = pt.x * cw;
            const y = pt.y * ch;
            particleSystem.emitBurst(x, y);
            emissionPoints.push({ x, y });
          }
        }
      }
    }

    particleSystem.update();
    particleSystem.draw(ctx);

    frameTick++;
    for (const pt of emissionPoints) {
      drawEmissionIndicator(ctx, pt.x, pt.y);
    }

    statusGesture.textContent = activeLabels.length ? activeLabels.join(', ') : GESTURE_LABELS.idle;
    statusMode.textContent = MODE_LABELS[displayMode];
    statusParticles.textContent = `${particleSystem.activeCount} / ${MAX_PARTICLES}`;
  }

  const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  hands.setOptions({
    maxNumHands: NUM_HAND_SLOTS,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.6,
    selfieMode: true,
  });

  hands.onResults(onResults);

  const camera = new Camera(videoEl, {
    onFrame: async () => {
      await hands.send({ image: videoEl });
    },
    width: 1280,
    height: 720,
  });

  camera
    .start()
    .then(() => {
      statusCamera.textContent = 'active';
      statusCamera.classList.add('active');
      statusCamera.classList.remove('inactive');
    })
    .catch((err) => {
      console.error('Camera start failed:', err);
      statusCamera.textContent = 'inactive';
      showLoadingError('Camera access failed. Please allow camera permission and reload.');
    });
})();
