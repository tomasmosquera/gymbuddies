import { friendlyErrorMessage } from '@/lib/domain/errorMessages';

describe('friendlyErrorMessage', () => {
  it('replaces the raw iOS network-loss exception with a plain Spanish explanation', () => {
    const err = new Error('fetch failed: UnexpectedException: The network connection was lost. (at ExpoModulesCore/Promise.swift:56)');
    expect(friendlyErrorMessage(err)).toBe(
      'Se perdió la conexión a internet — puede pasar si sales de la app o se bloquea la pantalla justo mientras se guarda. Revisa tu conexión e intenta de nuevo.'
    );
  });

  it('catches the Android/RN-flavored "Network request failed" wording too', () => {
    expect(friendlyErrorMessage(new Error('Network request failed'))).toMatch(/Se perdió la conexión/);
  });

  it('catches "internet connection appears to be offline"', () => {
    expect(friendlyErrorMessage(new Error('The Internet connection appears to be offline.'))).toMatch(/Se perdió la conexión/);
  });

  it('passes through our own thrown Spanish RPC error messages unchanged', () => {
    expect(friendlyErrorMessage(new Error('este entreno no está en curso'))).toBe('este entreno no está en curso');
  });

  it('falls back for a non-Error thrown value', () => {
    expect(friendlyErrorMessage('algo raro')).toBe('algo raro');
  });

  it('uses the fallback when the error has no usable message', () => {
    expect(friendlyErrorMessage(new Error(''), 'Intenta de nuevo.')).toBe('Intenta de nuevo.');
  });
});
