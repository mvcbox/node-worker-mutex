'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-mutex-package-'));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const childEnvironment = {
  ...process.env,
  npm_config_cache: path.join(temporaryRoot, 'npm-cache'),
};

function run(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options && options.cwd ? options.cwd : projectRoot,
    encoding: 'utf8',
    env: childEnvironment,
  });

  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed\n${result.stdout || ''}\n${result.stderr || ''}`
  );
  return result.stdout;
}

async function exercisePhysicalCopies(bufferApi, ownerApi, firstApi, secondApi, labels) {
  const buffer = bufferApi.WorkerMutex.createSharedBuffer({
    mode: firstApi.WorkerMutexModeEnum.ASYNC,
  });
  const ownerMutex = new ownerApi.WorkerMutex(buffer);
  const firstMutex = new firstApi.WorkerMutex(buffer);
  const secondMutex = new secondApi.WorkerMutex(buffer);
  assert.equal(ownerMutex.mode, ownerApi.WorkerMutexModeEnum.ASYNC);
  const ownerLease = await ownerMutex.acquireAsync();
  assert.ok(ownerLease instanceof ownerApi.WorkerMutexLease);
  const order = [];
  let secondSettled = false;
  const firstPending = firstMutex.acquireAsync().then((lease) => {
    order.push(labels[0]);
    return lease;
  });
  const secondPending = secondMutex.acquireAsync().then((lease) => {
    secondSettled = true;
    order.push(labels[1]);
    return lease;
  });
  ownerLease[Symbol.dispose]();
  const firstLease = await firstPending;
  assert.ok(firstLease instanceof firstApi.WorkerMutexLease);
  assert.equal(firstLease.constructor, firstApi.WorkerMutexLease);
  assert.equal(firstLease instanceof secondApi.WorkerMutexLease, false);
  assert.deepEqual(order, [labels[0]]);
  assert.equal(secondSettled, false);
  firstLease[Symbol.dispose]();
  const secondLease = await secondPending;
  assert.ok(secondLease instanceof secondApi.WorkerMutexLease);
  assert.equal(secondLease.constructor, secondApi.WorkerMutexLease);
  assert.equal(secondLease instanceof firstApi.WorkerMutexLease, false);
  assert.deepEqual(order, labels);
  assert.throws(
    () => firstLease.release(),
    (error) => (
      error instanceof firstApi.WorkerMutexError
      && error.code === firstApi.WorkerMutexErrorCodeEnum.MUTEX_LEASE_IS_NOT_ACTIVE
    )
  );
  secondLease[Symbol.dispose]();
}

async function main() {
  const packOutput = run(npmCommand, [
    'pack',
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    temporaryRoot,
  ]);
  const packed = JSON.parse(packOutput)[0];
  const tarball = path.join(temporaryRoot, packed.filename);
  assert.ok(fs.existsSync(tarball));

  const consumerRoot = path.join(temporaryRoot, 'consumer');
  fs.mkdirSync(consumerRoot);
  fs.writeFileSync(
    path.join(consumerRoot, 'package.json'),
    JSON.stringify({ name: 'worker-mutex-consumer', private: true, version: '1.0.0' })
  );
  run(npmCommand, [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
    '--no-save',
    tarball,
  ], { cwd: consumerRoot });

  const installedRoot = path.join(consumerRoot, 'node_modules', 'worker-mutex');
  const packageApi = require(installedRoot);
  const leaseBarrel = require(path.join(installedRoot, 'dist', 'WorkerMutexLease'));
  const leaseModule = require(path.join(
    installedRoot,
    'dist',
    'WorkerMutexLease',
    'WorkerMutexLease'
  ));
  assert.deepEqual(Object.keys(packageApi).sort(), [
    'WorkerMutex',
    'WorkerMutexError',
    'WorkerMutexErrorCodeEnum',
    'WorkerMutexLease',
    'WorkerMutexModeEnum',
  ]);
  const errorCodeEnum = packageApi.WorkerMutexErrorCodeEnum;
  const modeEnum = packageApi.WorkerMutexModeEnum;
  assert.deepEqual(Object.entries(modeEnum), [
    ['BLOCKING', 'BLOCKING'],
    ['ASYNC', 'ASYNC']
  ]);
  assert.equal(
    errorCodeEnum.MUTEX_LEASE_CONSTRUCTION_NOT_ALLOWED,
    'MUTEX_LEASE_CONSTRUCTION_NOT_ALLOWED'
  );
  assert.equal(
    errorCodeEnum.SYMBOL_DISPOSE_IS_NOT_AVAILABLE,
    'SYMBOL_DISPOSE_IS_NOT_AVAILABLE'
  );
  assert.equal(typeof packageApi.WorkerMutexErrorCode, 'undefined');
  assert.equal(typeof packageApi.WorkerMutexMode, 'undefined');
  assert.equal(typeof packageApi.CreateSharedBufferOptions, 'undefined');
  assert.equal(typeof packageApi.WorkerMutexOptions, 'undefined');
  assert.equal(typeof packageApi.createWorkerMutexLease, 'undefined');
  assert.equal(packageApi.WorkerMutexLease, leaseBarrel.WorkerMutexLease);
  assert.equal(leaseBarrel.WorkerMutexLease, leaseModule.WorkerMutexLease);
  const enumError = new packageApi.WorkerMutexError(
    errorCodeEnum.MUTEX_LEASE_CONSTRUCTION_NOT_ALLOWED
  );
  assert.equal(enumError.code, errorCodeEnum.MUTEX_LEASE_CONSTRUCTION_NOT_ALLOWED);
  assert.equal(enumError.message, enumError.code);
  const rawJavaScriptError = new packageApi.WorkerMutexError('CUSTOM_RUNTIME_CODE');
  assert.equal(rawJavaScriptError.code, 'CUSTOM_RUNTIME_CODE');
  assert.equal(rawJavaScriptError.message, 'CUSTOM_RUNTIME_CODE');
  const buffer = packageApi.WorkerMutex.createSharedBuffer({ mode: modeEnum.ASYNC });
  const mutex = new packageApi.WorkerMutex(buffer);
  const rawStringBuffer = packageApi.WorkerMutex.createSharedBuffer({ mode: 'BLOCKING' });
  assert.throws(
    () => packageApi.WorkerMutex.createSharedBuffer({ mode: 'blocking' }),
    (error) => error && error.code === 'MUTEX_MODE_MUST_BE_BLOCKING_OR_ASYNC'
  );
  assert.throws(
    () => packageApi.WorkerMutex.createSharedBuffer({ mode: 'async' }),
    (error) => error && error.code === 'MUTEX_MODE_MUST_BE_BLOCKING_OR_ASYNC'
  );
  assert.equal(mutex.mode, modeEnum.ASYNC);
  assert.equal(new packageApi.WorkerMutex(rawStringBuffer).mode, 'BLOCKING');
  assert.equal(typeof mutex.recoverExclusive, 'undefined');
  assert.equal(typeof mutex.lockAsync, 'undefined');
  const lease = await mutex.acquireAsync();
  assert.ok(lease instanceof packageApi.WorkerMutexLease);
  assert.ok(lease instanceof leaseBarrel.WorkerMutexLease);
  assert.ok(lease instanceof leaseModule.WorkerMutexLease);
  lease.release();
  assert.throws(
    () => new packageApi.WorkerMutexLease(),
    (error) => error && error.code === 'MUTEX_LEASE_CONSTRUCTION_NOT_ALLOWED'
  );
  assert.equal(typeof Symbol.dispose, 'symbol');
  const symbolDisposeDescriptor = Object.getOwnPropertyDescriptor(Symbol, 'dispose');
  assert.equal(symbolDisposeDescriptor.value, Symbol.dispose);
  assert.equal(symbolDisposeDescriptor.writable, false);
  assert.equal(symbolDisposeDescriptor.enumerable, false);
  assert.equal(symbolDisposeDescriptor.configurable, false);

  const consumerRequire = require('node:module').createRequire(
    path.join(consumerRoot, 'package.json')
  );
  assert.throws(
    () => consumerRequire('worker-mutex/dist/internal/create-worker-mutex-lease.js'),
    (error) => error && error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED'
  );

  fs.writeFileSync(
    path.join(consumerRoot, 'interop.mjs'),
    [
      "import assert from 'node:assert/strict';",
      "import { createRequire } from 'node:module';",
      "import { WorkerMutex as imported, WorkerMutexError as importedError, WorkerMutexErrorCodeEnum as importedErrorCodeEnum, WorkerMutexLease as importedLease, WorkerMutexModeEnum as importedModeEnum } from 'worker-mutex';",
      'const require = createRequire(import.meta.url);',
      "const required = require('worker-mutex');",
      'assert.equal(imported, required.WorkerMutex);',
      'assert.equal(importedError, required.WorkerMutexError);',
      'assert.equal(importedErrorCodeEnum, required.WorkerMutexErrorCodeEnum);',
      'assert.equal(importedLease, required.WorkerMutexLease);',
      'assert.equal(importedModeEnum, required.WorkerMutexModeEnum);',
    ].join('\n')
  );
  run(process.execPath, ['interop.mjs'], { cwd: consumerRoot });

  fs.writeFileSync(
    path.join(consumerRoot, 'consumer.ts'),
    [
      "import { Worker } from 'worker_threads';",
      "import { WorkerMutex, WorkerMutexError, WorkerMutexErrorCodeEnum, WorkerMutexLease, WorkerMutexModeEnum } from 'worker-mutex';",
      '// @ts-expect-error Method DTOs are not package-root exports.',
      "import type { AcquireAsyncOutputDTO } from 'worker-mutex';",
      '// @ts-expect-error Method DTOs are not package-root exports.',
      "import type { BindWorkerExitInputDTO } from 'worker-mutex';",
      '// @ts-expect-error Method DTOs are not package-root exports.',
      "import type { BindWorkerExitOutputDTO } from 'worker-mutex';",
      '// @ts-expect-error Method DTOs are not package-root exports.',
      "import type { CreateSharedBufferInputDTO } from 'worker-mutex';",
      '// @ts-expect-error Method DTOs are not package-root exports.',
      "import type { CreateSharedBufferOutputDTO } from 'worker-mutex';",
      '// @ts-expect-error Method DTOs are not package-root exports.',
      "import type { LockOutputDTO } from 'worker-mutex';",
      '// @ts-expect-error Method DTOs are not package-root exports.',
      "import type { RunExclusiveOutputDTO } from 'worker-mutex';",
      '// @ts-expect-error Method DTOs are not package-root exports.',
      "import type { UnlockOutputDTO } from 'worker-mutex';",
      '// @ts-expect-error WorkerMutexMode was replaced by WorkerMutexModeEnum.',
      "import type { WorkerMutexMode } from 'worker-mutex';",
      '// @ts-expect-error WorkerMutexOptions was removed.',
      "import type { WorkerMutexOptions } from 'worker-mutex';",
      '// @ts-expect-error CreateSharedBufferOptions was removed.',
      "import type { CreateSharedBufferOptions } from 'worker-mutex';",
      '// @ts-expect-error WorkerMutexErrorCode was replaced by WorkerMutexErrorCodeEnum.',
      "import type { WorkerMutexErrorCode } from 'worker-mutex';",
      'type CreateInput = Parameters<typeof WorkerMutex.createSharedBuffer>[0];',
      'const options: CreateInput = { mode: WorkerMutexModeEnum.ASYNC };',
      'const shared: SharedArrayBuffer = WorkerMutex.createSharedBuffer(options);',
      'const blocking = WorkerMutex.createSharedBuffer({ mode: WorkerMutexModeEnum.BLOCKING });',
      '// @ts-expect-error The createSharedBuffer mode is readonly.',
      'options.mode = WorkerMutexModeEnum.BLOCKING;',
      '// @ts-expect-error createSharedBuffer requires an explicit mode.',
      'WorkerMutex.createSharedBuffer({});',
      '// @ts-expect-error TypeScript callers use WorkerMutexModeEnum members instead of raw strings.',
      "WorkerMutex.createSharedBuffer({ mode: 'ASYNC' });",
      'const mutex = new WorkerMutex(shared);',
      'const typedMode: WorkerMutexModeEnum = mutex.mode;',
      'const errorCode: WorkerMutexErrorCodeEnum = WorkerMutexErrorCodeEnum.MUTEX_LEASE_IS_NOT_ACTIVE;',
      'const typedError = new WorkerMutexError(errorCode);',
      'const typedCode: WorkerMutexErrorCodeEnum = typedError.code;',
      'declare const worker: Worker;',
      'type BindInput = Parameters<typeof WorkerMutex.bindWorkerExit>[0];',
      'const bindInput: BindInput = { worker, sharedBuffer: shared };',
      'const detach: () => void = WorkerMutex.bindWorkerExit(bindInput);',
      'const acquisition: Promise<WorkerMutexLease> = mutex.acquireAsync();',
      'declare const lease: WorkerMutexLease;',
      'const disposable: Disposable = lease;',
      'const blockingMutex = new WorkerMutex(blocking);',
      'const lockOutput: void = blockingMutex.lock();',
      'const unlockOutput: void = blockingMutex.unlock();',
      'const exclusive: Promise<number> = mutex.runExclusive(() => 1);',
      '// @ts-expect-error bindWorkerExit now accepts one object DTO.',
      'WorkerMutex.bindWorkerExit(worker, shared);',
      '// @ts-expect-error WorkerMutexLease instances are created only by WorkerMutex.',
      'new WorkerMutexLease();',
      '// @ts-expect-error Exit cleanup requires a genuine worker_threads Worker.',
      'WorkerMutex.bindWorkerExit({ worker: { threadId: 1 }, sharedBuffer: shared });',
      '// @ts-expect-error TypeScript callers use the error-code enum instead of raw strings.',
      "new WorkerMutexError('MUTEX_LEASE_IS_NOT_ACTIVE');",
      '// @ts-expect-error lockAsync was removed.',
      'mutex.lockAsync();',
      '// @ts-expect-error recoverExclusive was removed.',
      'mutex.recoverExclusive(() => undefined);',
      '// @ts-expect-error Owner-death poison errors were removed.',
      'WorkerMutexErrorCodeEnum.MUTEX_OWNER_DIED;',
      '// @ts-expect-error Poison recovery errors were removed.',
      'WorkerMutexErrorCodeEnum.MUTEX_IS_NOT_POISONED;',
      '// @ts-expect-error Recovery-in-progress errors were removed.',
      'WorkerMutexErrorCodeEnum.MUTEX_RECOVERY_IN_PROGRESS;',
      'void acquisition;',
      'void disposable;',
      'void lockOutput;',
      'void unlockOutput;',
      'void exclusive;',
      'void blocking;',
      'void typedMode;',
      'void typedCode;',
      'detach();',
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(consumerRoot, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'CommonJS',
        moduleResolution: 'node',
        noEmit: true,
        isolatedModules: true,
        strict: true,
        target: 'ES2017',
        lib: ['ES2017', 'ES2017.SharedMemory', 'ESNext.Disposable']
      },
      files: ['consumer.ts']
    })
  );
  const typeScriptCompilers = [
    path.join(projectRoot, 'node_modules', 'typescript-5-6', 'bin', 'tsc'),
    path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
  ];

  fs.writeFileSync(
    path.join(consumerRoot, 'tsconfig.no-disposable.json'),
    JSON.stringify({
      compilerOptions: {
        lib: ['ES2017'],
        noEmit: true,
        strict: true,
        types: []
      },
      files: [path.join(installedRoot, 'dist', 'WorkerMutexLease', 'WorkerMutexLease.d.ts')]
    })
  );

  for (const compiler of typeScriptCompilers) {
    const result = spawnSync(process.execPath, [
      compiler,
      '--project',
      path.join(consumerRoot, 'tsconfig.no-disposable.json')
    ], {
      cwd: consumerRoot,
      encoding: 'utf8',
      env: childEnvironment
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout || ''}\n${result.stderr || ''}`, /SymbolConstructor|Symbol\.dispose/);
  }

  for (const compiler of typeScriptCompilers) {
    run(process.execPath, [
      compiler,
      '--project',
      path.join(consumerRoot, 'tsconfig.json'),
    ], { cwd: consumerRoot });
  }

  fs.copyFileSync(
    path.join(consumerRoot, 'consumer.ts'),
    path.join(consumerRoot, 'consumer.mts')
  );
  fs.writeFileSync(
    path.join(consumerRoot, 'tsconfig.nodenext.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        noEmit: true,
        isolatedModules: true,
        strict: true,
        target: 'ES2017',
        lib: ['ES2017', 'ES2017.SharedMemory', 'ESNext.Disposable']
      },
      files: ['consumer.mts']
    })
  );

  for (const compiler of typeScriptCompilers) {
    run(process.execPath, [
      compiler,
      '--project',
      path.join(consumerRoot, 'tsconfig.nodenext.json')
    ], { cwd: consumerRoot });
  }

  fs.writeFileSync(
    path.join(consumerRoot, 'using-consumer.ts'),
    [
      "import { WorkerMutex, WorkerMutexLease, WorkerMutexModeEnum } from 'worker-mutex';",
      'async function main(): Promise<void> {',
      '  const buffer = WorkerMutex.createSharedBuffer({ mode: WorkerMutexModeEnum.ASYNC });',
      '  const mutex = new WorkerMutex(buffer);',
      '  const leases: WorkerMutexLease[] = [];',
      '  {',
      '    using lease = await mutex.acquireAsync();',
      '    leases.push(lease);',
      '  }',
      "  if (!leases[0] || !leases[0].released) throw new Error('LEASE_WAS_NOT_DISPOSED');",
      "  const marker = new Error('USING_BODY_FAILED');",
      '  try {',
      '    using lease = await mutex.acquireAsync();',
      '    leases.push(lease);',
      '    throw marker;',
      '  } catch (error) {',
      '    if (error !== marker) throw error;',
      '  }',
      "  if (!leases[1] || !leases[1].released) throw new Error('THROWING_LEASE_WAS_NOT_DISPOSED');",
      '  const finalLease = await mutex.acquireAsync();',
      '  finalLease[Symbol.dispose]();',
      '}',
      'main().catch((error: unknown) => {',
      '  process.stderr.write(String(error) + "\\n");',
      '  process.exitCode = 1;',
      '});'
    ].join('\n')
  );

  for (let index = 0; index < typeScriptCompilers.length; index += 1) {
    const compiler = typeScriptCompilers[index];
    const outputDirectory = path.join(consumerRoot, `using-output-${index}`);
    run(process.execPath, [
      compiler,
      '--target',
      'ES2017',
      '--module',
      'CommonJS',
      '--moduleResolution',
      'node',
      '--strict',
      '--lib',
      'ES2017,ES2017.SharedMemory,ESNext.Disposable',
      '--types',
      'node',
      '--outDir',
      outputDirectory,
      path.join(consumerRoot, 'using-consumer.ts')
    ], { cwd: consumerRoot });
    const outputFile = path.join(outputDirectory, 'using-consumer.js');
    run(process.execPath, [outputFile], { cwd: consumerRoot });

    if (index === 0 && process.env.WORKER_MUTEX_NODE_10_BIN) {
      const node10Binary = process.env.WORKER_MUTEX_NODE_10_BIN;
      assert.equal(run(node10Binary, ['--version']).trim(), 'v10.5.0');
      run(node10Binary, [
        '--experimental-worker',
        outputFile
      ], { cwd: consumerRoot });
    }
  }

  const copyARoot = path.join(temporaryRoot, 'physical-copy-a');
  const copyBRoot = path.join(temporaryRoot, 'physical-copy-b');
  fs.cpSync(installedRoot, copyARoot, { recursive: true });
  fs.cpSync(installedRoot, copyBRoot, { recursive: true });
  const copyA = require(copyARoot);
  const copyB = require(copyBRoot);
  assert.notEqual(copyA.WorkerMutex, copyB.WorkerMutex);
  assert.notEqual(copyA.WorkerMutexLease, copyB.WorkerMutexLease);
  assert.notEqual(copyA.WorkerMutexModeEnum, copyB.WorkerMutexModeEnum);
  const crossCopyModeBuffer = copyA.WorkerMutex.createSharedBuffer({
    mode: copyB.WorkerMutexModeEnum.BLOCKING,
  });
  assert.equal(
    new copyB.WorkerMutex(crossCopyModeBuffer).mode,
    copyA.WorkerMutexModeEnum.BLOCKING
  );
  await exercisePhysicalCopies(copyA, copyA, copyB, copyA, ['B', 'A']);
  await exercisePhysicalCopies(copyA, copyB, copyA, copyB, ['A', 'B']);

  process.stdout.write('package smoke passed\n');
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(temporaryRoot, { force: true, recursive: true });
});
