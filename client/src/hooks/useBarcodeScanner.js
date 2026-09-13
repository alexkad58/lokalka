import { useEffect, useRef, useState } from 'react';
import { supportsBarcodeDetector } from '../utils/barcode.js';
import { track } from '../analytics.js';
import { unlockFeedbackAudio } from '../utils/audio.js';

export function useBarcodeScanner({ activeRecount, tsdOpen, onScannedCode }) {
  const [scannerOn, setScannerOn] = useState(false);
  const [scannerStatus, setScannerStatus] = useState('Сканер выключен');
  const [lastCode, setLastCode] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [scanSuccessFlash, setScanSuccessFlash] = useState(false);

  const videoRef = useRef(null);
  const scannerStreamRef = useRef(null);
  const scanRafRef = useRef(0);
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

    scanRafRef.current = requestAnimationFrame(scanBarcodeFrame);
  }

  async function switchToZxingFallback() {
    if (scanRafRef.current) {
      cancelAnimationFrame(scanRafRef.current);
      scanRafRef.current = 0;
    }
    const video = videoRef.current;
    if (!video) return;

    try {
      const zxing = await import('@zxing/browser');
      const reader = new zxing.BrowserMultiFormatReader();
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
    if (!activeRecount?.items?.length && !tsdOpen) {
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
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });

      scannerStreamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      track('scanner_started', { area: tsdOpen ? 'tsd' : 'recount' });

      if (supportsBarcodeDetector()) {
        try {
          const wantedFormats = ['code_128', 'ean_13', 'ean_8', 'qr_code'];
          const supportedFormats = await window.BarcodeDetector.getSupportedFormats?.();
          const usableFormats = Array.isArray(supportedFormats)
            ? wantedFormats.filter(format => supportedFormats.includes(format))
            : wantedFormats;
          if (usableFormats.length) {
            detectorRef.current = new window.BarcodeDetector({ formats: usableFormats });
            detectFailStreakRef.current = 0;
            setScannerOn(true);
            setScannerStatus('Наведите на штрихкод');
            scanRafRef.current = requestAnimationFrame(scanBarcodeFrame);
            return;
          }
        } catch {
          // Native detector reported support but failed to initialize - fall back to zxing below.
        }
      }

      const zxing = await import('@zxing/browser');
      const reader = new zxing.BrowserMultiFormatReader();
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
    setScannerStatus('Сканер выключен');
    detectFailStreakRef.current = 0;

    if (scanRafRef.current) {
      cancelAnimationFrame(scanRafRef.current);
      scanRafRef.current = 0;
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
    handleScannerDoubleClick
  };
}
