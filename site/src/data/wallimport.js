import { PACK_FILE_NAME, WallPackError, parseHoldsJson } from '../domain/wallpack.js';
import { findFile, readZip, ZipError } from '../domain/zip.js';

// Turns a wall pack (.zip with holds.json and the wall photo) into a saved wall.

// Phones run out of memory drawing very large pictures, so the photo is shrunk once, here, to at most this many pixels
// along its longer side. Hold positions are fractions of the picture, so shrinking never moves them.
export const MAX_PHOTO_SIDE = 2600;

async function decode(blob) {
  if (globalThis.createImageBitmap) {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* fall back to an <img> below */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

/** Returns { image (a JPEG Blob), width, height } with the picture shrunk to MAX_PHOTO_SIDE. */
export async function preparePhoto(blob, name = 'the photo') {
  let source;
  try {
    source = await decode(blob);
  } catch {
    throw new WallPackError(`"${name}" is not a picture this browser can read. Use a JPEG or PNG.`);
  }
  const sourceW = source.naturalWidth || source.width;
  const sourceH = source.naturalHeight || source.height;
  if (!sourceW || !sourceH) throw new WallPackError(`"${name}" is not a picture this browser can read. Use a JPEG or PNG.`);
  const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(sourceW, sourceH));
  const width = Math.max(1, Math.round(sourceW * scale));
  const height = Math.max(1, Math.round(sourceH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  source.close?.();
  const image = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  canvas.width = canvas.height = 0; // let the browser free the memory
  if (!image) throw new WallPackError('This browser could not prepare the wall photo.');
  return { image, width, height };
}

/** Reads a wall pack file and saves its wall. Throws WallPackError (or ZipError) with a readable message. */
export async function importWallPack(file, repo) {
  const files = await readZip(await file.arrayBuffer());
  const json = findFile(files, PACK_FILE_NAME);
  if (!json) throw new WallPackError('There is no holds.json in that file. A wall pack is a .zip holding holds.json and the wall photo.');
  const pack = parseHoldsJson(new TextDecoder().decode(json));
  const photoBytes = findFile(files, pack.imageName);
  if (!photoBytes) throw new WallPackError(`The photo "${pack.imageName}" named in holds.json is not in the zip.`);
  const photo = await preparePhoto(new Blob([photoBytes]), pack.imageName);
  const { wall, updated } = await repo.saveWall({
    key: pack.key,
    name: pack.name,
    image: photo.image,
    imageWidth: photo.width,
    imageHeight: photo.height,
    holds: pack.holds,
    angle: pack.angle,
  });
  return { wall, updated };
}

export { WallPackError, ZipError };
