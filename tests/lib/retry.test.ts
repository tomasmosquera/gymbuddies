import { retryOnTransientNetworkError } from '@/lib/retry';

const networkError = () => new Error('fetch failed: UnexpectedException: The network connection was lost.');
const realError = () => new Error('el peso no puede ser negativo');

describe('retryOnTransientNetworkError', () => {
  it('returns the result on the first try when nothing fails', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(retryOnTransientNetworkError(fn, 3, 0)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on a transient network error and succeeds once the connection is back', async () => {
    const fn = jest.fn().mockRejectedValueOnce(networkError()).mockResolvedValueOnce('recovered');
    await expect(retryOnTransientNetworkError(fn, 3, 0)).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up and throws once maxAttempts is exhausted', async () => {
    const fn = jest.fn().mockRejectedValue(networkError());
    await expect(retryOnTransientNetworkError(fn, 3, 0)).rejects.toThrow('network connection was lost');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('never retries a real (non-network) error — fails immediately on the first attempt', async () => {
    const fn = jest.fn().mockRejectedValue(realError());
    await expect(retryOnTransientNetworkError(fn, 3, 0)).rejects.toThrow('el peso no puede ser negativo');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
