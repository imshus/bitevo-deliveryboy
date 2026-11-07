// Proof of delivery, taken at the door: camera photos of the handover, shrunk here before they're sent.

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
