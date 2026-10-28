// Loads the Google Maps JavaScript API once, when the first map is shown, with the key from /api/config
// (the API's GOOGLE_MAPS_BROWSER_KEY or GOOGLE_MAPS_KEY). Same loader as the website's.

let loading = null;

export function loadGoogleMaps(key) {
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const ready = '__bitevoMapsReady';
      window[ready] = () => { delete window[ready]; resolve(window.google.maps); };
      // Google calls this when the key is wrong or the Maps JavaScript API isn't enabled for it.
      window.gm_authFailure = () => window.dispatchEvent(new Event('bitevo:maps-auth-failed'));
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({ key, v: 'weekly', loading: 'async', callback: ready, region: 'IN', language: 'en' })}`;
      script.async = true;
      script.onerror = () => { loading = null; script.remove(); reject(new Error('The map couldn’t load.')); };
      document.head.appendChild(script);
    });
  }
  return loading;
}
