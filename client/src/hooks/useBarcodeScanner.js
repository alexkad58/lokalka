import { useEffect, useRef, useState } from 'react';
import { supportsBarcodeDetector } from '../utils/barcode.js';
import { track } from '../analytics.js';
import { unlockFeedbackAudio } from '../utils/audio.js';

export function useBarcodeScanner({ activeRecount, tsdOpen, qrOpen, onScannedCode }) {
  const [scannerOn, setScannerOn] = useState(false);
  const [scannerStatus, setScannerStatus] = useState('Сканер выключен');
  const [lastCode, setLastCode] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [scannerZoom, setScannerZoom] = useState(null);
  const [scanSuccessFlash, setScanSuccessFlash] = useState(false);

  const videoRef = useRef(null);
  const scannerStreamRef = useRef(null);
  const scanCancelRef = useRef(null);
  const detectorRef = useRef(null);
  const zxingReaderRef = useRef(null);
  const zxingControlsRef = useRef(null);
  const flashTimeoutRef = useRef(0);
  const onScannedCodeRef = useRef(onScannedCode);
  const detectFailStreakRef = useRef(0);

  useEffect(() => {
    onScannedCodeRef.current = onScannedCode;
  }, [onScannedCode]);

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) {
        clearTimeout(flashTimeoutRef.current);
      }
      stopScanner();
    };
  }, []);

  function triggerScanSuccessFlash() {
    if (flashTimeoutRef.current) {
      clearTimeout(flashTimeoutRef.current);
    }
    setScanSuccessFlash(true);
    flashTimeoutRef.current = window.setTimeout(() => {
      setScanSuccessFlash(false);
      flashTimeoutRef.current = 0;
    }, 220);
  }

  async function createZxingReader() {
    const zxing = await import('@zxing/browser');
    if (qrOpen) {
      return new zxing.BrowserQRCodeReader(undefined, {
        delayBetweenScanAttempts: 0,
        delayBetweenScanSuccess: 0
      });
    }
    return new zxing.BrowserMultiFormatReader();
  }

  // Prefer requestVideoFrameCallback: it fires once per actual decoded camera frame
  // instead of on every display refresh, so we never re-scan a stale frame or fall
  // behind the camera while a previous detect() is still resolving.
  function scheduleScan(video) {
    if (typeof video.requestVideoFrameCallback === 'function') {
      const handle = video.requestVideoFrameCallback(scanBarcodeFrame);
      return () => video.cancelVideoFrameCallback(handle);
    }
    const handle = requestAnimationFrame(scanBarcodeFrame);
    return () => cancelAnimationFrame(handle);
  }

  async function scanBarcodeFrame() {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector) return;

    try {
      const codes = await detector.detect(video);
      detectFailStreakRef.current = 0;
      const code = codes[0]?.rawValue;
      if (code) {
        void onScannedCodeRef.current?.(code);
      }
    } catch {
      // Some Android devices report BarcodeDetector support but it never actually works
      // (Shape Detection service unavailable) - fall back to zxing after repeated failures.
      detectFailStreakRef.current += 1;
      if (detectFailStreakRef.current >= 15) {
        detectorRef.current = null;
        void switchToZxingFallback();
        return;
      }
    }

    scanCancelRef.current = scheduleScan(video);
  }

  async function switchToZxingFallback() {
    if (scanCancelRef.current) {
      scanCancelRef.current();
      scanCancelRef.current = null;
    }
    const video = videoRef.current;
    if (!video) return;

    try {
      const reader = await createZxingReader();
      zxingReaderRef.current = reader;
      const controls = await reader.decodeFromStream(scannerStreamRef.current, video, resultObj => {
        if (resultObj) {
          void onScannedCodeRef.current?.(resultObj.getText());
        }
      });
      zxingControlsRef.current = controls;
      setScannerStatus('Наведите на штрихкод');
    } catch {
      setScannerStatus('Не удалось запустить сканер');
      stopScanner();
    }
  }

  async function startScanner() {
    const video = videoRef.current;
    if (!video) return;
    if (!activeRecount?.items?.length && !tsdOpen && !qrOpen) {
      setScannerStatus('Сначала загрузите PDF');
      return;
    }

    video.setAttribute('playsinline', 'true');
    video.setAttribute('autoplay', 'true');
    video.setAttribute('muted', 'true');

    try {
      unlockFeedbackAudio();
      setScannerStatus('Запуск камеры...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          ...(qrOpen ? {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          } : {})
        },
        audio: false
      });

      scannerStreamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      const videoTrack = stream.getVideoTracks()[0];
      const zoomCapability = videoTrack?.getCapabilities?.().zoom;
      if (zoomCapability) {
        const currentZoom = videoTrack.getSettings?.().zoom ?? zoomCapability.min;
        setScannerZoom(currentZoom);
      } else {
        setScannerZoom(null);
      }
      if (qrOpen) void focusScannerCamera();
      track('scanner_started', { area: tsdOpen ? 'tsd' : qrOpen ? 'qr' : 'recount' });

      if (supportsBarcodeDetector()) {
        try {
          const wantedFormats = qrOpen ? ['qr_code'] : ['code_128', 'ean_13', 'ean_8', 'qr_code'];
          const supportedFormats = await window.BarcodeDetector.getSupportedFormats?.();
          const usableFormats = Array.isArray(supportedFormats)
            ? wantedFormats.filter(format => supportedFormats.includes(format))
            : wantedFormats;
          if (usableFormats.length) {
            detectorRef.current = new window.BarcodeDetector({ formats: usableFormats });
            detectFailStreakRef.current = 0;
            setScannerOn(true);
            setScannerStatus('Наведите на штрихкод');
            scanCancelRef.current = scheduleScan(video);
            return;
          }
        } catch {
          // Native detector reported support but failed to initialize - fall back to zxing below.
        }
      }

      const reader = await createZxingReader();
      zxingReaderRef.current = reader;
      const controls = await reader.decodeFromVideoDevice(undefined, video, resultObj => {
        if (resultObj) {
          void onScannedCodeRef.current?.(resultObj.getText());
        }
      });
      zxingControlsRef.current = controls;
      setScannerOn(true);
      setScannerStatus('Наведите на штрихкод');
    } catch {
      setScannerStatus('Не удалось запустить сканер');
      stopScanner();
    }
  }

  function stopScanner() {
    setScannerOn(false);
    setTorchOn(false);
    setScannerZoom(null);
    setScannerStatus('Сканер выключен');
    detectFailStreakRef.current = 0;

    if (scanCancelRef.current) {
      scanCancelRef.current();
      scanCancelRef.current = null;
    }

    zxingControlsRef.current?.stop?.();
    zxingControlsRef.current = null;
    zxingReaderRef.current?.reset?.();
    zxingReaderRef.current = null;
    detectorRef.current = null;

    const stream = scannerStreamRef.current;
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      scannerStreamRef.current = null;
    }

    const video = videoRef.current;
    if (video?.srcObject) {
      video.srcObject = null;
    }
  }

  async function toggleScanner() {
    if (scannerOn) {
      stopScanner();
      return;
    }
    await startScanner();
  }

  async function toggleTorch() {
    const stream = scannerStreamRef.current;
    if (!stream) {
      setScannerStatus('Сначала включите сканер');
      return;
    }

    const trackItem = stream.getVideoTracks()[0];
    if (!trackItem) return;

    try {
      const next = !torchOn;
      await trackItem.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      setScannerStatus('Фонарик не поддерживается');
    }
  }

  async function focusScannerCamera() {
    const stream = scannerStreamRef.current;
    const trackItem = stream?.getVideoTracks?.()[0];
    if (!trackItem?.applyConstraints) return;

    try {
      const capabilities = trackItem.getCapabilities?.();
      const focusModes = capabilities?.focusMode || [];
      const focusMode = focusModes.includes('continuous')
        ? 'continuous'
        : focusModes.includes('single-shot')
          ? 'single-shot'
          : null;
      if (focusMode) {
        await trackItem.applyConstraints({ advanced: [{ focusMode }] });
      }
    } catch {
      // Autofocus is optional and not supported by every camera.
    }
  }

  async function adjustScannerZoom(direction) {
    const trackItem = scannerStreamRef.current?.getVideoTracks?.()[0];
    const zoomCapability = trackItem?.getCapabilities?.().zoom;
    if (!trackItem?.applyConstraints || !zoomCapability || !direction) return;

    const min = Number(zoomCapability.min);
    const max = Number(zoomCapability.max);
    const deviceStep = Number(zoomCapability.step) || 0.1;
    const gestureStep = Math.max(deviceStep, 0.5);
    const current = Number(trackItem.getSettings?.().zoom ?? scannerZoom ?? min);
    const unclamped = current + Math.sign(direction) * gestureStep;
    const clamped = Math.min(max, Math.max(min, unclamped));
    const snapped = Math.min(max, Math.max(min,
      min + Math.round((clamped - min) / deviceStep) * deviceStep
    ));

    if (Math.abs(snapped - current) < deviceStep / 2) return;

    try {
      await trackItem.applyConstraints({ advanced: [{ zoom: snapped }] });
      setScannerZoom(trackItem.getSettings?.().zoom ?? snapped);
    } catch {
      setScannerStatus('Зум камеры не поддерживается');
    }
  }

  function handleScannerDoubleClick(event) {
    event.preventDefault();
    void toggleTorch();
  }

  return {
    scannerOn,
    scannerStatus,
    setScannerStatus,
    lastCode,
    setLastCode,
    torchOn,
    scanSuccessFlash,
    videoRef,
    triggerScanSuccessFlash,
    startScanner,
    stopScanner,
    toggleScanner,
    toggleTorch,
    focusScannerCamera,
    adjustScannerZoom,
    scannerZoom,
    handleScannerDoubleClick
  };
}
