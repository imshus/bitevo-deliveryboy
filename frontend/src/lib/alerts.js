// Getting the rider's attention when an order arrives: a short chime, a vibration, and a system
// notification when the app isn't on screen.

let audio = null;

export function chime() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const now = audio.currentTime;
    [880, 1175, 1568].forEach((freq, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, now + i * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.3, now + i * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.3);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + i * 0.16);
      osc.stop(now + i * 0.16 + 0.32);
    });
  } catch {
    // No sound on this browser.
  }
}

// Browsers only play sound after the rider has tapped something; going online is that tap.
export function unlockSound() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch {
    // ignore
  }
}

export function askToNotify() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}

export function alertRider(title, body) {
  chime();
  navigator.vibrate?.([250, 120, 250]);
  if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: '/assets/icon-192.png', tag: 'bitevo-order' });
    } catch {
      // Android Chrome only shows notifications from a service worker; the chime and vibration still work.
    }
  }
}
