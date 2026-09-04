import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { decode } from 'base64-arraybuffer';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/constants/config';
import { supabase } from './client';

type Bucket = 'checkins' | 'receipts' | 'excuse-proofs' | 'koth-videos';

// Long enough to keep the check-in date/location overlay legible, small
// enough to upload/download quickly over a mobile connection.
const MAX_DIMENSION_PX = 1280;

// Matches the koth-videos bucket's own file_size_limit (0084_koth_storage.sql)
// — checked client-side too so a huge library pick fails fast with a clear
// message instead of a multi-minute upload that ends in a vague timeout.
export const MAX_VIDEO_BYTES = 150 * 1024 * 1024;
const COMPRESS_QUALITY = 0.6;

/** "{group_id}/{user_id}/{file}" — matches the storage RLS policies (0010_storage.sql). */
export function checkinPhotoPath(groupId: string, userId: string, checkinDate: string): string {
  return `${groupId}/${userId}/${checkinDate}.jpg`;
}

export function checkoutPhotoPath(groupId: string, userId: string, checkinDate: string): string {
  return `${groupId}/${userId}/${checkinDate}-checkout.jpg`;
}

/**
 * A fresh, unique path for an admin replacing a check-in photo from Moderar
 * Fotos (admin_replace_checkin_photo) — deliberately never the same key as
 * checkinPhotoPath/checkoutPhotoPath, so CheckinPhotoColumn's on-disk cache
 * (keyed by photo_path) can't ever show the old photo after a replace.
 */
export function adminReplacedCheckinPhotoPath(
  groupId: string,
  userId: string,
  checkinDate: string,
  which: 'initial' | 'final'
): string {
  return `${groupId}/${userId}/${checkinDate}-${which}-admin-${Date.now()}.jpg`;
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

/**
 * Uploads straight from the file:// uri via expo-file-system's native
 * upload task, instead of uploadImage's read-as-base64 → decode →
 * supabase-js .upload() round trip — that path was fine at photo scale (a
 * few hundred KB) but at video scale (tens to 150MB) it means holding the
 * whole file in memory twice (base64 string + decoded ArrayBuffer) inside
 * JS, which is slow enough on real devices to blow past whatever timeout
 * the network stack enforces (observed: "network timeout" on library
 * picks, which skip the camera's 30s recording cap and can be much
 * larger). The native task streams the file directly instead, and reports
 * progress back via onProgress (bytes sent / bytes total) so the caller can
 * show a real progress bar instead of an indefinite spinner.
 * Manually replicates supabase-js's own POST-with-upsert request (see
 * storage-js's uploadOrUpdate) since storage-js itself only accepts an
 * in-memory body, not a file uri.
 *
 * sessionType is left at its BACKGROUND default (do not change this to
 * FOREGROUND again — that was tried and it broke uploads outright: FOREGROUND
 * sessions are killed by iOS the moment the app backgrounds, surfacing as
 * "NSURLErrorDomain Code=-1005 The network connection was lost" if the
 * person switches away mid-upload — completely normal phone behavior, not
 * an edge case). BACKGROUND still delivers onProgress normally while the
 * app is in the foreground (the "no callback until foregrounded again" case
 * only applies to the stretch while actually backgrounded, which just means
 * the bar stops animating instead of the upload dying) and additionally
 * survives the person locking their phone or switching apps mid-upload —
 * strictly better on both counts.
 */
export async function uploadVideo(
  bucket: Bucket,
  path: string,
  fileUri: string,
  contentType = 'video/mp4',
  onProgress?: (fraction: number) => void
): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('No hay una sesión activa');
  }
  // Some Android content providers report a mimeType with codec parameters
  // tacked on (e.g. "video/mp4; codecs=avc1.42C01E") — the bucket's
  // allowed_mime_types check wants an exact "video/mp4" or "video/quicktime",
  // so anything past the first ";" is stripped before it becomes the
  // Content-Type header.
  const cleanContentType = contentType.split(';')[0].trim();
  const task = FileSystem.createUploadTask(
    `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`,
    fileUri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': cleanContentType,
        'x-upsert': 'true',
        'cache-control': 'max-age=3600',
      },
    },
    onProgress
      ? ({ totalBytesSent, totalBytesExpectedToSend }) => {
          if (totalBytesExpectedToSend > 0) onProgress(totalBytesSent / totalBytesExpectedToSend);
        }
      : undefined
  );
  const result = await task.uploadAsync();
  if (!result || result.status < 200 || result.status >= 300) {
    throw new Error(`No se pudo subir el video (código ${result?.status ?? 'desconocido'}). ${describeUploadFailure(result?.body)}`);
  }
}

/**
 * Supabase Storage's error body is a raw JSON blob ({"statusCode":"413",
 * "error":"Payload too large","message":"The object exceeded the maximum
 * allowed size"} etc.) — fine for a log line, not something to put in front
 * of someone who just wants to know why their claim didn't go through. This
 * maps the couple of failure shapes already seen (size limit, mime type) to
 * a plain Spanish sentence. Anything NOT recognized still gets the parsed
 * message appended rather than fully hidden — an unrecognized failure is
 * exactly the case where losing that detail hurts most (it's the one that
 * still needs diagnosing), unlike the recognized ones where the friendly
 * sentence already says everything actionable.
 */
function describeUploadFailure(body: string | undefined): string {
  let message = '';
  if (body) {
    try {
      const parsed = JSON.parse(body) as { message?: string; error?: string };
      message = parsed.message ?? parsed.error ?? '';
    } catch {
      message = body;
    }
  }
  if (/exceeded the maximum allowed size|payload too large/i.test(message)) {
    return 'El archivo seleccionado excede el tamaño permitido.';
  }
  if (/mime type|not supported/i.test(message)) {
    return 'El formato de este video no es compatible — intenta con otro video.';
  }
  return `Intenta de nuevo en unos minutos.${message ? ` (${message})` : ''}`;
}
