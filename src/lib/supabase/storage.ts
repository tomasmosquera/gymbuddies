import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { decode } from 'base64-arraybuffer';
import { supabase } from './client';

type Bucket = 'checkins' | 'receipts' | 'excuse-proofs' | 'koth-videos';

// Long enough to keep the check-in date/location overlay legible, small
// enough to upload/download quickly over a mobile connection.
const MAX_DIMENSION_PX = 1280;
const COMPRESS_QUALITY = 0.6;

/** "{group_id}/{user_id}/{file}" — matches the storage RLS policies (0010_storage.sql). */
export function checkinPhotoPath(groupId: string, userId: string, checkinDate: string): string {
  return `${groupId}/${userId}/${checkinDate}.jpg`;
}

export function checkoutPhotoPath(groupId: string, userId: string, checkinDate: string): string {
  return `${groupId}/${userId}/${checkinDate}-checkout.jpg`;
}

export function receiptPath(groupId: string, userId: string, transactionRef: string): string {
  return `${groupId}/${userId}/${transactionRef}.jpg`;
}

export function excuseProofPath(groupId: string, userId: string, requestRef: string): string {
  return `${groupId}/${userId}/${requestRef}.jpg`;
}

export function kothVideoPath(groupId: string, userId: string, exerciseSlug: string): string {
  return `${groupId}/${userId}/${exerciseSlug}-${Date.now()}.mp4`;
}

/** Photos live in private buckets — always read through a short-lived signed URL. */
export async function getSignedUrl(bucket: Bucket, path: string, expiresInSeconds = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error || !data) {
    throw new Error(error?.message ?? 'No se pudo generar el enlace de la foto');
  }
  return data.signedUrl;
}

export async function uploadImage(bucket: Bucket, path: string, fileUri: string): Promise<void> {
  // Resize + recompress before upload: source photos (camera or library) are
  // routinely several MB, far more than a private check-in/receipt photo needs.
  const resized = await ImageManipulator.manipulate(fileUri).resize({ width: MAX_DIMENSION_PX }).renderAsync();
  const { uri: resizedUri } = await resized.saveAsync({ compress: COMPRESS_QUALITY, format: SaveFormat.JPEG });

  // fetch(uri).arrayBuffer() silently truncates local file:// reads on some
  // RN/Hermes builds (observed uploads of ~1-3KB for real multi-hundred-KB
  // photos, with no thrown error) — reading as base64 via expo-file-system
  // and decoding is the reliable path for local files in React Native.
  const base64 = await FileSystem.readAsStringAsync(resizedUri, { encoding: 'base64' });
  const arrayBuffer = decode(base64);
  const { error } = await supabase.storage.from(bucket).upload(path, arrayBuffer, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (error) {
    throw new Error(error.message);
  }
}

// Same base64-read-via-expo-file-system → decode → upload path as
// uploadImage above (the only approach proven reliable for local file:// in
// this RN/Hermes setup — see that function's comment). Unproven at video
// scale (tens of MB vs KB for a photo) — if this turns out to be slow or
// memory-heavy on lower-end devices, revisit uploading straight from the
// file:// uri instead of round-tripping through a base64 string.
export async function uploadVideo(bucket: Bucket, path: string, fileUri: string, contentType = 'video/mp4'): Promise<void> {
  const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: 'base64' });
  const arrayBuffer = decode(base64);
  const { error } = await supabase.storage.from(bucket).upload(path, arrayBuffer, {
    contentType,
    upsert: true,
  });
  if (error) {
    throw new Error(error.message);
  }
}
