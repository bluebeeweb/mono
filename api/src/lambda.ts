import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ExpressAdapter } from '@nestjs/platform-express';
import serverlessExpress from '@vendia/serverless-express';
import express from 'express';
import type { Handler, Context, Callback } from 'aws-lambda';

let cached: Handler | undefined;

async function bootstrap(): Promise<Handler> {
    const expressApp = express();
    const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));
    app.enableCors({ origin: true, credentials: true });
    await app.init();
    return serverlessExpress({ app: expressApp });
}

export const handler: Handler = async (event: any, context: Context, callback: Callback) => {
    if (!cached) cached = await bootstrap();
    return cached(event, context, callback);
};
