'use strict';

const os = require('os');
const originalCpus = os.cpus.bind(os);

os.cpus = function patchedCpus() {
  const cpus = originalCpus();

  if (Array.isArray(cpus) && cpus.length > 0) {
    return cpus;
  }

  return [{
    model: 'fallback-cpu',
    speed: 0,
    times: {
      user: 0,
      nice: 0,
      sys: 0,
      idle: 0,
      irq: 0,
    },
  }];
};
