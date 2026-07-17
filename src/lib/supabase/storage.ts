import { supabase } from './client';

/** "{group_id}/{user_id}/{file}" — matches the storage RLS policies (0010_storage.sql). */
export function checkinPhotoPath(groupId: string, userId: string, checkinDate: string): string {
  return `${groupId}/${userId}/${checkinDate}.jpg`;
}

export function receiptPath(groupId: string, userId: string, transactionRef: string): string {
  return `${groupId}/${userId}/${transactionRef}.jpg`;
}

/** Photos live in private buckets — always read through a short-lived signed URL. */
export async function getSignedUrl(
  bucket: 'checkins' | 'receipts',
  path: string,
  expiresInSeconds = 3600
): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error || !data) {
    throw new Error(error?.message ?? 'No se pudo generar el enlace de la foto');
  }
  return data.signedUrl;
}

export async function uploadImage(
  bucket: 'checkins' | 'receipts',
  path: string,
  fileUri: string
): Promise<void> {
  const response = await fetch(fileUri);
  const arrayBuffer = await response.arrayBuffer();
  const { error } = await supabase.storage.from(bucket).upload(path, arrayBuffer, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (error) {
    throw new Error(error.message);
  }
}
