// @ts-nocheck
const { Module } = require('@nestjs/common');
const { NabzBazarService } = require('./nabz-bazar.service');

class AppModule {}

Module({
  providers: [NabzBazarService]
})(AppModule);

module.exports = { AppModule };
