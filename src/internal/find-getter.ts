export function findGetter(prototype: object, property: string): (() => unknown) | undefined {
  let current: object | null = prototype;

  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property);

    if (descriptor && typeof descriptor.get === 'function') {
      return descriptor.get;
    }

    current = Object.getPrototypeOf(current) as object | null;
  }

  return undefined;
}
