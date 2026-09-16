// Wires together the camera feed, MediaPipe Hands, gesture classification,
// the particle system, and the status panel.

(function () {
  const videoEl = document.getElementById('webcam');
  const skeletonEl = document.getElementById('skeleton');
  const sctx = skeletonEl.getContext('2d');
  const canvasEl = document.getElementById('output');
  const ctx = canvasEl.getContext('2d');
  const loadingEl = document.getElementById('loading');

  const statusCamera = document.getElementById('status-camera');
  const statusGesture = document.getElementById('status-gesture');
  const statusParticles = document.getElementById('status-particles');
  const statusTracking = document.getElementById('status-tracking');
  const statusMode = document.getElementById('status-mode');

  const statusPanel = document.getElementById('status-panel');
  const captureBtn = document.getElementById('capture-btn');
  const countdownOverlay = document.getElementById('countdown-overlay');
  const countdownNumber = document.getElementById('countdown-number');
  const photoOverlay = document.getElementById('photo-overlay');
  const photoPreview = document.getElementById('photo-preview');
  const photoDownload = document.getElementById('photo-download');
  const photoClose = document.getElementById('photo-close');
  const photoHint = document.getElementById('photo-hint');

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

    for (const el of [videoEl, skeletonEl, canvasEl]) {
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    }
    skeletonEl.width = w;
    skeletonEl.height = h;
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
    sctx.clearRect(0, 0, skeletonEl.width, skeletonEl.height);

    const hands = results.multiHandLandmarks || [];
    statusTracking.textContent = hands.length > 0 ? 'hand detected' : 'waiting for hand';

    // Skeleton overlay so hand tracking is visible, drawn on its own canvas
    // (between the video and the particle canvas) so it's excluded from
    // captured photos while still being visible live.
    for (const landmarks of hands) {
      drawConnectors(sctx, landmarks, HAND_CONNECTIONS, {
        color: 'rgba(120, 220, 255, 0.65)',
        lineWidth: 2,
      });
      drawLandmarks(sctx, landmarks, {
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
      drawEmissionIndicator(sctx, pt.x, pt.y);
    }

    statusGesture.textContent = activeLabels.length ? activeLabels.join(', ') : GESTURE_LABELS.idle;
    statusMode.textContent = MODE_LABELS[displayMode];
    statusParticles.textContent = `${particleSystem.activeCount} / ${MAX_PARTICLES}`;
  }

  // Photo capture: a 3-2-1 countdown hides the status panel, then composites
  // the (manually mirrored) live video frame with the particle canvas only
  // (the hand-skeleton overlay lives on its own canvas and is intentionally
  // left out of the shot) and shows the result in a review overlay.
  let captureInFlight = false;

  function startCountdown() {
    if (captureInFlight) return;
    captureInFlight = true;
    captureBtn.disabled = true;
    statusPanel.classList.add('hidden');
    countdownOverlay.classList.remove('hidden');

    let n = 3;
    countdownNumber.textContent = n;
    const timer = setInterval(() => {
      n--;
      if (n > 0) {
        countdownNumber.textContent = n;
        countdownNumber.style.animation = 'none';
        void countdownNumber.offsetWidth; // reflow to restart the pulse animation
        countdownNumber.style.animation = '';
      } else {
        clearInterval(timer);
        countdownOverlay.classList.add('hidden');
        capturePhoto();
      }
    }, 1000);
  }

  function capturePhoto() {
    const w = canvasEl.width;
    const h = canvasEl.height;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const octx = out.getContext('2d');

    // Video is mirrored via CSS (scaleX(-1)), which drawImage ignores, so
    // mirror it manually here. The particle canvas is already correctly
    // oriented (MediaPipe selfieMode bakes the mirror into landmark
    // coordinates), so it's drawn as-is.
    octx.save();
    octx.translate(w, 0);
    octx.scale(-1, 1);
    octx.drawImage(videoEl, 0, 0, w, h);
    octx.restore();

    octx.drawImage(canvasEl, 0, 0);

    showPhotoReview(out.toDataURL('image/png'));
  }

  function showPhotoReview(dataUrl) {
    photoPreview.src = dataUrl;
    photoDownload.href = dataUrl;
    photoOverlay.classList.remove('hidden');

    // <a download> is unreliable on iOS Safari / in-app browsers, which
    // tend to just open the data URL instead of saving it. Long-pressing
    // the <img> triggers the native "Save Image" option there instead.
    const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    photoHint.classList.toggle('hidden', !isIOS);
  }

  function closePhotoReview() {
    photoOverlay.classList.add('hidden');
    photoPreview.src = '';
    photoDownload.href = '#';
    statusPanel.classList.remove('hidden');
    captureBtn.disabled = false;
    captureInFlight = false;
  }

  captureBtn.addEventListener('click', startCountdown);
  photoClose.addEventListener('click', closePhotoReview);

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
