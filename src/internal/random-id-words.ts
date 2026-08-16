import { WorkerMutexError } from '../errors/WorkerMutexError';
import { ID_WORDS } from './mutex-constants';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

export function randomIdWords(): number[] {
  try {
    const crypto = require('crypto') as any;

    if (!crypto || typeof crypto.randomBytes !== 'function') {
      throw new WorkerMutexError(WorkerMutexErrorCodeEnum.CRYPTO_RANDOM_IS_NOT_AVAILABLE);
    }

    const randomBytes = crypto.randomBytes;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const bytes = randomBytes.call(crypto, 16) as ArrayLike<number>;

      if (!bytes || bytes.length !== 16) {
        throw new WorkerMutexError(WorkerMutexErrorCodeEnum.CRYPTO_RANDOM_IS_NOT_AVAILABLE);
      }

      const words: number[] = [];
      let nonzero = false;

      for (let index = 0; index < ID_WORDS; index += 1) {
        const offset = index * 4;
        const octets = [
          bytes[offset],
          bytes[offset + 1],
          bytes[offset + 2],
          bytes[offset + 3]
        ];

        for (let octetIndex = 0; octetIndex < octets.length; octetIndex += 1) {
          if (!Number.isInteger(octets[octetIndex]) || octets[octetIndex] < 0 || octets[octetIndex] > 255) {
            throw new WorkerMutexError(WorkerMutexErrorCodeEnum.CRYPTO_RANDOM_IS_NOT_AVAILABLE);
          }
        }

        const word =
          octets[0] |
          (octets[1] << 8) |
          (octets[2] << 16) |
          (octets[3] << 24);
        words.push(word);
        nonzero = nonzero || word !== 0;
      }

      if (nonzero) {
        return words;
      }
    }

    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.CRYPTO_RANDOM_IS_NOT_AVAILABLE);
  } catch (cause) {
    if (cause instanceof WorkerMutexError) {
      throw cause;
    }

    throw new WorkerMutexError(WorkerMutexErrorCodeEnum.CRYPTO_RANDOM_IS_NOT_AVAILABLE);
  }
}
