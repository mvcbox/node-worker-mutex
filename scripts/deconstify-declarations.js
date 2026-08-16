'use strict';

const fs = require('fs');
const path = require('path');

const declarations = [
  {
    name: 'WorkerMutexModeEnum',
    target: path.resolve(__dirname, '..', 'dist', 'WorkerMutexModeEnum.d.ts')
  },
  {
    name: 'WorkerMutexErrorCodeEnum',
    target: path.resolve(
      __dirname,
      '..',
      'dist',
      'errors',
      'WorkerMutexErrorCodeEnum.d.ts'
    )
  }
];

const outputs = declarations.map(function prepareDeclaration(declaration) {
  const source = fs.readFileSync(declaration.target, 'utf8');
  const constDeclaration = 'export declare const enum ' + declaration.name;
  const regularDeclaration = 'export declare enum ' + declaration.name;
  const occurrences = source.split(constDeclaration).length - 1;

  if (occurrences !== 1) {
    throw new Error(
      'Expected exactly one ' + declaration.name + ' const declaration, found ' + occurrences
    );
  }

  const output = source.replace(constDeclaration, regularDeclaration);
  const remainingConstDeclaration = new RegExp(
    '\\bconst\\s+enum\\s+' + declaration.name + '\\b'
  );

  if (remainingConstDeclaration.test(output)) {
    throw new Error(declaration.name + ' const declaration remains after replacement');
  }

  return {
    output: output,
    target: declaration.target
  };
});

outputs.forEach(function writeDeclaration(result) {
  fs.writeFileSync(result.target, result.output, 'utf8');
});
