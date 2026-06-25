const { Injectable } = require('@nestjs/common');
const { startNabzBazarBot } = require('../index');

class NabzBazarService {
  constructor() {
    this.runtime = null;
  }

  async start() {
    if (this.runtime) return;
    this.runtime = await startNabzBazarBot();
  }

  async onModuleInit() {
    await this.start();
  }

  async onApplicationShutdown(signal) {
    if (this.runtime && typeof this.runtime.stop === 'function') {
      this.runtime.stop(signal || 'SIGTERM');
    }
  }
}

Injectable()(NabzBazarService);

module.exports = { NabzBazarService };
