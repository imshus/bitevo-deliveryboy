// Proof of delivery, taken at the door: camera photos of the handover (shrunk here before they're sent) and the
// barcode on the order's label. In the Android app Google's barcode scanner reads it
// (window.BiteVoRider.scanBarcode(), answered by a `bitevo-rider` event { barcode }, { barcodeError } or
// { barcodeCancelled }); in a browser, the BarcodeDetector reads it from a photo, where the browser has one.

const app = typeof window !== 'undefined' ? window.BiteVoRider : undefined;
export const scansInApp = Boolean(app?.scanBarcode);
export const scansFromPhoto = typeof window !== 'undefined' && 'BarcodeDetector' in window;

// A camera photo as a JPEG at most `max` px on its longer side (a few hundred KB instead of several MB).
export async function shrinkPhoto(file, max = 1600, quality = 0.82) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', quality));
}

// The barcode's text, or null when the rider closed the scanner.
export function scanInApp() {
  return new Promise((resolve, reject) => {
    const answer = e => {
      const { barcode, barcodeError, barcodeCancelled } = e.detail || {};
      if (barcode == null && barcodeError == null && !barcodeCancelled) return;
      window.removeEventListener('bitevo-rider', answer);
      if (barcodeError != null) reject(new Error(barcodeError));
      else resolve(barcodeCancelled ? null : barcode);
    };
    window.addEventListener('bitevo-rider', answer);
    app.scanBarcode();
  });
}

export async function scanPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const found = await new window.BarcodeDetector().detect(bitmap);
  bitmap.close?.();
  if (!found.length) throw new Error('No barcode found in that photo. Try again, closer and in good light.');
  return found[0].rawValue;
}
