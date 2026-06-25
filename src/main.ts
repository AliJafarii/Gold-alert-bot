// @ts-nocheck
require('reflect-metadata');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./nest/app.module');
const { NabzBazarService } = require('./nest/nabz-bazar.service');

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log']
  });
  app.enableShutdownHooks();
  await app.get(NabzBazarService).start();
  console.log('nabz bazar NestJS application started');
}

bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
