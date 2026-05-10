import 'dotenv/config';
import { Daytona } from '@daytonaio/sdk';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const DAYTONA_API_KEY = process.env.DAYTONA_API ?? '';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL ?? 'admin@example.com';
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? 'pancake1!';
const PB_SEED_ANCHOR = process.env.PB_SEED_ANCHOR ?? '2026-05-09T00:00:00Z';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';

const PB_VERSION = '0.28.2';
const SANDBOX_ID = process.env.DAYTONA_SANDBOX_ID ?? '';

async function exec(sandbox: Awaited<ReturnType<Daytona['create']>>, cmd: string, label: string) {
  process.stdout.write(`  ${label}... `);
  const res = await sandbox.process.executeCommand(cmd, undefined, undefined, 120);
  const code = (res as any).exitCode ?? (res as any).exit_code;
  if (code !== 0) {
    console.log('FAILED');
    console.error(res.result || (res as any).error);
    throw new Error(`Command failed (exit ${code}): ${label}`);
  }
  console.log('ok');
  return res.result;
}

async function main() {
  if (!DAYTONA_API_KEY) throw new Error('DAYTONA_API not set in .env');

  const daytona = new Daytona({
    apiKey: DAYTONA_API_KEY,
    apiUrl: 'https://app.daytona.io/api',
  });

  let sandbox: Awaited<ReturnType<typeof daytona.create>>;
  if (SANDBOX_ID) {
    console.log(`Reusing sandbox: ${SANDBOX_ID}`);
    sandbox = await daytona.get(SANDBOX_ID);
  } else {
    console.log('Creating Daytona sandbox...');
    sandbox = await daytona.create({
      language: 'typescript',
      envVars: {
        PB_ADMIN_EMAIL,
        PB_ADMIN_PASSWORD,
        PB_SEED_ANCHOR,
        PB_URL: 'http://127.0.0.1:8090',
      },
      autoStopInterval: 0,
    });
    console.log(`Sandbox created: ${sandbox.id}`);
  }

  // Install PocketBase
  await exec(sandbox,
    `curl -fsSL https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip -o /tmp/pb.zip && unzip -qo /tmp/pb.zip pocketbase -d /tmp && chmod +x /tmp/pocketbase`,
    'Download PocketBase'
  );

  // Start PocketBase in background
  await exec(sandbox,
    'nohup /tmp/pocketbase serve --http=0.0.0.0:8090 --dir /tmp/pb_data > /tmp/pb.log 2>&1 &',
    'Start PocketBase'
  );

  // Wait for PB to be ready
  await exec(sandbox,
    'for i in $(seq 1 20); do curl -sf http://127.0.0.1:8090/api/health && break || sleep 1; done',
    'Wait for PocketBase ready'
  );

  // Create admin superuser
  await exec(sandbox,
    `/tmp/pocketbase superuser upsert ${PB_ADMIN_EMAIL} '${PB_ADMIN_PASSWORD}' --dir /tmp/pb_data`,
    'Create admin user'
  );

  // Upload schema setup script
  const schemaScript = readFileSync(resolve(__dirname, 'setup-pb-schema.ts'), 'utf-8')
    .replace(/import 'dotenv\/config';?\n?/, ''); // env vars already set in sandbox
  await sandbox.fs.uploadFile(Buffer.from(schemaScript), '/tmp/setup-pb-schema.ts');

  // Upload seed script
  const seedScript = readFileSync(resolve(__dirname, 'seed-pb.ts'), 'utf-8')
    .replace(/import 'dotenv\/config';?\n?/, '');
  await sandbox.fs.uploadFile(Buffer.from(seedScript), '/tmp/seed-pb.ts');

  // Install tsx for running TypeScript scripts
  await exec(sandbox, 'npm install -g tsx 2>/dev/null || true', 'Install tsx');

  // Run schema setup
  await exec(sandbox,
    'cd /tmp && tsx setup-pb-schema.ts',
    'Create PocketBase schema'
  );

  // Run seed
  const seedOutput = await exec(sandbox,
    'cd /tmp && tsx seed-pb.ts',
    'Seed demo data'
  );
  console.log(seedOutput);

  // Get signed URL for port 8090 (bypasses Daytona OAuth proxy for server-side requests)
  console.log('\nGetting signed URL for port 8090...');
  const preview = await (sandbox as any).getSignedPreviewUrl(8090);
  const pbPublicUrl = preview.url;

  console.log(`\n✓ PocketBase running in Daytona`);
  console.log(`  Admin UI: ${pbPublicUrl}/_/`);
  console.log(`  API:      ${pbPublicUrl}/api/`);
  console.log(`  Login:    ${PB_ADMIN_EMAIL} / ***`);
  console.log(`\nUpdate your .env.local:`);
  console.log(`  PB_URL=${pbPublicUrl}`);

  // Auto-update .env.local
  const envPath = resolve(__dirname, '../.env.local');
  let envContent = readFileSync(envPath, 'utf-8');
  envContent = envContent.replace(/^PB_URL=.*/m, `PB_URL=${pbPublicUrl}`);
  require('fs').writeFileSync(envPath, envContent);
  console.log('\n.env.local updated with new PB_URL.');
  console.log(`\nSandbox ID: ${sandbox.id}  (keep this if you need to delete it later)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
