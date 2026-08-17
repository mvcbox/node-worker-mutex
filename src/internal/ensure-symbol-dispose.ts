import { WorkerMutexError } from '../errors/WorkerMutexError';
import { WorkerMutexErrorCodeEnum } from '../errors/WorkerMutexErrorCodeEnum';

try {
  const symbolConstructor = Symbol;
  const currentDescriptor = Object.getOwnPropertyDescriptor(symbolConstructor, 'dispose');
  let expectedDispose: symbol;

  if (!currentDescriptor) {
    if ('dispose' in symbolConstructor) {
      throw new WorkerMutexError(
        WorkerMutexErrorCodeEnum.SYMBOL_DISPOSE_IS_NOT_AVAILABLE
      );
    }

    const createSymbol = symbolConstructor as unknown as (
      description?: string
    ) => unknown;
    const createdDispose = createSymbol('Symbol.dispose');

    if (typeof createdDispose !== 'symbol') {
      throw new WorkerMutexError(
        WorkerMutexErrorCodeEnum.SYMBOL_DISPOSE_IS_NOT_AVAILABLE
      );
    }

    expectedDispose = createdDispose;
    Object.defineProperty(symbolConstructor, 'dispose', {
      value: expectedDispose,
      writable: false,
      enumerable: false,
      configurable: false
    });
  } else {
    if (!('value' in currentDescriptor) || typeof currentDescriptor.value !== 'symbol') {
      throw new WorkerMutexError(
        WorkerMutexErrorCodeEnum.SYMBOL_DISPOSE_IS_NOT_AVAILABLE
      );
    }

    expectedDispose = currentDescriptor.value;

    if (
      currentDescriptor.writable !== false ||
      currentDescriptor.enumerable !== false ||
      currentDescriptor.configurable !== false
    ) {
      Object.defineProperty(symbolConstructor, 'dispose', {
        value: currentDescriptor.value,
        writable: false,
        enumerable: false,
        configurable: false
      });
    }
  }

  const installedDescriptor = Object.getOwnPropertyDescriptor(symbolConstructor, 'dispose');

  if (
    !installedDescriptor ||
    !('value' in installedDescriptor) ||
    typeof installedDescriptor.value !== 'symbol' ||
    installedDescriptor.value !== expectedDispose ||
    installedDescriptor.writable !== false ||
    installedDescriptor.enumerable !== false ||
    installedDescriptor.configurable !== false
  ) {
    throw new WorkerMutexError(
      WorkerMutexErrorCodeEnum.SYMBOL_DISPOSE_IS_NOT_AVAILABLE
    );
  }
} catch (cause) {
  if (
    cause instanceof WorkerMutexError &&
    cause.code === WorkerMutexErrorCodeEnum.SYMBOL_DISPOSE_IS_NOT_AVAILABLE
  ) {
    throw cause;
  }

  throw new WorkerMutexError(
    WorkerMutexErrorCodeEnum.SYMBOL_DISPOSE_IS_NOT_AVAILABLE
  );
}
