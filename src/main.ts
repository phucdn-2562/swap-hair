import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
+ * Load a .env file before NestJS creates providers.
+ * Existing environment variables (shell, Docker, PM2) take precedence.
+ * This avoids adding a dotenv dependency.
+ */
function loadEnvFile(): void {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(__dirname, '.env'),
    resolve(__dirname, '..', '.env'),
  ];

  const envPath = candidates.find((candidate) => existsSync(candidate));

  if (!envPath) {
    console.warn(
      `No .env file found. Checked: ${candidates.join(', ')}`,
    );
    return;
  }

 const content = readFileSync(envPath, 'utf8');

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');

   if (separatorIndex <= 0) {
     continue;
    }

    const key = line.slice(0, separatorIndex).trim();
   let value = line.slice(separatorIndex + 1).trim();

   if (
     (value.startsWith('"') && value.endsWith('"')) ||      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
   } else {
     value = value.replace(/\s+#.*$/, '').trim();
   }

   // Do not overwrite environment variables supplied by the runtime.
   if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  console.log(`Loaded environment file: ${envPath}`);
}

async function bootstrap() {
  +  // Must happen before NestFactory.create() initializes application providers.
  loadEnvFile();

  if (!process.env.GEMINI_API_KEY?.trim()) {
   console.warn(
     'GEMINI_API_KEY is missing or empty. Add it to .env or export it in the runtime environment.',
   );
 } else {
    console.log('GEMINI_API_KEY is configured.');
  }
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.setGlobalPrefix('api');
  const port = Number(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`Hairstyle API listening on http://localhost:${port}/api`);
}
bootstrap();
