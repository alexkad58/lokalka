export const FEEDBACK_SOUND_STORAGE_KEY = 'lokalka_feedback_sound_enabled';

let feedbackAudioContext = null;

export function unlockFeedbackAudio() {
  if (typeof window === 'undefined' || localStorage.getItem(FEEDBACK_SOUND_STORAGE_KEY) === '0') return;

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!feedbackAudioContext) feedbackAudioContext = new AudioContextClass();
    if (feedbackAudioContext.state === 'suspended') void feedbackAudioContext.resume();
  } catch {
    // Audio feedback is optional.
  }
}

export function playFeedbackSound(kind = 'scan') {
  if (typeof window === 'undefined') return;

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    if (!feedbackAudioContext) feedbackAudioContext = new AudioContextClass();
    const context = feedbackAudioContext;
    const playTone = () => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const startTime = context.currentTime;

      const isScan = kind === 'scan';
      oscillator.type = isScan ? 'sine' : 'triangle';
      oscillator.frequency.setValueAtTime(isScan ? 1320 : 190, startTime);
      gain.gain.setValueAtTime(isScan ? 0.04 : 0.06, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + (isScan ? 0.06 : 0.035));
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startTime);
      oscillator.stop(startTime + (isScan ? 0.065 : 0.04));
    };

    if (context.state === 'suspended') {
      void context.resume().then(playTone);
    } else {
      playTone();
    }
  } catch {
    // Audio feedback is optional.
  }
}

export function triggerHaptic(duration = 50, soundKind = 'scan') {
  let vibrated = false;

  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      vibrated = navigator.vibrate(duration) === true;
    } catch {
      vibrated = false;
    }
  }

  if (localStorage.getItem(FEEDBACK_SOUND_STORAGE_KEY) !== '0') {
    playFeedbackSound(soundKind);
  }
  return vibrated;
}
